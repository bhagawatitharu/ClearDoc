import { useEffect, useRef, useState } from "react";
import { createQuickSummary } from "./quickSummary.js";
import { readDocumentFile } from "./documentReader.js";
import {
  deleteDocument as deleteLocalDocument,
  getSetting,
  listDocuments,
  saveDocument,
  setSetting,
} from "./documentStorage.js";
import "./App.css";

let openingLocalLibrary;

async function loadLocalLibrary() {
  let migratedCount = 0;

  // The existing desktop version stored records through its local backend.
  // During development, move those records into this browser once, if available.
  if (import.meta.env.DEV && !(await getSetting("legacy-library-migrated"))) {
    let response;
    try {
      response = await fetch("/api/documents", { cache: "no-store" });
    } catch {
      // The browser library remains usable if the optional old backend is off.
    }

    if (response?.ok) {
      const legacyDocuments = await response.json();
      if (Array.isArray(legacyDocuments)) {
        for (const document of legacyDocuments) {
          if (document?.id && typeof document.text === "string") {
            await saveDocument(document);
            migratedCount += 1;
          }
        }
        await setSetting("legacy-library-migrated", true);
      }
    }
  }

  return { documents: await listDocuments(), migratedCount };
}

function openLocalLibrary() {
  if (!openingLocalLibrary) {
    openingLocalLibrary = loadLocalLibrary().finally(() => {
      openingLocalLibrary = null;
    });
  }
  return openingLocalLibrary;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatImportedAt(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function OverviewSection({ title, items }) {
  if (!items.length) return null;

  return (
    <section className="overview-group">
      <h4>{title}</h4>
      <ul>
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function App() {
  const [file, setFile] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [activeDocumentId, setActiveDocumentId] = useState(null);
  const [quickSummaries, setQuickSummaries] = useState({});
  const [loading, setLoading] = useState(false);
  const [savingHighlights, setSavingHighlights] = useState(false);
  const [removingDocumentId, setRemovingDocumentId] = useState(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [isInstalled, setIsInstalled] = useState(
    () =>
      window.matchMedia?.("(display-mode: standalone)").matches ||
      window.navigator.standalone === true,
  );
  const fileInputRef = useRef(null);

  useEffect(() => {
    let isCurrent = true;

    async function loadWorkspace() {
      try {
        const { documents: savedDocuments, migratedCount } =
          await openLocalLibrary();
        if (!isCurrent) return;

        setDocuments(savedDocuments);
        setActiveDocumentId(savedDocuments[0]?.id ?? null);
        setQuickSummaries(
          Object.fromEntries(
            savedDocuments
              .filter((document) => document.summary)
              .map((document) => [document.id, document.summary]),
          ),
        );
        if (migratedCount > 0) {
          setStatus(
            `Copied ${migratedCount} saved document${migratedCount === 1 ? "" : "s"} into this browser.`,
          );
        }
      } catch (loadError) {
        if (!isCurrent) return;
        setWorkspaceError(
          loadError.message || "Could not open the local document library.",
        );
      } finally {
        if (isCurrent) setWorkspaceLoading(false);
      }
    }

    loadWorkspace();
    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    function handleInstallAvailable(event) {
      event.preventDefault();
      setInstallPrompt(event);
    }

    function handleInstalled() {
      setInstallPrompt(null);
      setIsInstalled(true);
      setInstallHelpOpen(false);
      setStatus("ClearDoc was installed on this device.");
    }

    window.addEventListener("beforeinstallprompt", handleInstallAvailable);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallAvailable);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const activeDocument = documents.find(
    (document) => document.id === activeDocumentId,
  );
  const activeQuickSummary = activeDocument
    ? quickSummaries[activeDocument.id]
    : null;
  const hasQuickSummaryItems = activeQuickSummary
    ? Object.values(activeQuickSummary).some((items) => items.length > 0)
    : false;

  async function handleExtract(event) {
    event.preventDefault();

    if (workspaceLoading || workspaceError) {
      setError("The saved library must be available before adding documents.");
      return;
    }

    if (!file) {
      setError("Choose a PDF or TXT file to add it to your library.");
      return;
    }

    setLoading(true);
    setError("");
    setStatus("");

    try {
      const importedDocument = await readDocumentFile(file);
      await saveDocument(importedDocument);

      setDocuments((currentDocuments) => [
        importedDocument,
        ...currentDocuments,
      ]);
      setActiveDocumentId(importedDocument.id);
      setStatus(`${importedDocument.filename} was added to this device's library.`);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (requestError) {
      setError(requestError.message || "Could not read or save this file.");
    } finally {
      setLoading(false);
    }
  }

  async function removeDocument(documentId) {
    setRemovingDocumentId(documentId);
    setError("");
    setStatus("");

    try {
      const removedDocument = documents.find(
        (document) => document.id === documentId,
      );
      await deleteLocalDocument(documentId);
      const remainingDocuments = documents.filter(
        (document) => document.id !== documentId,
      );
      setDocuments(remainingDocuments);
      setQuickSummaries((currentSummaries) => {
        const nextSummaries = { ...currentSummaries };
        delete nextSummaries[documentId];
        return nextSummaries;
      });
      setActiveDocumentId((currentId) =>
        currentId === documentId ? remainingDocuments[0]?.id ?? null : currentId,
      );
      setStatus(`${removedDocument?.filename || "Document"} was removed from this browser's library.`);
    } catch (removeError) {
      setError(removeError.message || "Could not remove this document.");
    } finally {
      setRemovingDocumentId(null);
    }
  }

  async function handleCreateQuickSummary() {
    if (!activeDocument || savingHighlights) return;

    setSavingHighlights(true);
    setError("");
    setStatus("");

    try {
      const summary = createQuickSummary(activeDocument.text);
      await saveDocument({ ...activeDocument, summary });

      setQuickSummaries((currentSummaries) => ({
        ...currentSummaries,
        [activeDocument.id]: summary,
      }));
      setStatus("Document highlights were saved on this device.");
    } catch (summaryError) {
      setError(summaryError.message || "Could not save the highlights.");
    } finally {
      setSavingHighlights(false);
    }
  }

  async function handleInstallApp() {
    if (!installPrompt) {
      setInstallHelpOpen((isOpen) => !isOpen);
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice?.outcome === "accepted") {
      setInstallPrompt(null);
      setInstallHelpOpen(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="ClearDoc home">
          <span className="brand-mark" aria-hidden="true">
            C
          </span>
          <span className="brand-copy">
            <strong>ClearDoc</strong>
            <small>Private document workspace</small>
          </span>
        </a>
        <div className="topbar-actions">
          {!isInstalled && (
            <button
              className="install-button"
              type="button"
              onClick={handleInstallApp}
              aria-expanded={installHelpOpen}
            >
              Install app
            </button>
          )}
          <span className="privacy-badge">
            <span className="privacy-dot" aria-hidden="true" />
            Processed on this device
          </span>
        </div>
      </header>

      {installHelpOpen && (
        <section className="install-help" aria-label="Install ClearDoc" role="status">
          <div>
            <strong>Install ClearDoc</strong>
            <p>
              On Windows, use your browser&apos;s Install app option. On iPhone or
              iPad, tap Share in Safari, then Add to Home Screen. On Android,
              open the browser menu and choose Install app or Add to Home screen.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close install instructions"
            onClick={() => setInstallHelpOpen(false)}
          >
            ×
          </button>
        </section>
      )}

      <section className="intro" id="top">
        <p className="eyebrow">YOUR DOCUMENT WORKSPACE</p>
        <h1>A clearer view of what matters.</h1>
        <p className="intro-copy">
          Bring your PDFs and text files together, then choose any document to
          read its extracted text.
        </p>
      </section>

      <div className="workspace-grid">
        <aside className="workspace-sidebar" aria-label="Document library">
          <section className="panel import-panel">
            <div className="section-title">
              <span className="step-mark">01</span>
              <div>
                <h2>Add a document</h2>
                <p>PDF or plain text, up to 10 MB</p>
              </div>
            </div>

            <form onSubmit={handleExtract}>
              <label className="file-picker" htmlFor="document-upload">
                <span className="upload-symbol" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15.5v3A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-3" />
                  </svg>
                </span>
                <span className="file-picker-copy">
                  <strong>{file ? file.name : "Choose a file"}</strong>
                  <small>
                    {file ? formatBytes(file.size) : "Browse your device"}
                  </small>
                </span>
                <span className="file-picker-arrow" aria-hidden="true">
                  →
                </span>
                <input
                  ref={fileInputRef}
                  id="document-upload"
                  type="file"
                  accept=".pdf,.txt,application/pdf,text/plain"
                  disabled={loading || workspaceLoading || Boolean(workspaceError)}
                  onChange={(event) => {
                    setFile(event.target.files?.[0] || null);
                    setError("");
                  }}
                />
              </label>

              <button
                className="primary-button"
                type="submit"
                disabled={
                  !file || loading || workspaceLoading || Boolean(workspaceError)
                }
              >
                {workspaceLoading ? (
                  "Opening saved library…"
                ) : loading ? (
                  <>
                    <span className="spinner" aria-hidden="true" />
                    Reading document…
                  </>
                ) : (
                  "Add to workspace"
                )}
              </button>
            </form>

            {workspaceError && (
              <p className="error-message" role="alert">
                The local library is unavailable in this browser. {workspaceError}
              </p>
            )}
            {error && <p className="error-message" role="alert">{error}</p>}
            <p className="local-note">
              <span aria-hidden="true">⌂</span>
              Documents and highlights stay in this browser on this device.
            </p>
          </section>

          <section className="panel library-panel">
            <div className="library-heading">
              <div>
                <p className="eyebrow">YOUR LIBRARY</p>
                <h2>Documents</h2>
              </div>
              <span className="count-badge" aria-label={`${documents.length} documents`}>
                {documents.length}
              </span>
            </div>
            {status && <p className="success-message" role="status">{status}</p>}

            {workspaceLoading ? (
              <div className="library-empty">
                <strong>Opening your saved library…</strong>
              </div>
            ) : workspaceError ? (
              <div className="library-empty">
                <strong>Local library unavailable</strong>
                <span>Check browser storage, then reload.</span>
              </div>
            ) : documents.length === 0 ? (
              <div className="library-empty">
                <span className="empty-file-icon" aria-hidden="true">
                  <svg viewBox="0 0 32 32" fill="none">
                    <path d="M9 4.75h8.5L24 11.3v15.95H9a2 2 0 0 1-2-2v-18.5a2 2 0 0 1 2-2Z" />
                    <path d="M17 5v7h7M11.5 17h8M11.5 21h8" />
                  </svg>
                </span>
                <strong>Your library is ready</strong>
                <span>Add a document to see it here.</span>
              </div>
            ) : (
              <ul className="document-list">
                {documents.map((document) => {
                  const isActive = document.id === activeDocumentId;

                  return (
                    <li className={`document-row${isActive ? " is-active" : ""}`} key={document.id}>
                      <button
                        className="document-select"
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => setActiveDocumentId(document.id)}
                      >
                        <span className={`file-type-icon file-type-${document.fileType.toLowerCase()}`} aria-hidden="true">
                          {document.fileType === "PDF" ? "P" : "T"}
                        </span>
                        <span className="document-summary">
                          <strong title={document.filename}>{document.filename}</strong>
                          <small>
                            {formatImportedAt(document.importedAt)} · {formatBytes(document.fileSize)}
                          </small>
                        </span>
                      </button>
                      <button
                        className="remove-button"
                        type="button"
                        aria-label={`Remove ${document.filename} from this device`}
                        title="Remove saved document"
                        disabled={removingDocumentId === document.id}
                        onClick={() => removeDocument(document.id)}
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>

        <section className="panel reader-panel" aria-label="Document reader">
          {activeDocument ? (
            <>
              <div className="reader-header">
                <div className="reader-heading">
                  <p className="eyebrow">DOCUMENT VIEW</p>
                  <h2 title={activeDocument.filename}>{activeDocument.filename}</h2>
                  <div className="metadata-row">
                    <span className="type-tag">{activeDocument.fileType}</span>
                    <span>{activeDocument.characters.toLocaleString()} characters</span>
                    <span>{formatBytes(activeDocument.fileSize)}</span>
                  </div>
                </div>
                <span className="ready-badge">
                  <span aria-hidden="true">✓</span> Ready to read
                </span>
              </div>

              <div className="overview-actions">
                <button
                  className="summary-button"
                  type="button"
                  disabled={!activeDocument.text.trim() || savingHighlights}
                  onClick={handleCreateQuickSummary}
                >
                  <span aria-hidden="true">▤</span>
                  {savingHighlights
                    ? "Saving highlights…"
                    : activeQuickSummary
                      ? "Refresh highlights"
                      : "Create highlights"}
                </button>
                <span>Processed on this device</span>
              </div>

              {activeDocument.note && (
                <p className="document-note">{activeDocument.note}</p>
              )}

              {activeQuickSummary && (
                <section className="overview-card" aria-live="polite">
                  <div className="overview-heading">
                    <span className="overview-mark" aria-hidden="true">▤</span>
                    <div>
                      <p className="eyebrow">DOCUMENT HIGHLIGHTS</p>
                      <h3>Key details</h3>
                    </div>
                    <span className="overview-method">From this document</span>
                  </div>
                  {hasQuickSummaryItems ? (
                    <div className="overview-sections">
                      <OverviewSection title="Key points" items={activeQuickSummary.keyPoints} />
                      <OverviewSection title="Actions and requirements" items={activeQuickSummary.actionItems} />
                      <OverviewSection title="Dates and deadlines" items={activeQuickSummary.datesAndDeadlines} />
                      <OverviewSection title="Important figures" items={activeQuickSummary.keyFigures} />
                      <OverviewSection title="Contacts" items={activeQuickSummary.contacts} />
                    </div>
                  ) : (
                    <p className="overview-empty">
                      There is not enough readable text to identify useful details.
                    </p>
                  )}
                  <p className="overview-footnote">
                    These details are selected from your document. Review the extracted text below for context.
                  </p>
                </section>
              )}

              <div className="text-heading">
                <label htmlFor="document-text">Extracted text</label>
                <span>Imported {formatImportedAt(activeDocument.importedAt)}</span>
              </div>
              <textarea
                id="document-text"
                className="document-text"
                value={activeDocument.text}
                readOnly
                spellCheck={false}
                aria-label={`Extracted text from ${activeDocument.filename}`}
                placeholder="No readable text was found in this document."
              />
            </>
          ) : (
            <div className="reader-empty">
              <span className="reader-empty-art" aria-hidden="true">
                <svg viewBox="0 0 64 64" fill="none">
                  <rect x="12" y="9" width="32" height="42" rx="4" />
                  <path d="M22 22h13M22 29h13M22 36h7" />
                  <circle cx="44" cy="43" r="11" />
                  <path d="m52 51 6 6" />
                </svg>
              </span>
              <p className="eyebrow">READY WHEN YOU ARE</p>
              <h2>Your reading space</h2>
              <p>
                Add a document, or select one from your library, to view its
                extracted text here.
              </p>
            </div>
          )}
        </section>
      </div>

      <footer className="app-footer">
        <span>ClearDoc <span aria-hidden="true">·</span> Built for privacy</span>
        <span>
          Document details, extracted text, and highlights are saved in this
          browser on this device. They are not synced to your other devices.
          The original PDF or TXT file is not retained. Removing a document
          deletes this browser copy.
        </span>
      </footer>
    </main>
  );
}

export default App;
