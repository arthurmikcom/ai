// «Задачи»: prompts MARYX runs by itself on a schedule (once, daily, weekly, or
// every few hours to watch for news). Each run is one chat message for the
// user's limits; its answer lands in the task's own chat.
//
// Runs happen when they're due and something calls runDueTasks: the open app
// every minute (the user's own tasks), the daily cron, or an outside pinger
// calling /api/cron/tasks (see README).

import { and, asc, count, eq, isNotNull, lte } from "drizzle-orm";
import type { Task, TaskSchedule } from "@/lib/types";
import type { SessionUser } from "./auth";
import { describeAiError } from "./brand";
import { findChat } from "./chats";
import { getDb, schema } from "./db";
import { runScheduledPrompt } from "./maryx";
import { ownKey } from "./own-key";
import { charge, refundCharge, reserve, settleCharge } from "./usage";

/** Tasks one user can keep. */
export const MAX_TASKS = 20;
/** Monitoring runs every this many hours at most. */
export const TASK_INTERVALS = [1, 3, 6, 12, 24];
/** What a run may cost (a model with web search), held until it's done. */
const RUN_HOLD_USD = 0.05;

type TaskRow = typeof schema.task.$inferSelect;

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    schedule: row.schedule,
    timezone: row.timezone,
    search: row.search,
    active: row.active,
    ...(row.nextRunAt ? { nextRunAt: row.nextRunAt.getTime() } : {}),
    ...(row.lastRunAt ? { lastRunAt: row.lastRunAt.getTime() } : {}),
    ...(row.lastStatus ? { lastStatus: row.lastStatus } : {}),
    ...(row.lastError ? { lastError: row.lastError } : {}),
    runs: row.runs,
    unread: row.unread,
    ...(row.chatId ? { chatId: row.chatId } : {}),
    createdAt: row.createdAt.getTime(),
  };
}

// ---------- Time zones ----------

export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The wall clock in `zone` at `date`. */
function wallClock(date: Date, zone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday),
  };
}

/** The moment it is `hour:minute` on that date in `zone` (DST included). */
function zonedTime(year: number, month: number, day: number, hour: number, minute: number, zone: string): Date {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const w = wallClock(new Date(guess), zone);
    const shown = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
    guess += wanted - shown;
  }
  return new Date(guess);
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MOMENT = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

/** When the task runs next after `after`; null when it won't again (a one-off already past). */
export function nextRun(schedule: TaskSchedule, zone: string, after: Date): Date | null {
  if (schedule.kind === "once") {
    const m = MOMENT.exec(schedule.at);
    if (!m) return null;
    const at = zonedTime(+m[1], +m[2], +m[3], +m[4], +m[5], zone);
    return at > after ? at : null;
  }
  if (schedule.kind === "hourly") return new Date(after.getTime() + schedule.every * 60 * 60 * 1000);
  const [hour, minute] = schedule.time.split(":").map(Number);
  const today = wallClock(after, zone);
  // Up to 8 days ahead covers a weekly task whose day is today but whose time has passed.
  for (let ahead = 0; ahead <= 8; ahead++) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + ahead, 12));
    const at = zonedTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour, minute, zone);
    if (at <= after) continue;
    if (schedule.kind === "weekly" && wallClock(at, zone).weekday !== schedule.weekday) continue;
    return at;
  }
  return null;
}

/** A schedule from the browser, or why it can't be one. */
export function parseSchedule(value: unknown): TaskSchedule | string {
  if (typeof value !== "object" || value === null) return "Укажите, когда выполнять задачу";
  const v = value as Record<string, unknown>;
  switch (v.kind) {
    case "once":
      return typeof v.at === "string" && MOMENT.test(v.at) ? { kind: "once", at: v.at } : "Укажите дату и время";
    case "daily":
      return typeof v.time === "string" && TIME.test(v.time) ? { kind: "daily", time: v.time } : "Укажите время";
    case "weekly":
      if (typeof v.time !== "string" || !TIME.test(v.time)) return "Укажите время";
      if (typeof v.weekday !== "number" || !Number.isInteger(v.weekday) || v.weekday < 0 || v.weekday > 6) return "Укажите день недели";
      return { kind: "weekly", time: v.time, weekday: v.weekday };
    case "hourly":
      return typeof v.every === "number" && TASK_INTERVALS.includes(v.every) ? { kind: "hourly", every: v.every } : "Неверный интервал";
    default:
      return "Неизвестное расписание";
  }
}

