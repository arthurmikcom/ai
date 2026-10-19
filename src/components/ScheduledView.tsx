"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/client/api";
import type { Task, TaskSchedule } from "@/lib/types";
import { useApp } from "./AppState";
import { PageHeading } from "./Design";
import {
  ArrowUp,
  Bell,
  CalendarClock,
  Clock,
  Globe,
  LoaderCircle,
  MessageSquare,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Telescope,
  Trash2,
  TriangleAlert,
} from "./MaryxIcons";

type Kind = TaskSchedule["kind"];

const KINDS: { id: Kind; label: string }[] = [
  { id: "once", label: "Один раз" },
  { id: "daily", label: "Каждый день" },
  { id: "weekly", label: "Каждую неделю" },
  { id: "hourly", label: "Слежение" },
];
/** Sunday is 0 (like Date.getDay); the week starts on Monday. */
const WEEKDAYS = [
  { id: 1, label: "Пн", long: "понедельник" },
  { id: 2, label: "Вт", long: "вторник" },
  { id: 3, label: "Ср", long: "среду" },
  { id: 4, label: "Чт", long: "четверг" },
  { id: 5, label: "Пт", long: "пятницу" },
  { id: 6, label: "Сб", long: "субботу" },
  { id: 0, label: "Вс", long: "воскресенье" },
];
const INTERVALS = [1, 3, 6, 12, 24];

/** Ready tasks, one click to fill the form. */
const IDEAS: { title: string; prompt: string; schedule: TaskSchedule; search: boolean }[] = [
  { title: "Главное об ИИ за день", prompt: "Собери 5 главных новостей об искусственном интеллекте за последние сутки: коротко, по одному абзацу, со ссылками на источники.", schedule: { kind: "daily", time: "09:00" }, search: true },
  { title: "Курсы валют и биткоина", prompt: "Какие сейчас курсы доллара, евро и биткоина к рублю? Как они изменились за сутки? Коротко, таблицей.", schedule: { kind: "daily", time: "10:00" }, search: true },
  { title: "План на неделю", prompt: "Помоги спланировать неделю: предложи структуру недели с приоритетами, временем для работы, спорта и отдыха и три вопроса, чтобы подумать о целях.", schedule: { kind: "weekly", time: "09:00", weekday: 1 }, search: false },
  { title: "5 английских слов", prompt: "Дай 5 полезных английских слов уровня B2 с переводом, транскрипцией и примером предложения для каждого.", schedule: { kind: "daily", time: "08:00" }, search: false },
  { title: "Слежу за упоминаниями", prompt: "Найди свежие упоминания бренда «MARYX» в интернете: новости, отзывы, обсуждения. Если ничего нового — так и скажи.", schedule: { kind: "hourly", every: 6 }, search: true },
];

function scheduleText(s: TaskSchedule): string {
  switch (s.kind) {
    case "once": {
      const [date, time] = s.at.split("T");
      const [y, m, d] = date.split("-").map(Number);
      return `Один раз · ${new Date(y, m - 1, d).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })} в ${time}`;
    }
    case "daily":
      return `Каждый день в ${s.time}`;
    case "weekly":
      return `Каждую неделю: ${WEEKDAYS.find((w) => w.id === s.weekday)?.long ?? ""}, ${s.time}`;
    case "hourly":
      return s.every === 24 ? "Слежение · раз в сутки" : `Слежение · каждые ${s.every} ч`;
  }
}

/** "через 3 ч", "через 25 мин", "сейчас". */
function inTime(at: number, now: number): string {
  const minutes = Math.round((at - now) / 60000);
  if (minutes <= 1) return "сейчас";
  if (minutes < 60) return `через ${minutes} мин`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `через ${hours} ч`;
  return `через ${Math.round(hours / 24)} дн`;
}

function lastRunText(t: Task): string | null {
  if (!t.lastRunAt) return null;
  const when = new Date(t.lastRunAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return `Последний запуск: ${when}`;
}

function TaskIcon({ task }: { task: Pick<Task, "schedule" | "search"> }) {
  const Icon = task.schedule.kind === "hourly" ? Telescope : task.schedule.kind === "once" ? Bell : task.search ? Globe : CalendarClock;
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-violet-300/15 bg-violet-500/10 text-violet-200">
      <Icon className="size-5" />
    </div>
  );
}

