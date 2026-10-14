"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { dateLabel, type Filing, type Hit, type Reader } from "./types";

type Props = {
  filing?: Filing;
  reader: Reader | null;
  error: string;
  hit?: Hit;
  start?: number;
  end?: number;
  onClose: () => void;
  onNext: (direction: number) => void;
  hasHits: boolean;
};

export function DocumentReader({
  filing,
  reader,
  error,
  hit,
  start,
  end,
  onClose,
  onNext,
  hasHits,
}: Props) {
  const [view, setView] = useState("both");
  const [ratio, setRatio] = useState(50);
  const [fontSize, setFontSize] = useState(16);
  const [evidence, setEvidence] = useState(false);
  const comparison = useRef<HTMLDivElement>(null);
  const extraction = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLElement>(null);
  useEffect(() => {
    if (window.innerWidth < 900) setView("extracted");
  }, []);
  useEffect(() => {
    mark.current?.scrollIntoView({ block: "center" });
  }, [reader, start, end, hit]);
  const selectedStart = hit?.start_offset ?? start;
  const selectedEnd = hit?.end_offset ?? end;
  const documentId = reader?.document.id ?? filing?.document_id;
  const segments = reader
    ? [
        ...(reader.sections[0]?.start_offset > 0
          ? [
              {
                id: "preamble",
                section_label: "Document opening",
                start_offset: 0,
                end_offset: reader.sections[0].start_offset,
              },
            ]
          : []),
        ...(reader.sections.length
          ? reader.sections
          : [
              {
                id: "document",
                section_label: "Document text",
                start_offset: 0,
                end_offset: reader.text.length,
              },
            ]),
      ]
    : [];

  function passage(from: number, to: number) {
    if (!reader) return null;
    if (
      selectedStart === undefined ||
      selectedEnd === undefined ||
      selectedEnd <= from ||
      selectedStart >= to
    )
      return reader.text.slice(from, to);
    const a = Math.max(from, selectedStart),
      b = Math.min(to, selectedEnd);
    return (
      <>
        {reader.text.slice(from, a)}
        <mark ref={mark}>{reader.text.slice(a, b)}</mark>
        {reader.text.slice(b, to)}
      </>
    );
  }

  return (
    <section className="document-workspace" aria-label="Document inspection">
      <header className="document-toolbar">
        <div>
          <span className="form-tag">
            {filing?.form_type ?? reader?.filing.formType ?? "Filing"}
          </span>
          <strong>
            {filing ? dateLabel(filing.filing_date) : "Source document"}
          </strong>
          <small>
            {filing?.accession_number ?? reader?.filing.accessionNumber}
          </small>
        </div>
        <div className="reader-actions">
          {hasHits && (
            <>
              <button
                onClick={() => onNext(-1)}
                aria-label="Previous search passage"
              >
                ‹
              </button>
              <button
                onClick={() => onNext(1)}
                aria-label="Next search passage"
              >
                ›
              </button>
            </>
          )}
          <button onClick={onClose} aria-label="Close document">
            ×
          </button>
        </div>
      </header>
      <div className="view-toolbar">
        <div className="segmented" aria-label="Document display">
          {["both", "original", "extracted"].map((item) => (
            <button
              key={item}
              aria-pressed={view === item}
              onClick={() => setView(item)}
            >
              {item === "both"
                ? "Compare"
                : item === "original"
                  ? "Original"
                  : "Extracted"}
            </button>
          ))}
        </div>
        <div className="reader-actions">
          <button
            onClick={() => setFontSize(Math.max(12, fontSize - 1))}
            aria-label="Smaller extraction text"
          >
            A−
          </button>
          <button
            onClick={() => setFontSize(Math.min(24, fontSize + 1))}
            aria-label="Larger extraction text"
          >
            A+
          </button>
          <button
            aria-pressed={evidence}
            onClick={() => setEvidence(!evidence)}
          >
            Evidence details
          </button>
        </div>
      </div>
      <div
        className={`comparison view-${view}`}
        ref={comparison}
        style={{ "--source-share": `${ratio}%` } as CSSProperties}
      >
        <section className="source-pane">
          <div className="pane-caption">
            <strong>Original source</strong>
            {(reader?.document.secUrl ?? filing?.sec_url) && (
              <a
                href={reader?.document.secUrl ?? filing?.sec_url ?? undefined}
                target="_blank"
                rel="noreferrer"
              >
                Open at SEC ↗
              </a>
            )}
          </div>
          {documentId ? (
            <iframe
              key={`${documentId}-${reader?.document.textHash}`}
              title="Preserved original SEC filing"
              sandbox=""
              referrerPolicy="no-referrer"
              src={`/api/v1/documents/${documentId}/source${reader?.document.sourceHash ? `?contentHash=${reader.document.sourceHash}` : ""}`}
            />
          ) : (
            <div className="reader-empty">
              The original source has not been preserved yet.
            </div>
          )}
          <small className="pane-footnote">
            Preserved filing. Scripts and external assets are blocked.
          </small>
        </section>
        <div
          className="pane-divider"
          role="separator"
          aria-label="Resize document panes"
          aria-orientation="vertical"
          aria-valuemin={25}
          aria-valuemax={75}
          aria-valuenow={ratio}
          tabIndex={0}
          onKeyDown={(event) => {
            if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
              event.preventDefault();
              setRatio(
                Math.max(
                  25,
                  Math.min(75, ratio + (event.key === "ArrowLeft" ? -5 : 5)),
                ),
              );
            }
          }}
          onPointerDown={(event) =>
            event.currentTarget.setPointerCapture(event.pointerId)
          }
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              const box = comparison.current!.getBoundingClientRect();
              setRatio(
                Math.max(
                  25,
                  Math.min(75, ((event.clientX - box.left) / box.width) * 100),
                ),
              );
            }
          }}
        />
        <section className="extraction-pane">
          <div className="pane-caption">
            <strong>Extracted evidence</strong>
            <span>
              {reader ? `${reader.sections.length} section${reader.sections.length === 1 ? "" : "s"}` : "Pending"}
            </span>
          </div>
          {reader && (
            <nav className="section-jump" aria-label="Filing sections">
              <label>
                Jump to section
                <select
                  defaultValue=""
                  onChange={(event) =>
                    extraction.current
                      ?.querySelector(`[data-section="${event.target.value}"]`)
                      ?.scrollIntoView({ block: "start" })
                  }
                >
                  <option value="">Choose a section</option>
                  {segments.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.section_label}
                    </option>
                  ))}
                </select>
              </label>
            </nav>
          )}
          <div
            className="extracted-scroll"
            ref={extraction}
            style={{ fontSize }}
            tabIndex={0}
            aria-label="Extracted filing text"
          >
            {error ? (
              <div className="reader-empty" role="alert">
                {error}
              </div>
            ) : !reader ? (
              <div className="reader-empty">Loading extracted evidence…</div>
            ) : (
              segments.map((section) => (
                <section key={section.id} data-section={section.id}>
                  <h3>{section.section_label}</h3>
                  <pre>{passage(section.start_offset, section.end_offset)}</pre>
                </section>
              ))
            )}
          </div>
          <small className="pane-footnote">
            Normalized text used for indexing. Highlight shows the retrieved
            passage.
          </small>
        </section>
      </div>
      {evidence && (
        <aside className="evidence-drawer">
          <header>
            <strong>Evidence record</strong>
            <button
              aria-label="Close evidence details"
              onClick={() => setEvidence(false)}
            >
              ×
            </button>
          </header>
          <dl>
            <dt>Parser</dt>
            <dd>{reader?.document.parserVersion ?? "Not available"}</dd>
            <dt>Normalized text hash</dt>
            <dd>{reader?.document.textHash ?? "Not available"}</dd>
            <dt>Selected range</dt>
            <dd>
              {selectedStart !== undefined
                ? `${selectedStart}–${selectedEnd} characters`
                : "No retrieved passage selected"}
            </dd>
          </dl>
          {hit && (
            <>
              <h3>Indexed passage</h3>
              <pre>{hit.chunk_text}</pre>
            </>
          )}
          {reader?.document.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </aside>
      )}
    </section>
  );
}
