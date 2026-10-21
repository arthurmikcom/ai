import * as Clipboard from "expo-clipboard";
import { Fragment, type ReactNode } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { C, mono } from "@/lib/theme";

// MARYX answers in Markdown. This draws what answers use — headings, lists,
// quotes, code, tables, bold, italics, links — with the app's own components.

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "code"; lang: string; text: string }
  | { type: "table"; rows: string[][] }
  | { type: "rule" };

function parse(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```(\S*)/);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      blocks.push({ type: "code", lang: fence[1], text: code.join("\n") });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      blocks.push({ type: "table", rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ type: "quote", text: quote.join("\n") });
      continue;
    }
    const bullet = /^\s*[-*+]\s+/;
    const number = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || number.test(line)) {
      const ordered = number.test(line);
      const marker = ordered ? number : bullet;
      const items: string[] = [];
      while (i < lines.length && (marker.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (marker.test(lines[i])) items.push(lines[i].replace(marker, ""));
        else items[items.length - 1] += ` ${lines[i].trim()}`;
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*```|\s*>|\s*[-*+]\s+|\s*\d+[.)]\s+|\s*\|)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    blocks.push({ type: "paragraph", text: para.join("\n") });
  }
  return blocks;
}

/** Bold, italics, `code` and links inside a line. */
function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const k = `${key}-${n++}`;
    if (token.startsWith("**") || token.startsWith("__")) out.push(<Text key={k} style={s.bold}>{inline(token.slice(2, -2), k)}</Text>);
    else if (token.startsWith("`")) out.push(<Text key={k} style={s.inlineCode}>{token.slice(1, -1)}</Text>);
    else if (token.startsWith("[")) {
      const link = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      const url = link?.[2] ?? "";
      out.push(
        <Text key={k} style={s.link} onPress={() => /^https?:\/\//.test(url) && void Linking.openURL(url)}>
          {link?.[1] ?? token}
        </Text>,
      );
    } else out.push(<Text key={k} style={s.italic}>{inline(token.slice(1, -1), k)}</Text>);
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  return (
    <View style={s.code}>
      <View style={s.codeHead}>
        <Text style={s.codeLang}>{lang || "код"}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Копировать код" onPress={() => void Clipboard.setStringAsync(text)} hitSlop={8}>
          <Text style={s.codeCopy}>Копировать</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text selectable style={s.codeText}>
          {text}
        </Text>
      </ScrollView>
    </View>
  );
}

export function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const blocks = parse(text);
  return (
    <View style={{ gap: 10 }}>
      {blocks.map((b, i) => {
        const caret = streaming && i === blocks.length - 1 ? <Text style={s.caret}> ▍</Text> : null;
        switch (b.type) {
          case "heading":
            return (
              <Text key={i} selectable style={[s.heading, b.level <= 1 ? s.h1 : b.level === 2 ? s.h2 : s.h3]}>
                {inline(b.text, `h${i}`)}
                {caret}
              </Text>
            );
          case "list":
            return (
              <View key={i} style={{ gap: 6 }}>
                {b.items.map((item, j) => (
                  <View key={j} style={s.item}>
                    <Text style={s.marker}>{b.ordered ? `${j + 1}.` : "•"}</Text>
                    <Text selectable style={[s.text, { flex: 1 }]}>
                      {inline(item, `l${i}-${j}`)}
                      {j === b.items.length - 1 ? caret : null}
                    </Text>
                  </View>
                ))}
              </View>
            );
          case "quote":
            return (
              <View key={i} style={s.quote}>
                <Text selectable style={[s.text, { color: C.muted }]}>
                  {inline(b.text, `q${i}`)}
                  {caret}
                </Text>
              </View>
            );
          case "code":
            return <CodeBlock key={i} lang={b.lang} text={b.text} />;
          case "table":
            return (
              <ScrollView key={i} horizontal showsHorizontalScrollIndicator={false}>
                <View style={s.table}>
                  {b.rows.map((row, r) => (
                    <View key={r} style={[s.row, r === 0 && s.headRow]}>
                      {row.map((cell, c) => (
                        <Text key={c} selectable style={[s.cell, r === 0 && s.bold]}>
                          {inline(cell, `t${i}-${r}-${c}`)}
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            );
          case "rule":
            return <View key={i} style={s.rule} />;
          default:
            return (
              <Text key={i} selectable style={s.text}>
                {b.text.split("\n").map((part, j, all) => (
                  <Fragment key={j}>
                    {inline(part, `p${i}-${j}`)}
                    {j < all.length - 1 ? "\n" : null}
                  </Fragment>
                ))}
                {caret}
              </Text>
            );
        }
      })}
      {blocks.length === 0 && streaming && <Text style={s.caret}>▍</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  text: { color: C.text, fontSize: 16, lineHeight: 24 },
  heading: { color: C.text, fontWeight: "700", marginTop: 4 },
  h1: { fontSize: 22, lineHeight: 28 },
  h2: { fontSize: 19, lineHeight: 26 },
  h3: { fontSize: 17, lineHeight: 24 },
  bold: { fontWeight: "700", color: C.text },
  italic: { fontStyle: "italic" },
  link: { color: C.accentText, textDecorationLine: "underline" },
  inlineCode: { fontFamily: mono, fontSize: 14, color: C.accentText, backgroundColor: C.surface2 },
  item: { flexDirection: "row", gap: 8, paddingLeft: 4 },
  marker: { color: C.accentText, fontSize: 16, lineHeight: 24, minWidth: 16 },
  quote: { borderLeftWidth: 3, borderLeftColor: C.accent, paddingLeft: 12 },
  code: { backgroundColor: "#0f0e17", borderRadius: 12, borderWidth: 1, borderColor: C.line, overflow: "hidden" },
  codeHead: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line },
  codeLang: { color: C.faint, fontSize: 12 },
  codeCopy: { color: C.accentText, fontSize: 12 },
  codeText: { fontFamily: mono, fontSize: 13, lineHeight: 19, color: "#e4e4e7", padding: 12 },
  table: { borderWidth: 1, borderColor: C.line, borderRadius: 10, overflow: "hidden" },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.line },
  headRow: { backgroundColor: C.surface2 },
  cell: { color: C.text, fontSize: 14, lineHeight: 20, padding: 8, minWidth: 110, maxWidth: 220 },
  rule: { height: 1, backgroundColor: C.line, marginVertical: 4 },
  caret: { color: C.accentText },
});
