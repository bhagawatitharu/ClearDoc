import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export function warmPdfWorker() {
  if (import.meta.env.PROD) {
    fetch(pdfWorkerUrl).catch(() => {});
  }
}

// Older Safari versions expose ReadableStream but do not make it async iterable.
// PDF.js uses stream iteration while extracting text, so add the standard adapter.
function supportSafariReadableStreams() {
  if (
    typeof ReadableStream === "undefined" ||
    Symbol.asyncIterator in ReadableStream.prototype
  ) {
    return;
  }

  Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, {
    configurable: true,
    value: async function* iterateReadableStream() {
      const reader = this.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  });
}

async function extractPdfText(file) {
  supportSafariReadableStreams();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
  });

  try {
    const pdf = await loadingTask.promise;
    const pageTexts = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => `${item.str || ""}${item.hasEOL ? "\n" : " "}`)
        .join("")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      if (pageText) pageTexts.push(pageText);
      page.cleanup();
    }

    await pdf.destroy();
    return pageTexts.join("\n\n");
  } catch (error) {
    await loadingTask.destroy().catch(() => {});
    throw error;
  }
}

export async function readDocumentFile(file) {
  if (!file) throw new Error("Choose a PDF or TXT file to add to your library.");
  if (file.size > MAX_FILE_SIZE) throw new Error("The file exceeds the 10 MB limit.");

  const extension = file.name.toLowerCase().split(".").pop();
  if (extension !== "pdf" && extension !== "txt") {
    throw new Error("Only PDF and TXT files are supported.");
  }

  const text = extension === "pdf" ? await extractPdfText(file) : await file.text();
  const document = {
    id: crypto.randomUUID(),
    filename: file.name,
    fileType: extension.toUpperCase(),
    fileSize: file.size,
    importedAt: new Date().toISOString(),
    characters: text.length,
    text,
    note: text.trim()
      ? null
      : "No readable text was found. Scanned PDFs may need text recognition.",
    summary: null,
  };

  return document;
}
