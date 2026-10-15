// Documents attached in chat (PDF, Word, Excel, CSV, plain text). We pull the
// text out on the server and give it to the model as part of the message, so
// documents work with every model, not only those that read PDFs natively.

import { Unzip, UnzipInflate } from "fflate";

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

// Limits against crafted files: Word and Excel files are zip archives that can
// inflate a thousandfold, and a spreadsheet can claim a million-row range.
const MAX_UNZIPPED_BYTES = 25 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2000;
const MAX_SHEETS = 20;
const MAX_SHEET_ROWS = 5000;
const MAX_SHEET_COLUMNS = 100;
const MAX_PDF_PAGES = 500;
const PDF_TIME_BUDGET_MS = 20_000;

/** Raised when a file can't be read; the message is shown to the user. */
export class DocumentError extends Error {}

/** A file that breaks our safety limits (not a user mistake, so no refund). */
export class DocumentLimitError extends DocumentError {}

/** Inflates a zip in memory only to count bytes, giving up past the limits. */
function checkZip(buf: Buffer, name: string): void {
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) {
    throw new DocumentError(`Файл «${name}» повреждён или это не документ Office.`);
  }
  const tooBig = () => new DocumentLimitError(`Файл «${name}» слишком сложный: внутри больше 25 МБ данных.`);
  let total = 0;
  let entries = 0;
  let failure: Error | null = null;
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    if (failure) return;
    if (++entries > MAX_ZIP_ENTRIES) {
      failure = tooBig();
      return;
    }
    file.ondata = (err, chunk) => {
      if (failure) return;
      if (err) failure = new DocumentError(`Не удалось прочитать файл «${name}».`);
      total += chunk?.length ?? 0;
      if (total > MAX_UNZIPPED_BYTES) {
        failure = tooBig();
        file.terminate();
      }
    };
    file.start();
  };
  unzip.push(new Uint8Array(buf), true);
  if (failure) throw failure;
}

function decodeText(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    // Old Russian files are often in Windows-1251.
    return new TextDecoder("windows-1251").decode(buf);
  }
}

async function pdfText(buf: Buffer): Promise<string> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  // Page by page, within a page count, length and time budget.
  const started = Date.now();
  let text = "";
  for (let i = 1; i <= Math.min(pdf.numPages, MAX_PDF_PAGES); i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if ("str" in item) text += item.str + (item.hasEOL ? "\n" : "");
    }
    text += "\n\n";
    if (text.length > MAX_STORED_CHARS || Date.now() - started > PDF_TIME_BUDGET_MS) break;
  }
  return text;
}

async function docxText(buf: Buffer, name: string): Promise<string> {
  checkZip(buf, name);
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return value;
}

async function sheetText(buf: Buffer, name: string): Promise<string> {
  // .xlsx is a zip; legacy .xls is a different (binary) format.
  if (buf.readUInt32LE(0) === 0x04034b50) checkZip(buf, name);
  const XLSX = await import("@e965/xlsx");
  const book = XLSX.read(buf, {
    type: "buffer",
    sheetRows: MAX_SHEET_ROWS,
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
  });
  const parts: string[] = [];
  let length = 0;
  for (const sheetName of book.SheetNames.slice(0, MAX_SHEETS)) {
    const sheet = book.Sheets[sheetName];
    // The declared range can be huge even for an almost empty sheet; clamp it.
    if (sheet["!ref"]) {
      const range = XLSX.utils.decode_range(sheet["!ref"]);
      range.e.r = Math.min(range.e.r, range.s.r + MAX_SHEET_ROWS - 1);
      range.e.c = Math.min(range.e.c, range.s.c + MAX_SHEET_COLUMNS - 1);
      sheet["!ref"] = XLSX.utils.encode_range(range);
    }
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    parts.push(`## Лист «${sheetName}»\n${csv}`);
    length += csv.length;
    if (length > MAX_STORED_CHARS) break;
  }
  return parts.join("\n\n");
}

/** The text of a document, or a DocumentError explaining why there is none. */
export async function extractDocumentText(buf: Buffer, mime: string, name: string): Promise<string> {
  let text: string;
  try {
    if (mime === "application/pdf") text = await pdfText(buf);
    else if (mime.includes("wordprocessingml")) text = await docxText(buf, name);
    else if (mime.includes("spreadsheetml") || mime === "application/vnd.ms-excel") text = await sheetText(buf, name);
    else text = decodeText(buf);
  } catch (err) {
    if (err instanceof DocumentError) throw err;
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
 * work best with the documents first and the question last). Each document
 * is cut to its `max` characters; with `max` 0 only a note that it was left
 * out remains.
 */
export function withDocuments(question: string, docs: { name: string; text: string; max: number }[]): string {
  if (docs.length === 0) return question;
  const blocks = docs.map((d, i) => {
    const content =
      d.max > 0 ? shorten(d.text, d.max) : "[Документ был в начале диалога, но не поместился в контекст. Попросите пользователя прислать его снова, если он нужен.]";
    return `<document index="${i + 1}">\n<source>${d.name.replace(/[<>]/g, "")}</source>\n<document_content>\n${content}\n</document_content>\n</document>`;
  });
  return `<documents>\n${blocks.join("\n")}\n</documents>\n\n${question || "Кратко перескажи этот документ."}`;
}
