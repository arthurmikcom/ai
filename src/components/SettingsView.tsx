"use client";

import { CircleCheck, Circle, ExternalLink, Lock, Trash2 } from "lucide-react";
import { useState } from "react";
import { assistantDB, chatDB, mediaDB } from "@/lib/client/db";
import { useModels } from "@/lib/client/useModels";
import type { Capability } from "@/lib/types";

const CAPABILITY_LABEL: Record<Capability, string> = {
  chat: "чат",
  image: "изображения",
  video: "видео",
};

export function SettingsView() {
  const { data, error } = useModels("all");
  const [clearing, setClearing] = useState(false);

  const counts = new Map<string, number>();
  for (const m of data?.models ?? []) counts.set(m.provider, (counts.get(m.provider) ?? 0) + 1);

  const clearAll = async () => {
    if (!confirm("Удалить все чаты, ассистентов и сгенерированные файлы из этого браузера?")) return;
    setClearing(true);
    await Promise.all([chatDB.clear(), assistantDB.clear(), mediaDB.clear()]);
    location.reload();
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-14 md:pt-8">
        <h1 className="text-2xl font-semibold text-zinc-100">Настройки</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Ключи провайдеров хранятся только на сервере, в файле{" "}
          <code className="rounded bg-white/10 px-1">.env.local</code>, и никогда не попадают в браузер.
        </p>

        <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Провайдеры моделей
        </h2>
        {error && <p className="text-sm text-red-300">Не удалось получить статус: {error}</p>}
        <div className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10">
          {(data?.providers ?? []).map((p) => (
            <div key={p.id} className="flex items-start gap-3 bg-zinc-900 p-4">
              {p.configured ? (
                <CircleCheck className="mt-0.5 size-5 shrink-0 text-emerald-400" />
              ) : (
                <Circle className="mt-0.5 size-5 shrink-0 text-zinc-600" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="font-medium text-zinc-100">{p.name}</span>
                  <span className="text-xs text-zinc-500">
                    {p.capabilities.map((c) => CAPABILITY_LABEL[c]).join(" · ")}
                  </span>
                </div>
                <div className="text-sm text-zinc-400">{p.note}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <code className="rounded bg-white/5 px-1.5 py-0.5 text-zinc-300">{p.envVar}</code>
                  {p.configured ? (
                    <span className="text-emerald-300">
                      подключён{counts.get(p.id) ? ` · моделей: ${counts.get(p.id)}` : ""}
                    </span>
                  ) : (
                    <a
                      href={p.signupUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-violet-300 hover:text-violet-200"
                    >
                      {p.id === "ollama" ? "Скачать Ollama" : "Получить ключ"} <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
          {!data && !error && <div className="bg-zinc-900 p-4 text-sm text-zinc-500">Загрузка…</div>}
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-zinc-900 p-4 text-sm text-zinc-300">
          <div className="mb-2 font-medium text-zinc-100">Как подключить провайдера</div>
          <ol className="list-decimal space-y-1 pl-5 text-zinc-400">
            <li>
              Скопируйте <code className="rounded bg-white/10 px-1">.env.example</code> в{" "}
              <code className="rounded bg-white/10 px-1">.env.local</code>.
            </li>
            <li>Вставьте ключ нужного провайдера (достаточно одного).</li>
            <li>
              Перезапустите сервер: <code className="rounded bg-white/10 px-1">npm run dev</code>.
            </li>
          </ol>
        </div>

        <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Безопасность
        </h2>
        <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-zinc-900 p-4 text-sm text-zinc-400">
          <Lock className="mt-0.5 size-5 shrink-0 text-zinc-500" />
          <div>
            Перед публикацией в интернет задайте <code className="rounded bg-white/10 px-1">APP_PASSWORD</code> в
            переменных окружения — тогда сайт будет спрашивать пароль, и посторонние не потратят ваши деньги
            на API.
          </div>
        </div>

        <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-zinc-500">Данные</h2>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-zinc-900 p-4 text-sm text-zinc-400">
          <span>Чаты, ассистенты и файлы хранятся локально в этом браузере (IndexedDB).</span>
          <button
            type="button"
            onClick={clearAll}
            disabled={clearing}
            className="flex items-center gap-2 rounded-xl border border-red-500/30 px-3 py-1.5 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
          >
            <Trash2 className="size-4" /> Очистить всё
          </button>
        </div>
      </div>
    </div>
  );
}
