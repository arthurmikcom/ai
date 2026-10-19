"use client";

import { useId, type ReactNode } from "react";
import { Bot, CalendarClock, Clapperboard, Gem, Image, MapIcon, Settings, Sparkles, type MaryxIconType } from "./MaryxIcons";

const HEADING_ICONS: Record<string, MaryxIconType> = { "02": Image, "03": Clapperboard, "04": Bot, "05": Gem, "06": Settings, "07": CalendarClock, "08": MapIcon };

/** Shared visual elements; no account, provider or application state. */
export function BrandMark({ className = "" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <span className={`brand-mark ${className}`} aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none" focusable="false">
        <defs>
          <radialGradient id={`${id}-core`} cx=".3" cy=".2" r=".85"><stop stopColor="#8f8cff" /><stop offset=".5" stopColor="#5d16cc" /><stop offset="1" stopColor="#16083c" /></radialGradient>
          <linearGradient id={`${id}-orbit`} x1="5" y1="3" x2="25" y2="29" gradientUnits="userSpaceOnUse"><stop stopColor="#bceaff" /><stop offset=".3" stopColor="#7365ff" /><stop offset=".65" stopColor="#ed7cff" /><stop offset="1" stopColor="#7967ff" /></linearGradient>
        </defs>
        <circle cx="16" cy="16" r="9.5" fill={`url(#${id}-core)`} />
        <g stroke={`url(#${id}-orbit)`} strokeWidth="2.3">
          <ellipse cx="16" cy="16" rx="13" ry="7.2" transform="rotate(-40 16 16)" />
          <ellipse cx="16" cy="16" rx="12.8" ry="7.2" transform="rotate(43 16 16)" />
        </g>
        <path d="M10 8c4-3 9-2 12 1M22 24c-4 3-9 2-12-1" stroke="#f2d7ff" strokeWidth=".8" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function BrandName({ className = "" }: { className?: string }) {
  return <span className={`brand-wordmark ${className}`}>MARYX <span>Ai</span></span>;
}

export function OrbitArt({ className = "" }: { className?: string }) {
  return (
    <div className={`orbit-art ${className}`} aria-hidden="true">
      <MaryxVisual />
    </div>
  );
}

export function MaryxVisual() {
  const id = useId().replace(/:/g, "");
  return (
    <div className="maryx-orb" aria-hidden="true">
      <svg viewBox="0 0 480 400" fill="none">
        <defs>
          <radialGradient id={`${id}-ball`} cx=".3" cy=".2" r=".9">
            <stop stopColor="#899cff" /><stop offset=".32" stopColor="#4a1dd4" /><stop offset=".7" stopColor="#230956" /><stop offset="1" stopColor="#070511" />
          </radialGradient>
          <linearGradient id={`${id}-ribbon`} x1="70" y1="65" x2="390" y2="340" gradientUnits="userSpaceOnUse">
            <stop stopColor="#3029a2" /><stop offset=".2" stopColor="#6957ff" /><stop offset=".37" stopColor="#e6c0ff" /><stop offset=".49" stopColor="#ac31ff" /><stop offset=".68" stopColor="#4012aa" /><stop offset=".84" stopColor="#f177ff" /><stop offset="1" stopColor="#3d2494" />
          </linearGradient>
          <linearGradient id={`${id}-shine`} x1="120" y1="70" x2="340" y2="280" gradientUnits="userSpaceOnUse">
            <stop stopColor="#c4d7ff" /><stop offset=".3" stopColor="#edcaff" /><stop offset=".65" stopColor="#ae6fff" /><stop offset="1" stopColor="#4932b1" stopOpacity=".3" />
          </linearGradient>
          <radialGradient id={`${id}-halo`}><stop stopColor="#853afa" stopOpacity=".4" /><stop offset="1" stopColor="#853afa" stopOpacity="0" /></radialGradient>
          <filter id={`${id}-blur`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10" /></filter>
        </defs>
        <ellipse cx="244" cy="230" rx="206" ry="155" fill={`url(#${id}-halo)`} />
        <g opacity=".55" filter={`url(#${id}-blur)`}>
          <ellipse cx="244" cy="196" rx="143" ry="86" transform="rotate(-42 244 196)" stroke="#7f39fa" strokeWidth="26" />
          <ellipse cx="244" cy="196" rx="143" ry="86" transform="rotate(43 244 196)" stroke="#6142fe" strokeWidth="26" />
        </g>
        <circle cx="244" cy="196" r="107" fill={`url(#${id}-ball)`} stroke="#8e56f9" strokeOpacity=".35" />
        <ellipse cx="244" cy="196" rx="145" ry="88" transform="rotate(-42 244 196)" stroke={`url(#${id}-ribbon)`} strokeWidth="24" />
        <ellipse cx="244" cy="196" rx="145" ry="88" transform="rotate(-42 244 196)" stroke={`url(#${id}-shine)`} strokeWidth="1.5" />
        <ellipse cx="244" cy="196" rx="147" ry="82" transform="rotate(43 244 196)" stroke={`url(#${id}-ribbon)`} strokeWidth="29" />
        <ellipse cx="244" cy="196" rx="147" ry="82" transform="rotate(43 244 196)" stroke={`url(#${id}-shine)`} strokeWidth="2" />
        <ellipse cx="244" cy="196" rx="132" ry="88" transform="rotate(94 244 196)" stroke={`url(#${id}-ribbon)`} strokeWidth="15" />
        <ellipse cx="244" cy="196" rx="132" ry="88" transform="rotate(94 244 196)" stroke={`url(#${id}-shine)`} strokeWidth="1.5" />
        <path d="M116 157c17-51 83-82 139-58M310 289c30-16 51-46 52-78" stroke="#ead5ff" strokeWidth="2" strokeLinecap="round" opacity=".55" />
        <g fill="#c4b5fd">
          <circle cx="78" cy="111" r="2" /><circle cx="399" cy="83" r="1.5" /><circle cx="411" cy="263" r="2" /><circle cx="87" cy="291" r="1.5" /><circle cx="328" cy="347" r="2" /><circle cx="164" cy="52" r="1.5" />
        </g>
      </svg>
    </div>
  );
}

export function PageHeading({ number, eyebrow, title, description, children }: {
  number: string;
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  const Icon = HEADING_ICONS[number] ?? Sparkles;
  return (
    <header className="page-heading">
      <div className="page-eyebrow"><span className="page-heading-symbol"><Icon size={21} /></span>{eyebrow}</div>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="max-w-2xl">
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {children}
      </div>
    </header>
  );
}
