"use client";

import { useId, type ReactNode } from "react";

/** Shared visual elements; no account, provider or application state. */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-mark ${className}`} aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path d="M16 3 28 16 16 29 4 16 16 3Z" stroke="currentColor" strokeWidth="1.6" />
        <path d="m16 8 7 8-7 8-7-8 7-8Z" stroke="currentColor" strokeWidth="1.6" />
        <path d="M16 3v26M4 16h24" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    </span>
  );
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
            <stop stopColor="#7d63ff" /><stop offset=".32" stopColor="#33187c" /><stop offset=".7" stopColor="#160b36" /><stop offset="1" stopColor="#070511" />
          </radialGradient>
          <linearGradient id={`${id}-ribbon`} x1="70" y1="65" x2="390" y2="340" gradientUnits="userSpaceOnUse">
            <stop stopColor="#292582" /><stop offset=".2" stopColor="#6852ff" /><stop offset=".37" stopColor="#d4a3ff" /><stop offset=".49" stopColor="#803bf0" /><stop offset=".68" stopColor="#3b1888" /><stop offset=".84" stopColor="#b66bff" /><stop offset="1" stopColor="#342073" />
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
  return (
    <header className="page-heading">
      <div className="page-eyebrow"><span>{number}</span>{eyebrow}</div>
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
