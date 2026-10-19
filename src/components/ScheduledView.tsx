"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/client/api";
import type { Task, TaskSchedule } from "@/lib/types";
import { useApp } from "./AppState";
import { PageHeading } from "./Design";
import {
  Bell,
  ArrowUpRight,
  CalendarDays,
  Repeat2,
  Sparkles,
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

const KINDS = [
  { id: "once", label: "Один раз", Icon: Bell },
  { id: "daily", label: "Каждый день", Icon: Repeat2 },
  { id: "weekly", label: "Каждую неделю", Icon: CalendarDays },
  { id: "hourly", label: "Слежение", Icon: Telescope },
] as const;
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
  { title: "Курсы валют и биткоина", prompt: "Какие сейчас курсы евро, фунта, иены и биткоина к доллару? Как они изменились за сутки? Коротко, таблицей.", schedule: { kind: "daily", time: "10:00" }, search: true },
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
    <div className="section-symbol" data-tone={task.schedule.kind === "hourly" ? "cyan" : task.schedule.kind === "once" ? "amber" : "accent"}>
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
  const activeCount = (tasks ?? []).filter((t) => t.active).length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="page-content scheduled-page">
        <PageHeading
          number="07"
          eyebrow="Меньше рутины. Больше вашего времени"
          title="Дела идут. Вы свободны."
          description="Новости к утреннему кофе, план на неделю или важное напоминание. Поручите это MARYX — результат придёт в отдельный чат."
        >
          <div className="section-status"><CalendarClock size={16} /><span>Задачи по расписанию</span></div>
        </PageHeading>

        <div className="task-setup-grid">
          <section className="task-composer composer-panel" aria-labelledby="task-create-heading">
            <div className="section-card-heading">
              <span className="section-symbol"><Sparkles size={20} /></span>
              <div><h2 id="task-create-heading">Новая задача</h2><p>Расскажите, что нужно сделать</p></div>
            </div>
            <label className="sr-only" htmlFor="task-prompt">Что сделать</label>
            <textarea
              id="task-prompt"
              ref={input}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Например: собирай главные новости о технологиях каждое утро"
              className="task-prompt"
            />
            <div className="task-form-section">
              <div className="task-field-label"><Clock size={14} /> Когда выполнять</div>
              <div role="radiogroup" aria-label="Когда" className="schedule-kinds">
                {KINDS.map(({ id, label, Icon }) => (
                  <button key={id} type="button" role="radio" aria-checked={kind === id} onClick={() => setKind(id)}>
                    <Icon size={17} /><span>{label}</span>
                  </button>
                ))}
              </div>
              <div className="schedule-details">
                {kind === "once" && (
                  <label className="schedule-field">Дата<input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Дата" /></label>
                )}
                {kind === "weekly" && (
                  <div className="schedule-week">
                    <span>День недели</span>
                    <div role="radiogroup" aria-label="День недели">
                      {WEEKDAYS.map((w) => (
                        <button key={w.id} type="button" role="radio" aria-checked={weekday === w.id} onClick={() => setWeekday(w.id)}>{w.label}</button>
                      ))}
                    </div>
                  </div>
                )}
                {kind === "hourly" ? (
                  <label className="schedule-field">Проверять каждые
                    <select value={every} onChange={(e) => setEvery(Number(e.target.value))} aria-label="Как часто">
                      {INTERVALS.map((n) => <option key={n} value={n}>{n === 24 ? "24 ч (раз в сутки)" : `${n} ч`}</option>)}
                    </select>
                  </label>
                ) : (
                  <label className="schedule-field">Время<input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Время" /></label>
                )}
              </div>
              <p className="schedule-timezone">По времени вашего устройства</p>
            </div>
            <label className="task-search-option">
              <span className="section-symbol" data-tone="cyan"><Globe size={18} /></span>
              <span><strong>Свежие данные из интернета</strong><small>Для новостей, погоды и актуальных цен</small></span>
              <input type="checkbox" checked={search || kind === "hourly"} disabled={kind === "hourly"} onChange={(e) => setSearch(e.target.checked)} />
            </label>
            <div className="task-create-footer">
              <div><span>Расписание</span><p>{scheduleText(schedule())}</p></div>
              <button type="button" onClick={() => void create()} disabled={prompt.trim().length < 3 || saving} className="maryx-button task-create-button">
                {saving ? <LoaderCircle size={17} className="animate-spin" /> : <Plus size={17} />} Создать задачу
              </button>
            </div>
          </section>

          <aside className="task-ideas" aria-labelledby="task-ideas-heading">
            <div className="task-ideas-intro"><span className="section-kicker">Можно начать с этого</span><h2 id="task-ideas-heading">Пять идей на каждый день</h2><p>Выберите идею и настройте её под себя.</p></div>
            {IDEAS.map((idea) => (
              <button key={idea.title} type="button" onClick={() => takeIdea(idea)} className="task-idea">
                <TaskIcon task={idea} />
                <span><strong>{idea.title}</strong><small>{scheduleText(idea.schedule)}</small></span>
                <ArrowUpRight size={16} />
              </button>
            ))}
            <div className="task-ideas-note"><MessageSquare size={16} /><p>У каждой задачи свой чат.<br />Все результаты останутся в одном месте.</p></div>
          </aside>
        </div>
        {error && <p role="alert" className="section-error"><TriangleAlert size={17} />{error}</p>}

        <section className="task-list-section" aria-labelledby="task-list-heading">
          <div className="task-list-heading">
            <div><span className="section-kicker">Под контролем</span><h2 id="task-list-heading">Ваши задачи <span>{tasks === null ? "—" : activeCount + " в работе"}</span></h2></div>
            <div role="radiogroup" aria-label="Показать" className="section-segment">
              <button type="button" role="radio" aria-checked={filter === "active"} onClick={() => setFilter("active")}>Активные</button>
              <button type="button" role="radio" aria-checked={filter === "all"} onClick={() => setFilter("all")}>Все</button>
            </div>
          </div>
          <div className="task-list">
            {tasks === null && !error && <div className="section-empty" role="status"><LoaderCircle size={24} className="animate-spin" /><p>Загружаем задачи…</p></div>}
            {tasks !== null && shown.length === 0 && (
              <div className="section-empty">
                <div className="empty-orbit"><CalendarClock size={30} /></div>
                <h3>{filter === "active" && tasks.length ? "Можно сделать паузу" : "Ваша рутина — на автопилоте"}</h3>
                <p>{filter === "active" && tasks.length ? "Все задачи на паузе. Выберите «Все», чтобы возобновить их." : "Создайте первую задачу выше. MARYX займётся ею по расписанию."}</p>
              </div>
            )}
            {shown.map((t) => (
              <article key={t.id} className="task-row" data-paused={!t.active || undefined}>
                <TaskIcon task={t} />
                <div className="task-row-body">
                  <div className="task-row-title"><h3 title={t.prompt}>{t.title}</h3>{t.unread && <span className="task-unread" aria-label="Новый результат" />}</div>
                  <p className="task-row-schedule"><Clock size={12} />{scheduleText(t.schedule)}</p>
                  <p className="task-row-next">{!t.active ? (t.schedule.kind === "once" && t.runs ? "Выполнена" : "На паузе") : t.nextRunAt ? `Следующий запуск ${inTime(t.nextRunAt, now)}` : ""}</p>
                  {t.lastStatus && t.lastStatus !== "ok" ? <p className="task-row-error">{t.lastError}</p> : lastRunText(t) && <p className="task-row-history">{lastRunText(t)}</p>}
                </div>
                <div className="task-row-actions">
                  {t.chatId && <button type="button" onClick={() => open(t.chatId!)} className="task-results"><MessageSquare size={15} />Результаты</button>}
                  <button type="button" onClick={() => void act(t.id, "run")} disabled={busy !== null} title="Запустить сейчас" aria-label={`Запустить сейчас: ${t.title}`} className="workspace-icon-button">
                    {busy === `run:${t.id}` ? <LoaderCircle size={17} className="animate-spin" /> : <RefreshCw size={17} />}
                  </button>
                  {(t.active || t.schedule.kind !== "once") && <button type="button" onClick={() => void act(t.id, t.active ? "pause" : "resume")} disabled={busy !== null} title={t.active ? "Пауза" : "Возобновить"} aria-label={`${t.active ? "Пауза" : "Возобновить"}: ${t.title}`} className="workspace-icon-button">{t.active ? <Pause size={17} /> : <Play size={17} />}</button>}
                  <button type="button" onClick={() => confirm(`Удалить задачу «${t.title}»? Результаты останутся в чате.`) && void act(t.id, "delete")} disabled={busy !== null} title="Удалить" aria-label={`Удалить: ${t.title}`} className="workspace-icon-button task-delete"><Trash2 size={17} /></button>
                </div>
              </article>
            ))}
          </div>
        </section>
        <p className="section-footnote">Каждый запуск считается одним сообщением. Задачи выполняются, пока сайт открыт, и при ежедневной фоновой проверке. Время доставки может отличаться от расписания.</p>
      </div>
    </div>
  );
}
