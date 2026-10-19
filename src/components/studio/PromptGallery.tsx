"use client";

import { ArrowUpRight, Check, Lightbulb, Play } from "@/components/MaryxIcons";
import { useState } from "react";
import type { MediaKind } from "@/lib/types";
import { PromptArtwork } from "../WorkspaceVisuals";

const IDEAS = [
  { title: "Архитектура света", tag: "Архитектура", art: "portal" as const, image: "Минималистичный архитектурный павильон из белого бетона с большой круглой аркой, мягкий закатный свет, отражение в спокойной воде, редакционная архитектурная фотография, без текста", video: "Медленный кинематографичный пролёт камеры через круглую арку минималистичного павильона над водой на закате, мягкий свет, плавное движение, без текста" },
  { title: "За гранью реального", tag: "3D и предметы", art: "orbit" as const, image: "Скульптура из жидкого хрома и прозрачного фиолетового стекла, парящая над обсидиановым подиумом, студийные отражения, предметная съёмка, невероятная детализация, без текста", video: "Хромированная скульптура медленно вращается в тёмной студии, по её поверхности скользят лавандовые отражения, плавный наезд камеры, макросъёмка, без текста" },
  { title: "Цвет как настроение", tag: "Иллюстрация", art: "bloom" as const, image: "Абстрактный цветок из полупрозрачных коралловых и розовых лепестков, перламутровые блики, мягкая студийная подсветка, скульптурная композиция, современная арт-фотография, без текста", video: "Полупрозрачный коралловый цветок медленно раскрывается, лепестки подсвечены изнутри, воздушная атмосфера и очень плавное движение камеры, макросъёмка, без текста" },
  { title: "Кадр, в котором хочется остаться", tag: "Природа и кино", art: "landscape" as const, image: "Тихий горный пейзаж с зеркальным озером, синие горы в тумане и тёплый рассвет, кинематографичная цветокоррекция, тонкое плёночное зерно, фотореализм, без текста", video: "Рассвет над зеркальным горным озером, туман медленно плывёт между синими вершинами, камера плавно поднимается над водой, кинематографичная сцена со звуками природы, без текста" },
];

export function PromptGallery({ kind, prompt, disabled, onChoose }: { kind: MediaKind; prompt: string; disabled: boolean; onChoose: (prompt: string) => void }) {
  const [filter, setFilter] = useState("Все идеи");
  const tags = ["Все идеи", ...IDEAS.map(i => i.tag)];
  const shown = IDEAS.filter(i => filter === "Все идеи" || i.tag === filter);
  return (
    <section className="prompt-gallery" aria-label="Идеи для творчества">
      <div className="section-heading-row"><div><div className="workspace-kicker"><Lightbulb size={12} />Отправная точка</div><h2>Немного вдохновения. Много возможностей.</h2></div><span className="workspace-caption">Выберите идею и добавьте своё</span></div>
      <div className="workspace-filters" role="group" aria-label="Категории идей">{tags.map(tag => <button key={tag} type="button" onClick={() => setFilter(tag)} aria-pressed={tag === filter}>{tag}</button>)}</div>
      <div className="prompt-gallery-grid">
        {shown.map(idea => {
          const value = idea[kind];
          const selected = prompt === value;
          return <button className="prompt-poster" key={idea.title} type="button" disabled={disabled} aria-label={`Использовать идею: ${idea.title}`} aria-pressed={selected} onClick={() => onChoose(value)}>
            <div className="prompt-poster-picture"><PromptArtwork variant={idea.art} /><span className="prompt-poster-tag">{kind === "video" ? <Play size={11} /> : null}{idea.tag}</span><span className="prompt-poster-arrow">{selected ? <Check size={17} /> : <ArrowUpRight size={17} />}</span></div>
            <div className="prompt-poster-copy"><h3>{idea.title}</h3><p>{kind === "video" ? "Превратите идею в движение" : "Создайте собственную интерпретацию"}</p></div>
          </button>;
        })}
      </div>
    </section>
  );
}
