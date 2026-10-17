"use client";

import { ArrowUpRight, MessageSquare, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { uid } from "@/lib/client/util";
import { useModels } from "@/lib/client/useModels";
import type { Assistant } from "@/lib/types";
import { useApp } from "./AppState";
import { ModelPicker } from "./ModelPicker";
import { PageHeading } from "./Design";

type Draft = Omit<Assistant, "id" | "createdAt"> & { id?: string; createdAt?: number };

const TEMPLATES: Draft[] = [
  {
    emoji: "👨‍💻",
    name: "Программист",
    description: "Пишет, объясняет и исправляет код",
    systemPrompt:
      "Ты — опытный senior-разработчик. Пишешь чистый, рабочий код с краткими пояснениями. " +
      "Сначала уточняй требования, если они неоднозначны. Указывай язык в блоках кода. " +
      "Объясняй причины ошибок и предлагай лучшие практики.",
  },
  {
    emoji: "🌍",
    name: "Переводчик",
    description: "Точный перевод с сохранением стиля",
    systemPrompt:
      "Ты — профессиональный переводчик. Переводи текст пользователя: с русского на английский, " +
      "с любого другого языка — на русский. Сохраняй стиль, тон и форматирование. " +
      "Выводи только перевод, без комментариев, если пользователь не попросил иначе.",
  },
  {
    emoji: "✍️",
    name: "Копирайтер",
    description: "Тексты для соцсетей, сайтов и рекламы",
    systemPrompt:
      "Ты — сильный копирайтер и маркетолог. Пишешь живые, цепляющие тексты без воды и штампов. " +
      "Уточняй целевую аудиторию и площадку. Предлагай 2–3 варианта заголовков.",
  },
  {
    emoji: "🇬🇧",
    name: "Репетитор английского",
    description: "Разговорная практика с исправлением ошибок",
    systemPrompt:
      "Ты — дружелюбный репетитор английского языка. Общайся с учеником на английском на его уровне. " +
      "После каждой реплики ученика коротко исправляй ошибки (на русском) и продолжай диалог вопросом.",
  },
  {
    emoji: "📊",
    name: "Бизнес-аналитик",
    description: "Идеи, стратегии, юнит-экономика",
    systemPrompt:
      "Ты — бизнес-аналитик и стратег. Помогаешь продумывать бизнес-идеи, считать юнит-экономику, " +
      "оценивать рынок и риски. Отвечай структурно: выводы, цифры, следующие шаги.",
  },
  {
    emoji: "👨‍🍳",
    name: "Шеф-повар",
    description: "Рецепты из того, что есть в холодильнике",
    systemPrompt:
      "Ты — шеф-повар. Предлагаешь рецепты из продуктов, которые есть у пользователя. " +
      "Пиши список ингредиентов с количеством и пошаговый рецепт со временем приготовления.",
  },
];

const EMPTY: Draft = { emoji: "🤖", name: "", description: "", systemPrompt: "" };

function Editor({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const app = useApp();
  const { data, loading } = useModels("chat");
  const [form, setForm] = useState<Draft>(draft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = form.name.trim() && form.systemPrompt.trim();

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      await app.saveAssistant({
        ...form,
        id: form.id ?? uid(),
        createdAt: form.createdAt ?? Date.now(),
        name: form.name.trim(),
        emoji: form.emoji.trim() || "🤖",
        description: form.description.trim(),
        systemPrompt: form.systemPrompt.trim(),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
      setSaving(false);
    }
  };

  const field = "w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-400/50";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
      <div role="dialog" aria-modal="true" aria-label={form.id ? "Редактировать ассистента" : "Новый ассистент"} className="model-popover max-h-[95dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-violet-300/20 p-6 sm:rounded-3xl sm:p-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{form.id ? "Редактировать" : "Новый ассистент"}</h2>
          <button type="button" onClick={onClose} aria-label="Закрыть редактор" className="rounded-lg p-1 text-zinc-400 hover:bg-white/5 hover:text-zinc-100">
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="flex gap-3">
            <label className="w-20">
              <span className="mb-1 block text-xs text-zinc-400">Иконка</span>
              <input
                value={form.emoji}
                onChange={(e) => setForm({ ...form, emoji: e.target.value })}
                className={`${field} text-center text-lg`}
                maxLength={4}
              />
            </label>
            <label className="flex-1">
              <span className="mb-1 block text-xs text-zinc-400">Название</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Например: Мой маркетолог"
                className={field}
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">Короткое описание</span>
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Что умеет этот ассистент"
              className={field}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">
              Инструкция — кто он, как себя ведёт, что знает
            </span>
            <textarea
              value={form.systemPrompt}
              onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
              rows={8}
              placeholder="Ты — эксперт по… Отвечай кратко и по делу. Всегда…"
              className={`${field} resize-y`}
            />
          </label>

          {/* Only MARYX is offered: an assistant always answers with it. */}
          {!app.maryxOnly && <div>
            <span className="mb-1 block text-xs text-zinc-400">Модель</span>
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30">
              <ModelPicker
                models={data?.models ?? []}
                loading={loading}
                value={form.provider && form.model ? { provider: form.provider, model: form.model } : null}
                onChange={(c) => setForm({ ...form, provider: c.provider, model: c.model })}
              />
              {form.model ? (
                <button
                  type="button"
                  onClick={() => setForm({ ...form, provider: undefined, model: undefined })}
                  className="ml-auto mr-3 text-xs text-zinc-500 hover:text-zinc-200"
                >
                  сбросить
                </button>
              ) : (
                <span className="text-xs text-zinc-500">не выбрана — будет использоваться текущая</span>
              )}
            </div>
          </div>}
        </div>

        {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-zinc-300 hover:bg-white/5"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!valid || saving}
            className="maryx-button rounded-xl px-5 py-2.5 text-sm"
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

export function AssistantsView() {
  const app = useApp();
  const router = useRouter();
  const [editing, setEditing] = useState<Draft | null>(null);

  const chatWith = (id: string) => {
    app.startChatWith(id);
    router.push("/");
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="page-content">
        <PageHeading number="04" eyebrow="Ваша персональная команда" title="Мои ассистенты" description={app.maryxOnly ? "Для каждой задачи — свой подход. Задайте характер и знания вашему ИИ." : "Для каждой задачи — свой подход. Задайте характер, знания и любимую модель вашему ИИ."}>
          <button
            type="button"
            onClick={() => setEditing(EMPTY)}
            className="maryx-button flex items-center gap-2 rounded-xl px-4 py-3 text-[13px]"
          >
            <Plus className="size-4" /> Создать ассистента
          </button>
        </PageHeading>

        {app.assistants.length > 0 && (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {app.assistants.map((a) => (
              <div key={a.id} className="surface-card flex flex-col rounded-2xl p-5">
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-xl">
                    {a.emoji}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium text-zinc-100">{a.name}</div>
                    <div className="line-clamp-2 text-xs text-zinc-500">{a.description || a.systemPrompt}</div>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => chatWith(a.id)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/5 py-2 text-sm text-zinc-100 hover:bg-white/10"
                  >
                    <MessageSquare className="size-4" /> Чат
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(a)}
                    title="Изменить"
                    className="rounded-xl p-2 text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Удалить ассистента «${a.name}»?`)) {
                        app.deleteAssistant(a.id).catch((e) => alert(e instanceof Error ? e.message : e));
                      }
                    }}
                    title="Удалить"
                    className="rounded-xl p-2 text-zinc-400 hover:bg-white/5 hover:text-red-300"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <h2 className="mb-3 mt-10 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Шаблоны — нажмите, чтобы настроить под себя
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TEMPLATES.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => setEditing(t)}
              className="suggestion-card flex items-start gap-4 rounded-2xl p-5 text-left"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-xl">
                {t.emoji}
              </div>
              <div className="min-w-0">
                <div className="font-medium text-zinc-200">{t.name}</div>
                <div className="mt-1 text-xs leading-5 text-zinc-500">{t.description}</div>
                <div className="mt-4 flex items-center gap-1.5 text-[11px] text-violet-300">Настроить ассистента <ArrowUpRight className="size-3" aria-hidden="true" /></div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {editing && <Editor draft={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