/** The task's first run: a watch starts right away (a first result to compare with), the rest on schedule. */
function firstRun(schedule: TaskSchedule, zone: string): Date | null {
  return schedule.kind === "hourly" ? new Date() : nextRun(schedule, zone, new Date());
}

// ---------- Storage ----------

export async function listTasks(userId: string): Promise<Task[]> {
  const db = await getDb();
  const rows = await db.select().from(schema.task).where(eq(schema.task.userId, userId)).orderBy(asc(schema.task.createdAt));
  return rows.map(toTask);
}

export interface TaskInput {
  title: string;
  prompt: string;
  schedule: TaskSchedule;
  timezone: string;
  search: boolean;
}

/** Saves a new task, or says why it can't be (too many, or a moment already past). */
export async function createTask(userId: string, input: TaskInput): Promise<Task | string> {
  const db = await getDb();
  const [{ kept }] = await db.select({ kept: count() }).from(schema.task).where(eq(schema.task.userId, userId));
  if (kept >= MAX_TASKS) return `Можно держать до ${MAX_TASKS} задач — удалите ненужные.`;
  const next = firstRun(input.schedule, input.timezone);
  if (!next) return "Это время уже прошло — выберите другое.";
  const [row] = await db
    .insert(schema.task)
    .values({ id: crypto.randomUUID(), userId, ...input, nextRunAt: next })
    .returning();
  return toTask(row);
}

/** Pauses, resumes or edits a task (a new schedule or a resume plans the next run anew). */
export async function updateTask(
  userId: string,
  id: string,
  changes: Partial<Pick<TaskInput, "title" | "prompt" | "schedule" | "search">> & { active?: boolean },
): Promise<Task | string | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.task)
    .where(and(eq(schema.task.id, id), eq(schema.task.userId, userId)));
  if (!row) return null;
  const schedule = changes.schedule ?? row.schedule;
  const active = changes.active ?? row.active;
  let nextRunAt = row.nextRunAt;
  if (changes.schedule || (changes.active && !row.active)) {
    nextRunAt = active ? nextRun(schedule, row.timezone, new Date()) : row.nextRunAt;
    if (active && !nextRunAt) return "Это время уже прошло — выберите другое.";
  }
  const [updated] = await db
    .update(schema.task)
    .set({ ...changes, schedule, active, nextRunAt })
    .where(eq(schema.task.id, id))
    .returning();
  return toTask(updated);
}

/** Deletes a task; its chat (the results so far) stays in the history. */
export async function deleteTask(userId: string, id: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .delete(schema.task)
    .where(and(eq(schema.task.id, id), eq(schema.task.userId, userId)))
    .returning({ id: schema.task.id });
  return rows.length > 0;
}

/** The task list was opened: its results are seen. */
export async function markTasksSeen(userId: string): Promise<void> {
  const db = await getDb();
  await db.update(schema.task).set({ unread: false }).where(and(eq(schema.task.userId, userId), eq(schema.task.unread, true)));
}

// ---------- Running ----------

function nowFor(zone: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: zone, dateStyle: "full", timeStyle: "short" }).format(new Date());
}

/** The chat a task's results go to (made on its first run, or again if the user deleted it). */
async function chatFor(row: TaskRow): Promise<string> {
  if (row.chatId && (await findChat(row.userId, row.chatId))) return row.chatId;
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.insert(schema.chat).values({ id, userId: row.userId, title: `⏰ ${row.title}`, provider: "maryx", model: "maryx" });
  return id;
}

/**
 * Runs one task now: charged as a chat message, its question and answer added
 * to the task's chat. A run that isn't allowed (limits) or fails is noted on
 * the task, which tries again next time.
 */
