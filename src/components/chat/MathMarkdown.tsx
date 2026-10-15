"use client";

import "katex/dist/katex.min.css";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { MarkdownBody } from "./markdownParts";

/**
 * Models write formulas as $…$ and $$…$$, or as \(…\) and \[…\]; the parser
 * knows only dollars. Code is left as is, and a dollar before a plain number
 * ("$5 или $10") is a price, not the start of a formula.
 */
export function normalizeMath(text: string): string {
  return text
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/\\\[([\s\S]+?)\\\]/g, (_, f: string) => `\n$$\n${f.trim()}\n$$\n`)
            .replace(/\\\(([\s\S]+?)\\\)/g, (_, f: string) => `$${f.trim()}$`)
            .replace(/(^|[^\\$])\$(?=\d+(?:[.,]\d+)*(?:[\s,.;:!?)]|$))/gm, "$1\\$"),
    )
    .join("");
}

export default function MathMarkdown({ text }: { text: string }) {
  return (
    <MarkdownBody
      text={normalizeMath(text)}
      remark={[remarkMath]}
      rehype={[[rehypeKatex, { throwOnError: false, strict: "ignore" }]]}
    />
  );
}
