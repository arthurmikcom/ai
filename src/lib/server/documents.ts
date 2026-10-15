// Documents attached in chat (PDF, Word, Excel, CSV, plain text). We pull the
// text out on the server and give it to the model as part of the message, so
// documents work with every model, not only those that read PDFs natively.

/** Document types users can attach, with a short label for errors. */
export const DOCUMENT_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
  "application/vnd.ms-excel": "Excel",
  "text/csv": "CSV",
  "text/plain": "текст",
  "text/markdown": "Markdown",
  "application/json": "JSON",
};

export function isDocumentMime(mime: string): boolean {
  return mime in DOCUMENT_TYPES;
}

/** Longest text we keep from one document (about a 1,000-page book). */
const MAX_STORED_CHARS = 2_000_000;

/** Raised when a file can't be read; the message is shown to the user. */
export class DocumentError extends Error {}

function decodeText(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    // Old Russian files are often in Windows-1251.
    return new TextDecoder("windows-1251").decode(buf);
  }
}

async function pdfText(buf: Buffer): Promise<string> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

async function docxText(buf: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return value;
}

async function sheetText(buf: Buffer): Promise<string> {
  const XLSX = await import("@e965/xlsx");
  const book = XLSX.read(buf, { type: "buffer" });
  return book.SheetNames.map((name) => {
    const csv = XLSX.utils.sheet_to_csv(book.Sheets[name], { blankrows: false });
    return `## Лист «${name}»\n${csv}`;
  }).join("\n\n");
}

/** The text of a document, or a DocumentError explaining why there is none. */
export async function extractDocumentText(buf: Buffer, mime: string, name: string): Promise<string> {
  let text: string;
  try {
    if (mime === "application/pdf") text = await pdfText(buf);
    else if (mime.includes("wordprocessingml")) text = await docxText(buf);
    else if (mime.includes("spreadsheetml") || mime === "application/vnd.ms-excel") text = await sheetText(buf);
    else text = decodeText(buf);
  } catch (err) {
    console.error("[documents] extraction failed", mime, err);
    throw new DocumentError(`Не удалось прочитать файл «${name}». Возможно, он повреждён или защищён паролем.`);
  }
  text = text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) {
    throw new DocumentError(
      mime === "application/pdf"
        ? `В файле «${name}» нет текста — похоже, это скан. Пришлите его как изображение или текстовый PDF.`
        : `Файл «${name}» пустой.`,
    );
  }
  return text.length > MAX_STORED_CHARS ? text.slice(0, MAX_STORED_CHARS) : text;
}

/** Keeps the start and the end of a long text (the middle is usually least needed). */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.7);
  const tail = max - head;
  const cut = text.length - head - tail;
  return `${text.slice(0, head)}\n\n[… пропущено ${cut.toLocaleString("ru-RU")} символов …]\n\n${text.slice(-tail)}`;
}

/**
 * Documents wrapped for the model, before the user's question (long inputs
 * work best with the documents first and the question last). `budget` is
 * the number of characters all these documents may take together.
 */
export function withDocuments(question: string, docs: { name: string; text: string }[], budget: number): string {
  if (docs.length === 0) return question;
  const total = docs.reduce((sum, d) => sum + d.text.length, 0);
  const blocks = docs.map((d, i) => {
    // Share the budget in proportion to size, so one huge file doesn't crowd out the rest.
    const share = total > budget ? Math.max(2000, Math.floor((budget * d.text.length) / total)) : d.text.length;
    return `<document index="${i + 1}">\n<source>${d.name.replace(/[<>]/g, "")}</source>\n<document_content>\n${shorten(d.text, share)}\n</document_content>\n</document>`;
  });
  return `<documents>\n${blocks.join("\n")}\n</documents>\n\n${question || "Кратко перескажи этот документ."}`;
}
