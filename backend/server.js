
import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import path from "node:path";
import {
  deleteDocument,
  getDocument,
  listDocuments,
  saveDocument,
} from "./documentStore.js";

const app = express();
const PORT = 3001;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUMMARY_FIELDS = [
  "keyPoints",
  "actionItems",
  "datesAndDeadlines",
  "keyFigures",
  "contacts",
];

function isValidSummary(summary) {
  return (
    summary &&
    typeof summary === "object" &&
    SUMMARY_FIELDS.every(
      (field) =>
        Array.isArray(summary[field]) &&
        summary[field].length <= 4 &&
        summary[field].every(
          (item) => typeof item === "string" && item.length <= 600,
        ),
    )
  );
}

app.use(express.json({ limit: "100kb" }));

// Keep uploaded files in memory, not on disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "ClearDoc",
    message: "Local backend is running."
  });
});

// Return the local library, including extracted text and saved highlights.
app.get("/api/documents", async (_req, res) => {
  return res.json(await listDocuments());
});

// Save refreshed highlights alongside the extracted document text.
app.put("/api/documents/:id/summary", async (req, res) => {
  const { id } = req.params;
  const { summary } = req.body ?? {};

  if (!UUID_PATTERN.test(id)) {
    return res.status(400).json({ error: "Invalid document ID." });
  }

  if (!isValidSummary(summary)) {
    return res.status(400).json({ error: "Invalid document highlights." });
  }

  const document = await getDocument(id);
  if (!document) {
    return res.status(404).json({ error: "Document not found." });
  }

  document.summary = summary;
  await saveDocument(document);
  return res.json({ success: true });
});

// Remove the document's saved text, metadata, and highlights from this device.
app.delete("/api/documents/:id", async (req, res) => {
  const { id } = req.params;

  if (!UUID_PATTERN.test(id)) {
    return res.status(400).json({ error: "Invalid document ID." });
  }

  await deleteDocument(id);
  return res.status(204).end();
});

// Extract text from PDF or TXT files.
app.post(
  "/api/documents/extract",
  upload.single("document"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: "Please select a PDF or TXT file."
        });
      }

      const extension = path
        .extname(req.file.originalname)
        .toLowerCase();

      if (![".pdf", ".txt"].includes(extension)) {
        return res.status(400).json({
          error: "Only PDF and TXT files are supported."
        });
      }

      let extractedText = "";

      if (extension === ".txt") {
        extractedText = req.file.buffer.toString("utf8");
      } else {
        // Check that the file begins with a PDF signature.
        if (req.file.buffer.subarray(0, 5).toString() !== "%PDF-") {
          return res.status(400).json({
            error: "This file does not appear to be a valid PDF."
          });
        }

        const result = await pdfParse(req.file.buffer);
        extractedText = result.text;
      }

      const document = {
        id: randomUUID(),
        filename: path.basename(req.file.originalname),
        fileType: extension.slice(1).toUpperCase(),
        fileSize: req.file.size,
        importedAt: new Date().toISOString(),
        characters: extractedText.length,
        text: extractedText,
        note: extractedText.trim()
          ? null
          : "No readable text was found. Scanned PDFs may need OCR.",
        summary: null,
      };

      try {
        await saveDocument(document);
      } catch (saveError) {
        console.error("Local document save failed:", saveError.message);
        return res.status(500).json({
          error:
            "The file was read, but ClearDoc could not save it on this device. Check the local data folder permissions and try again.",
        });
      }

      return res.status(201).json(document);
    } catch (error) {
      console.error("Document extraction failed:", error.message);

      return res.status(422).json({
        error: "Could not read this document. Check that the file is valid and try again."
      });
    }
  }
);

// Handle upload errors, including files that exceed the size limit.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "The file exceeds the 10 MB limit."
        : "The upload could not be processed.";

    return res.status(400).json({ error: message });
  }

  console.error("Server error:", err.message);
  return res.status(500).json({
    error: "An unexpected server error occurred."
  });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(
    `ClearDoc backend running at http://127.0.0.1:${PORT}`
  );
});
