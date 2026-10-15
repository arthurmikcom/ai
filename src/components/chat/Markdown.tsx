"use client";

import { lazy, memo, Suspense } from "react";
import { MarkdownBody } from "./markdownParts";

// Formulas need KaTeX (a few hundred KB), so it loads only for answers that have them.
const MathMarkdown = lazy(() => import("./MathMarkdown"));

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
