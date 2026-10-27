"use client";

import { useEffect, useRef, useState } from "react";
import { del, request } from "./types";

type Scope = "corpus" | "company";

export function ManageCompany({ companyId, legalName, onDeleted }: {
  companyId: string;
  legalName: string;
  onDeleted: (scope: Scope, message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [corpusConfirmation, setCorpusConfirmation] = useState("");
  const [companyConfirmation, setCompanyConfirmation] = useState("");
  const [working, setWorking] = useState<Scope | null>(null);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open && !dialog.current?.open) {
      dialog.current?.showModal();
      dialog.current?.querySelector<HTMLElement>("h2")?.focus();
    }
  }, [open]);

  function close() {
    dialog.current?.close();
    setOpen(false);
    setError("");
    setCorpusConfirmation("");
    setCompanyConfirmation("");
    requestAnimationFrame(() => trigger.current?.focus());
  }

  async function remove(scope: Scope) {
    setWorking(scope);
    setError("");
    try {
      const confirmation = scope === "corpus" ? corpusConfirmation : companyConfirmation;
      const result = await request<{ message: string }>(
        `/api/v1/companies/${companyId}${scope === "corpus" ? "/corpus" : ""}`,
        del({ confirmation }),
      );
      dialog.current?.close();
      setOpen(false);
      onDeleted(scope, result.message);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setWorking(null);
    }
  }

  return (
    <>
      <button ref={trigger} onClick={() => setOpen(true)}>Manage</button>
      {open && (
        <dialog ref={dialog} className="manage-company-dialog" aria-labelledby="manage-company-title"
          onClose={() => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); }}>
          <header className="dialog-heading">
            <div><p>Data controls</p><h2 id="manage-company-title" tabIndex={-1}>Manage {legalName}</h2></div>
            <button className="icon-button" aria-label="Close company management" onClick={close}>×</button>
          </header>
          <div className="manage-company-body">
            <p className="manage-intro">These actions permanently remove saved research data. Active processing is cancelled as part of deletion.</p>
            <section>
              <h3>Delete evidence corpus</h3>
              <p>Removes filings, source documents, extracted passages, embeddings, financial facts, and answer history. The company stays in your library and can be ingested again.</p>
              <label>Type <strong>DELETE CORPUS</strong> to confirm
                <input value={corpusConfirmation} onChange={(event) => setCorpusConfirmation(event.target.value)} autoComplete="off" />
              </label>
              <button className="danger-button" disabled={working !== null || corpusConfirmation !== "DELETE CORPUS"}
                onClick={() => void remove("corpus")}>{working === "corpus" ? "Deleting evidence…" : "Delete evidence corpus"}</button>
            </section>
            <section>
              <h3>Delete company</h3>
              <p>Removes the company from your library together with its complete evidence corpus and research history.</p>
              <label>Type <strong>{legalName}</strong> to confirm
                <input value={companyConfirmation} onChange={(event) => setCompanyConfirmation(event.target.value)} autoComplete="off" />
              </label>
              <button className="danger-button" disabled={working !== null || companyConfirmation !== legalName}
                onClick={() => void remove("company")}>{working === "company" ? "Deleting company…" : "Delete company"}</button>
            </section>
            {error && <p className="form-error" role="alert">{error}</p>}
          </div>
        </dialog>
      )}
    </>
  );
}
