const DATABASE_NAME = "cleardoc-library";
const DATABASE_VERSION = 1;
const DOCUMENT_STORE = "documents";
const SETTINGS_STORE = "settings";

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("This browser does not support local document storage."));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DOCUMENT_STORE)) {
        database.createObjectStore(DOCUMENT_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
        database.createObjectStore(SETTINGS_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open the local library."));
    request.onblocked = () => reject(new Error("Close other ClearDoc tabs and try again."));
  });
}

async function transact(storeName, mode, createRequest) {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    let transaction;
    let value;

    try {
      transaction = database.transaction(storeName, mode);
      const request = createRequest(transaction.objectStore(storeName));

      if (request) {
        request.onsuccess = () => {
          value = request.result;
        };
        request.onerror = () => {
          reject(request.error || new Error("The local library request failed."));
        };
      }

      transaction.oncomplete = () => {
        database.close();
        resolve(value);
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error || new Error("Could not update the local library."));
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error || new Error("The local library update was cancelled."));
      };
    } catch (error) {
      database.close();
      reject(error);
    }
  });
}

export async function listDocuments() {
  const documents = await transact(DOCUMENT_STORE, "readonly", (store) => store.getAll());
  return (documents || []).sort(
    (first, second) =>
      new Date(second.importedAt).getTime() - new Date(first.importedAt).getTime(),
  );
}

export async function saveDocument(document) {
  await transact(DOCUMENT_STORE, "readwrite", (store) => store.put(document));
  return document;
}

export function deleteDocument(documentId) {
  return transact(DOCUMENT_STORE, "readwrite", (store) => store.delete(documentId));
}

export function getSetting(key) {
  return transact(SETTINGS_STORE, "readonly", (store) => store.get(key));
}

export function setSetting(key, value) {
  return transact(SETTINGS_STORE, "readwrite", (store) => store.put(value, key));
}
