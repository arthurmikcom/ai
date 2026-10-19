"use client";

import Image from "next/image";
import { ArrowUpRight, Layers3, Sparkles } from "@/components/MaryxIcons";
import type { ReactNode } from "react";
import gallery from "./assets/studio-gallery.png";
import finalArtwork from "./assets/maryx-final.png";

export function StudioImage({ className = "", preload = false }: { className?: string; preload?: boolean }) {
  return (
    <div className={`studio-image ${className}`} aria-hidden="true">
      <Image src={finalArtwork} alt="" fill sizes="(max-width: 767px) 100vw, 1200px" placeholder="blur" preload={preload} draggable={false} />
    </div>
  );
}

export function CreativeHero({ eyebrow, title, description, children, compact = false }: {
  eyebrow: string;
  title: ReactNode;
  description: ReactNode;
  children?: ReactNode;
  compact?: boolean;
}) {
  const Heading = compact ? "h2" : "h1";
  return (
    <section className={`creative-hero ${compact ? "creative-hero--compact" : ""}`}>
      <StudioImage preload={!compact} />
      <div className="creative-hero-shade" />
      <div className="creative-hero-copy">
        <div className="creative-eyebrow"><span className="creative-dot" />{eyebrow}</div>
        <Heading>{title}</Heading>
        <p>{description}</p>
        {children}
      </div>
      <div className="creative-hero-signature" aria-hidden="true"><Layers3 size={13} /> Пространство идей</div>
    </section>
  );
}

/** Original artwork for prompt examples; each card shows one quadrant of the collection. */
export function PromptArtwork({ variant = "portal" }: { variant?: "portal" | "bloom" | "orbit" | "landscape" }) {
  return (
    <div className={`prompt-art prompt-art--${variant}`} aria-hidden="true">
      <div style={{ position: "absolute", width: "200%", height: "200%", left: variant === "orbit" || variant === "landscape" ? "-100%" : 0, top: variant === "bloom" || variant === "landscape" ? "-100%" : 0 }}>
        <Image src={gallery} alt="" fill sizes="(max-width: 767px) 100vw, 700px" placeholder="blur" draggable={false} style={{ objectFit: "fill" }} />
      </div>
    </div>
  );
}

export function WorkspaceCallout({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <div className="workspace-callout"><div className="workspace-callout-icon"><Sparkles size={18} /></div><div><strong>{title}</strong><p>{description}</p></div>{children && <div className="workspace-callout-action">{children}<ArrowUpRight size={15} aria-hidden="true" /></div>}</div>;
}
