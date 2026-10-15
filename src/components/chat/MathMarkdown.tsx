"use client";

import "katex/dist/katex.min.css";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { MarkdownBody } from "./markdownParts";

/** Fenced code (``` or ~~~, closed by the same fence) and inline code: left untouched. */
const CODE = /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\1[`~]*[ \t]*(?=\n|$)|(?![\s\S]))|`[^`\n]*`/gm;

/**
 * A formula in dollars, by Pandoc's rule: $$…$$, or $…$ where the opening $
 * has no digit before it and a non-space after it, and the closing $ has a
 * non-space before it and no digit after it. So "$5 или $10", "20$/мес",
 * "$HOME и $PATH" stay text, while "$2 + 3 = 5$" and "$x$" are formulas.
 */
const DOLLAR_MATH = /\$\$[\s\S]+?\$\$|(?<![\d\\])\$(?=[^\s$])(?:\\.|[^$\\\n])*?[^\s\\]\$(?!\d)|(?<![\d\\])\$[^\s$\\]\$(?!\d)/g;

const BRACKET_MATH = /(?<!\\)\\\[([\s\S]+?)(?<!\\)\\\]/g;

/** Mid-line \[…\] is math only if it looks like TeX ("источник \[1\]" is an escaped bracket). */
const TEX_HINT = /[\\^_=+{}<>]/;

function convert(text: string): string {
  const delimited = text
    .replace(BRACKET_MATH, (m: string, f: string, at: number, all: string) => {
      const prefix = all.slice(all.lastIndexOf("\n", at - 1) + 1, at);
      const after = all.slice(at + m.length);
      const rest = after.slice(0, after.includes("\n") ? after.indexOf("\n") : undefined);
      // Inside a sentence, table cell or list line: inline, without breaking the line.
      if (!/^[ \t>]*$/.test(prefix) || !/^[ \t]*$/.test(rest)) {
        return TEX_HINT.test(f) ? `$$${f.trim().replace(/\s*\n\s*/g, " ")}$$` : m;
      }
      // On lines of its own: display math, with the line's indentation or quote marker
      // on every fence line, so the formula stays in its list item or quote.
      const lines = f.split("\n");
      let body = lines.length > 1 && !lines[0].trim() ? f.slice(lines[0].length + 1) : prefix + f.trimStart();
      if (lines.length > 1 && /^[ \t>]*$/.test(lines[lines.length - 1])) body = body.slice(0, body.lastIndexOf("\n"));
      return `$$\n${body.trimEnd()}\n${prefix}$$`;
    })
    .replace(/(?<!\\)\\\(([\s\S]+?)\\\)/g, (_, f: string) => `$${f.trim()}$`);
  // Every dollar that isn't part of a formula is a literal one.
  let out = "";
  let last = 0;
  for (const m of delimited.matchAll(DOLLAR_MATH)) {
    out += delimited.slice(last, m.index).replace(/(?<!\\)\$/g, "\\$") + m[0];
    last = m.index + m[0].length;
  }
  return out + delimited.slice(last).replace(/(?<!\\)\$/g, "\\$");
}

/**
 * Models write formulas as $…$ and $$…$$, or as \(…\) and \[…\]; the parser
 * knows only dollars, and prices must not turn into formulas. Code is left as is.
 */
export function normalizeMath(text: string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(CODE)) {
    out += convert(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + convert(text.slice(last));
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
