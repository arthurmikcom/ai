"use client";

import { ImagePlus, LoaderCircle, Plus, UserRound, X } from "@/components/MaryxIcons";
import { useRef, useState } from "react";
import { addCharacter, removeCharacter } from "@/lib/client/characters";
import { imageToAttachment, MAX_TOTAL_BASE64 } from "@/lib/client/util";
import type { Attachment, Character } from "@/lib/types";

/** Photos of one character (the server keeps the same limit). */
const MAX_PHOTOS = 3;

interface Props {
  characters: Character[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * «Мой персонаж» (like Soul on Higgsfield): a person saved once from 1–3
 * photos, then drawn in any scene. Picking one turns the studio into a
 * photoshoot of that person.
 */
export function Characters({ characters, selected, onSelect }: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [photos, setPhotos] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reset = () => {
    setAdding(false);
    setName("");
    setPhotos([]);
    setError(null);
  };

  const addPhotos = async (files: File[]) => {
    setError(null);
    const images = files.filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    const room = MAX_PHOTOS - photos.length;
    const problems: string[] = [];
    if (images.length < files.length) problems.push("Можно загрузить только фото (JPEG, PNG, WebP, HEIC).");
    if (images.length > room) problems.push(`Достаточно ${MAX_PHOTOS} фото.`);
    let total = photos.reduce((sum, p) => sum + (p.data?.length ?? 0), 0);
    const added: Attachment[] = [];
    setBusy(true);
    for (const file of images.slice(0, Math.max(0, room))) {
      try {
        const photo = await imageToAttachment(file);
        if (total + (photo.data?.length ?? 0) > MAX_TOTAL_BASE64) {
          problems.push("Фото слишком большие: всего до 3 МБ.");
          continue;
        }
        total += photo.data?.length ?? 0;
        added.push(photo);
      } catch {
        problems.push(`Не удалось прочитать «${file.name}» — сохраните его как JPEG или PNG.`);
      }
    }
    setBusy(false);
    setPhotos((list) => [...list, ...added]);
    if (problems.length) setError([...new Set(problems)].join(" "));
  };

  const save = async () => {
    if (!name.trim() || !photos.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const made = await addCharacter(name.trim(), photos.map((p) => ({ mime: p.mime, data: p.data! })));
      reset();
      onSelect(made.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const remove = (c: Character) => {
    if (!confirm(`Удалить персонажа «${c.name}»? Его фото удалятся, готовые картинки останутся.`)) return;
    if (selected === c.id) onSelect(null);
    removeCharacter(c.id).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <section aria-label="Мой персонаж" className="surface-card mt-6 rounded-3xl p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
          <UserRound className="size-4 text-violet-300" /> Мой персонаж
        </div>
        <p className="text-xs text-zinc-500">Загрузите 1–3 фото человека один раз — и MARYX нарисует его в любой сцене.</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {characters.map((c) => (
          <div key={c.id} className="group relative">
            <button
              type="button"
              aria-pressed={selected === c.id}
              onClick={() => onSelect(selected === c.id ? null : c.id)}
              title={selected === c.id ? "Выключить фотосессию" : `Фотосессия: ${c.name}`}
              className={`flex items-center gap-2 rounded-2xl border py-1.5 pl-1.5 pr-3 text-sm transition ${
                selected === c.id
                  ? "border-violet-300/60 bg-violet-500/20 text-violet-50"
                  : "border-white/10 bg-white/[0.03] text-zinc-300 hover:border-violet-300/40 hover:text-zinc-100"
              }`}
            >
              {c.photos[0] ? (
                // eslint-disable-next-line @next/next/no-img-element -- the user's private file
                <img src={c.photos[0].url} alt="" className="size-8 rounded-xl object-cover" />
              ) : (
                <UserRound className="size-8 rounded-xl bg-white/5 p-1.5" />
              )}
              {c.name}
            </button>
            <button
              type="button"
              onClick={() => remove(c)}
              title="Удалить персонажа"
              aria-label={`Удалить персонажа ${c.name}`}
              className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-zinc-700 p-0.5 text-zinc-200 hover:bg-zinc-600 group-hover:block group-focus-within:block"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 rounded-2xl border border-dashed border-violet-300/30 px-3 py-2 text-sm text-violet-200 transition hover:border-violet-300/60 hover:bg-violet-500/10"
          >
            <Plus className="size-4" /> {characters.length ? "Новый персонаж" : "Добавить себя"}
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              autoFocus
              placeholder="Имя: например, Я, Аня, Макс"
              aria-label="Имя персонажа"
              className="min-w-0 flex-1 rounded-xl bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 sm:max-w-64"
            />
            {photos.map((p, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                <img src={`data:${p.mime};base64,${p.data}`} alt={`Фото ${i + 1}`} className="size-12 rounded-xl object-cover" />
                <button
                  type="button"
                  onClick={() => setPhotos((list) => list.filter((_, j) => j !== i))}
                  title="Убрать фото"
                  aria-label="Убрать фото"
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-zinc-700 p-0.5 text-zinc-200 hover:bg-zinc-600"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*,.heic,.heif"
                  multiple
                  hidden
                  onChange={(e) => {
                    void addPhotos([...(e.target.files ?? [])]);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={busy}
                  className="flex size-12 items-center justify-center rounded-xl border border-dashed border-white/15 text-zinc-400 transition hover:border-violet-300/50 hover:text-violet-200 disabled:opacity-40"
                  title="Добавить фото человека"
                  aria-label="Добавить фото человека"
                >
                  {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                </button>
              </>
            )}
          </div>
          <p className="mt-2 text-xs leading-5 text-zinc-500">
            Лучше всего: лицо крупно и хорошо освещено, без очков и масок, 2–3 разных ракурса. Фото видите только вы.
          </p>
          {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={!name.trim() || !photos.length || busy}
              className="maryx-button rounded-xl px-4 py-2 text-sm"
            >
              {busy && photos.length ? "Сохраняю…" : "Сохранить персонажа"}
            </button>
            <button type="button" onClick={reset} className="rounded-xl px-3 py-2 text-sm text-zinc-400 hover:text-zinc-100">
              Отмена
            </button>
          </div>
        </div>
      )}
      {!adding && error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </section>
  );
}