async function execute(row: TaskRow): Promise<Task> {
  const db = await getDb();
  const done = async (status: "ok" | "error" | "limit", error: string | null, chatId?: string) => {
    const [updated] = await db
      .update(schema.task)
      .set({
        lastRunAt: new Date(),
        lastStatus: status,
        lastError: error,
        unread: true,
        ...(status === "ok" ? { runs: row.runs + 1 } : {}),
        ...(chatId ? { chatId } : {}),
      })
      .where(eq(schema.task.id, row.id))
      .returning();
    return toTask(updated);
  };

  const [person] = await db.select().from(schema.user).where(eq(schema.user.id, row.userId));
  if (!person) return toTask(row);
  const user: SessionUser = { id: person.id, name: person.name, email: person.email, emailVerified: person.emailVerified, image: person.image };
  const key = await ownKey(user.id);
  const paid = await charge(user, "chat", key);
  if ("denied" in paid) return done("limit", "Сообщения на сегодня закончились — задача выполнится в следующий раз.");
  let refused;
  try {
    refused = await reserve(paid, RUN_HOLD_USD, { provider: "openrouter", model: "task" });
  } catch (err) {
    await refundCharge(paid);
    throw err;
  }
  if (refused) {
    await refundCharge(paid);
    return done("limit", "Бюджет на сегодня закончился — задача выполнится в следующий раз.");
  }
  try {
    const chatId = await chatFor(row);
    const answer = await runScheduledPrompt(row, { userId: user.id, paidBy: paid.paidBy, key: paid.key }, nowFor(row.timezone));
    if (!answer.text) throw new Error("MARYX не вернул ответ");
    await db.insert(schema.message).values([
      { id: crypto.randomUUID(), chatId, role: "user", content: `⏰ ${row.prompt}` },
      {
        id: crypto.randomUUID(),
        chatId,
        role: "assistant",
        content: answer.text,
        provider: answer.model.provider,
        model: answer.model.id,
        via: "maryx",
        ...(answer.sources.length ? { sources: answer.sources } : {}),
      },
    ]);
    // The chat comes up first in the history.
    await db.update(schema.chat).set({ updatedAt: new Date() }).where(eq(schema.chat.id, chatId));
    // The model's cost is already recorded (as MARYX's own job); this settles the message.
    await settleCharge(paid, []);
    return done("ok", null, chatId);
  } catch (err) {
    await refundCharge(paid);
    console.error("[tasks] run failed", row.id, err);
    return done("error", describeAiError(err));
  }
}

/**
 * Claims a task's run, so two callers (the app and the cron) never run it
 * twice: it moves on to its next time (a one-off is switched off) first.
 */
async function claim(row: TaskRow): Promise<boolean> {
  if (!row.nextRunAt) return false;
  const db = await getDb();
  const next = row.schedule.kind === "once" ? null : nextRun(row.schedule, row.timezone, new Date());
  const claimed = await db
    .update(schema.task)
    .set({ nextRunAt: next, ...(next ? {} : { active: false }) })
    .where(and(eq(schema.task.id, row.id), eq(schema.task.active, true), eq(schema.task.nextRunAt, row.nextRunAt)))
    .returning({ id: schema.task.id });
  return claimed.length > 0;
}

/** Runs the tasks that are due (one user's, or everyone's) until `until`; returns those that ran. */
export async function runDueTasks(opts: { userId?: string; until: number; limit: number }): Promise<Task[]> {
  const db = await getDb();
  const due = and(eq(schema.task.active, true), isNotNull(schema.task.nextRunAt), lte(schema.task.nextRunAt, new Date()));
  const rows = await db
    .select()
    .from(schema.task)
    .where(opts.userId ? and(due, eq(schema.task.userId, opts.userId)) : due)
    .orderBy(asc(schema.task.nextRunAt))
    .limit(opts.limit);
  const ran: Task[] = [];
  for (const row of rows) {
    if (Date.now() > opts.until) break;
    if (!(await claim(row))) continue;
    ran.push(await execute(row));
  }
  return ran;
}

/** «Запустить сейчас»: runs a task at once, keeping its schedule. */
export async function runTaskNow(userId: string, id: string): Promise<Task | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.task)
    .where(and(eq(schema.task.id, id), eq(schema.task.userId, userId)));
  return row ? execute(row) : null;
}
