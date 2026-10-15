"use client";

import { lazy, memo, Suspense } from "react";
import { MarkdownBody } from "./markdownParts";

// Formulas need KaTeX (a few hundred KB), so it loads only for answers that have them.
// If that chunk can't load (bad network, a redeploy while the tab is open), formulas
// stay plain text instead of taking the page down.
const MathMarkdown = lazy(() =>
  import("./MathMarkdown").catch(() => ({ default: ({ text }: { text: string }) => <MarkdownBody text={text} /> })),
);

/** Looks like LaTeX: $$…$$, \(…\), \[…\] or $…$ on one line. */
const MATH_HINT = /\$\$|\\\(|\\\[|\$[^$\n]+\$/;

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  if (!MATH_HINT.test(text)) return <MarkdownBody text={text} />;
  return (
    <Suspense fallback={<MarkdownBody text={text} />}>
      <MathMarkdown text={text} />
    </Suspense>
  );
});
