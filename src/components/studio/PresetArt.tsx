// A tiny animated scene that shows what a camera move or an effect does (the
// studio's preset cards): a hero at dusk, hills and a sun, moved by CSS alone.

const PARTICLES = Array.from({ length: 10 }, (_, i) => i);

export function PresetArt({ motion, effect, live = false }: { motion?: string; effect?: string; live?: boolean }) {
  return (
    <span className="preset-art" data-motion={motion} data-effect={effect} data-live={live || undefined} aria-hidden="true">
      <span className="pa-world">
        <span className="pa-sky" />
        <span className="pa-sun" />
        <span className="pa-far" />
        <span className="pa-near" />
        <span className="pa-hero">
          <span className="pa-head" />
        </span>
      </span>
      <span className="pa-fx">
        <span className="pa-glow" />
        {PARTICLES.map((i) => (
          <span key={i} className="pa-p" style={{ ["--i" as string]: i }} />
        ))}
      </span>
      <span className="pa-frame" />
    </span>
  );
}