/** The date an hour from now, for a one-off task. */
function soonDate(): string {
  const at = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

// The clock is read in the browser only (the page is prerendered without one);
// "next run in…" moves on by itself every half a minute.
const noSubscribe = () => () => {};
const tickEvery30s = (tick: () => void) => {
  const timer = setInterval(tick, 30_000);
  return () => clearInterval(timer);
};
const clockNow = () => Math.floor(Date.now() / 30_000) * 30_000;

/**
 * «Задачи» (like ChatGPT's Scheduled): MARYX does things on its own on a
 * schedule — a morning digest, a weekly plan, watching the news — and each
 * result comes to the task's chat.
 */
export function ScheduledView() {
  const app = useApp();
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [busy, setBusy] = useState<string | null>(null);
  // The form.
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<Kind>("daily");
  const [time, setTime] = useState("09:00");
  const [picked, setDate] = useState("");
  const today = useSyncExternalStore(noSubscribe, soonDate, () => "");
  const date = picked || today;
  const [weekday, setWeekday] = useState(1);
  const [every, setEvery] = useState(6);
  const [search, setSearch] = useState(false);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const now = useSyncExternalStore(tickEvery30s, clockNow, () => 0);

  useEffect(() => {
    let alive = true;
    api<Task[]>("/api/tasks").then(
      (list) => alive && setTasks(list),
      (e) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    // Opening the list is seeing the new results.
    api("/api/tasks/seen", { method: "POST" }).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const replace = (task: Task) => setTasks((list) => (list ?? []).map((t) => (t.id === task.id ? task : t)));

  const schedule = (): TaskSchedule =>
    kind === "once"
      ? { kind, at: `${date}T${time}` }
      : kind === "daily"
        ? { kind, time }
        : kind === "weekly"
          ? { kind, time, weekday }
          : { kind, every };

  const create = async () => {
    if (prompt.trim().length < 3 || saving) return;
    setSaving(true);
    setError(null);
    try {
      const made = await api<Task>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          prompt: prompt.trim(),
          schedule: schedule(),
          search: search || kind === "hourly",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      setTasks((list) => [...(list ?? []), made]);
      setPrompt("");
      setFilter("active");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setSaving(false);
  };

  const takeIdea = (idea: (typeof IDEAS)[number]) => {
    setPrompt(idea.prompt);
    setKind(idea.schedule.kind);
    if (idea.schedule.kind === "daily" || idea.schedule.kind === "weekly") setTime(idea.schedule.time);
    if (idea.schedule.kind === "weekly") setWeekday(idea.schedule.weekday);
    if (idea.schedule.kind === "hourly") setEvery(idea.schedule.every);
    setSearch(idea.search);
    input.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    input.current?.focus();
  };

  const act = async (id: string, what: "run" | "pause" | "resume" | "delete") => {
    setBusy(`${what}:${id}`);
    setError(null);
    try {
      if (what === "delete") {
        await api(`/api/tasks/${id}`, { method: "DELETE" });
        setTasks((list) => (list ?? []).filter((t) => t.id !== id));
      } else if (what === "run") {
        replace(await api<Task>(`/api/tasks/${id}/run`, { method: "POST" }));
        app.reloadChats();
      } else {
        replace(await api<Task>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ active: what === "resume" }) }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };

  const open = (chatId: string) => {
    app.openChat(chatId);
    router.push("/");
  };

  const shown = (tasks ?? []).filter((t) => filter === "all" || t.active);
  const chip = (on: boolean) =>
    `rounded-lg px-3 py-1.5 text-xs transition ${on ? "bg-white/10 text-zinc-100" : "text-zinc-500 hover:text-zinc-200"}`;

  return (
    <div className="h-full overflow-y-auto">
      <div className="page-content !max-w-[900px]">
        <PageHeading
          number="07"
          eyebrow="Работает, пока вы заняты"
          title="Задачи"
          description="Поручите MARYX дела по расписанию: утренние сводки, напоминания, слежение за новостями и ценами. Он выполнит их сам, а результат пришлёт в чат."
        />

        <div className="composer-panel rounded-3xl border p-4 md:p-5">
          <textarea
            ref={input}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Что сделать? Например: каждое утро присылай главные новости о технологиях"
            aria-label="Что сделать"
            className="w-full resize-none bg-transparent px-1 text-[15px] text-zinc-100 outline-none placeholder:text-zinc-500"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
            <div role="radiogroup" aria-label="Когда" className="flex flex-wrap rounded-xl bg-black/30 p-0.5">
              {KINDS.map((k) => (
                <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} onClick={() => setKind(k.id)} className={chip(kind === k.id)}>
                  {k.label}
                </button>
              ))}
            </div>
            {kind === "once" && (
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Дата" className="rounded-xl bg-black/30 px-3 py-1.5 text-xs text-zinc-200 outline-none" />
            )}
            {kind === "weekly" && (
              <div role="radiogroup" aria-label="День недели" className="flex rounded-xl bg-black/30 p-0.5">
                {WEEKDAYS.map((w) => (
                  <button key={w.id} type="button" role="radio" aria-checked={weekday === w.id} onClick={() => setWeekday(w.id)} className={chip(weekday === w.id)}>
                    {w.label}
                  </button>
                ))}
              </div>
            )}
            {kind === "hourly" ? (
              <label className="flex items-center gap-2 text-xs text-zinc-400">
                каждые
                <select value={every} onChange={(e) => setEvery(Number(e.target.value))} aria-label="Как часто" className="rounded-xl bg-black/30 px-2 py-1.5 text-xs text-zinc-200 outline-none">
                  {INTERVALS.map((n) => (
                    <option key={n} value={n}>
                      {n === 24 ? "24 ч (раз в сутки)" : `${n} ч`}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Время" className="rounded-xl bg-black/30 px-3 py-1.5 text-xs text-zinc-200 outline-none" />
            )}
            <label className="flex items-center gap-2 text-xs text-zinc-400" title="Нужны свежие данные: новости, цены, погода">
              <input type="checkbox" checked={search || kind === "hourly"} disabled={kind === "hourly"} onChange={(e) => setSearch(e.target.checked)} className="accent-violet-400" />
              Искать в интернете
            </label>
            <div className="flex-1" />
            <button type="button" onClick={() => void create()} disabled={prompt.trim().length < 3 || saving} className="maryx-button flex items-center gap-2 rounded-xl px-4 py-2 text-sm">
              {saving ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
              Создать задачу
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-red-300">
            <TriangleAlert className="size-4 shrink-0" /> {error}
          </p>
        )}

        <div className="mt-8 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Ваши задачи</h2>
          <div role="radiogroup" aria-label="Показать" className="flex rounded-xl bg-white/[0.04] p-0.5">
            <button type="button" role="radio" aria-checked={filter === "active"} onClick={() => setFilter("active")} className={chip(filter === "active")}>
              Активные
            </button>
            <button type="button" role="radio" aria-checked={filter === "all"} onClick={() => setFilter("all")} className={chip(filter === "all")}>
              Все
            </button>
          </div>
        </div>

        <div className="mt-3 divide-y divide-white/5 rounded-2xl border border-white/5">
          {tasks === null && !error && (
            <div className="flex justify-center p-6">
              <LoaderCircle className="size-5 animate-spin text-zinc-500" />
            </div>
          )}
          {tasks !== null && shown.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <Clock className="size-7 text-zinc-500" />
              <p className="text-sm text-zinc-300">{filter === "active" && tasks.length ? "Все задачи на паузе" : "Пока нет задач"}</p>
              <p className="text-xs text-zinc-500">Опишите задачу выше или возьмите готовую ниже.</p>
            </div>
          )}
          {shown.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 p-4">
              <TaskIcon task={t} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-medium text-zinc-100" title={t.prompt}>{t.title}</span>
                  {t.unread && <span className="size-2 shrink-0 rounded-full bg-violet-400" aria-label="Новый результат" />}
                </div>
                <div className="mt-0.5 text-xs text-zinc-400">
                  {scheduleText(t.schedule)}
                  {" · "}
                  {!t.active ? (t.schedule.kind === "once" && t.runs ? "выполнена" : "на паузе") : t.nextRunAt ? `следующий запуск ${inTime(t.nextRunAt, now)}` : ""}
                </div>
                {t.lastStatus && t.lastStatus !== "ok" ? (
                  <div className="mt-0.5 text-xs text-amber-300">{t.lastError}</div>
                ) : (
                  lastRunText(t) && <div className="mt-0.5 text-[11px] text-zinc-500">{lastRunText(t)}</div>
                )}
              </div>
              <div className="flex items-center gap-1">
                {t.chatId && (
                  <button type="button" onClick={() => open(t.chatId!)} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-violet-200 hover:bg-violet-500/10">
                    <MessageSquare className="size-3.5" /> Результаты
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void act(t.id, "run")}
                  disabled={busy !== null}
                  title="Запустить сейчас"
                  aria-label={`Запустить сейчас: ${t.title}`}
                  className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-zinc-100 disabled:opacity-40"
                >
                  {busy === `run:${t.id}` ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                </button>
                {(t.active || t.schedule.kind !== "once") && (
                  <button
                    type="button"
                    onClick={() => void act(t.id, t.active ? "pause" : "resume")}
                    disabled={busy !== null}
                    title={t.active ? "Пауза" : "Возобновить"}
                    aria-label={`${t.active ? "Пауза" : "Возобновить"}: ${t.title}`}
                    className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-zinc-100 disabled:opacity-40"
                  >
                    {t.active ? <Pause className="size-4" /> : <Play className="size-4" />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => confirm(`Удалить задачу «${t.title}»? Результаты останутся в чате.`) && void act(t.id, "delete")}
                  disabled={busy !== null}
                  title="Удалить"
                  aria-label={`Удалить: ${t.title}`}
                  className="rounded-lg p-2 text-zinc-500 hover:bg-white/5 hover:text-red-300 disabled:opacity-40"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <h2 className="mb-3 mt-10 text-sm font-semibold uppercase tracking-wider text-zinc-500">Готовые задачи</h2>
        <div className="divide-y divide-white/5 rounded-2xl border border-white/5">
          {IDEAS.map((idea) => (
            <button key={idea.title} type="button" onClick={() => takeIdea(idea)} className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-white/[0.03]">
              <TaskIcon task={idea} />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium text-zinc-100">{idea.title}</div>
                <div className="truncate text-xs text-zinc-400">{scheduleText(idea.schedule)} · {idea.prompt}</div>
              </div>
              <Plus className="size-5 shrink-0 text-zinc-400" aria-label="Добавить" />
            </button>
          ))}
        </div>
        <p className="mt-6 text-xs leading-5 text-zinc-500">
          Каждый запуск задачи считается одним сообщением. Задачи выполняются, пока сайт открыт, и раз в сутки сами; чтобы они
          всегда приходили минута в минуту, администратор может подключить бесплатный «будильник» (см. README).
        </p>
      </div>
    </div>
  );
}
