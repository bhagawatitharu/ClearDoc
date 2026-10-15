import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIRECTORY = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "data",
  "documents",
);
const DOCUMENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getDocumentPath(id) {
  if (!DOCUMENT_ID_PATTERN.test(id)) {
    throw new TypeError("Invalid document ID.");
  }

  return path.join(DATA_DIRECTORY, `${id}.json`);
}

export async function listDocuments() {
  let filenames;

  try {
    filenames = await readdir(DATA_DIRECTORY);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const documentFiles = filenames.filter((filename) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i.test(
      filename,
    ),
  );
  const documents = await Promise.all(
    documentFiles.map(async (filename) => {
      const contents = await readFile(
        path.join(DATA_DIRECTORY, filename),
        "utf8",
      );
      return JSON.parse(contents);
    }),
  );

  return documents.sort(
    (first, second) =>
      new Date(second.importedAt).getTime() -
      new Date(first.importedAt).getTime(),
  );
}

export async function getDocument(id) {
  try {
    const contents = await readFile(getDocumentPath(id), "utf8");
    return JSON.parse(contents);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function saveDocument(document) {
  const destination = getDocumentPath(document?.id);
  await mkdir(DATA_DIRECTORY, { recursive: true });

  const temporaryFile = path.join(
    DATA_DIRECTORY,
    `${document.id}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(temporaryFile, JSON.stringify(document), {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryFile, destination);
  } catch (error) {
    await rm(temporaryFile, { force: true }).catch(() => {});
    throw error;
  }

  return document;
}

export async function deleteDocument(id) {
  await rm(getDocumentPath(id), { force: true });
}
