"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { post, request, type AnswerCitation, type CorpusStatus, type GroundedAnswerResponse } from "./types";

type Statement = { statement: string; citations: string[] };

export function AskFilings({ companyId, companyName, onOpenCitation }: {
  companyId: string;
  companyName: string;
  onOpenCitation: (citation: AnswerCitation) => void;
}) {
  const [open, setOpen] = useState(false);
  const [corpus, setCorpus] = useState<CorpusStatus | null>(null);
  const [question, setQuestion] = useState("");
  const [askedQuestion, setAskedQuestion] = useState("");
  const [answer, setAnswer] = useState<GroundedAnswerResponse | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const lifetime = useRef<AbortController | null>(null);

  useEffect(() => {
    lifetime.current = new AbortController();
    return () => lifetime.current?.abort();
  }, []);

  const refresh = useCallback(async () => {
    const signal = lifetime.current?.signal;
    try {
      const result = await request<CorpusStatus>(`/api/v1/companies/${companyId}/corpus`, { signal });
      if (!signal?.aborted) setCorpus(result);
    } catch (reason) { if (!signal?.aborted) setError((reason as Error).message); }
  }, [companyId]);

  useEffect(() => {
    if (!open && !working) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(timer);
  }, [open, working, refresh]);

  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      dialog.current?.querySelector<HTMLElement>("h2")?.focus();
    }
  }, [open]);

  function close(restoreFocus = true) {
    dialog.current?.close();
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus());
  }

  async function ask() {
    if (working || !ready || question.trim().length < 2) return;
    const signal = lifetime.current?.signal;
    setWorking(true); setError(""); setAnswer(null); setAskedQuestion(question.trim());
    try {
      const result = await request<GroundedAnswerResponse>(`/api/v1/companies/${companyId}/questions`, { ...post({ question: question.trim() }), signal });
      if (!signal?.aborted) setAnswer(result);
    } catch (reason) { if (!signal?.aborted) setError((reason as Error).message); }
    finally { if (!signal?.aborted) setWorking(false); }
  }

  async function updateCorpus(action: "retry" | "approve") {
    const signal = lifetime.current?.signal;
    setWorking(true); setError("");
    try {
      await request(`/api/v1/companies/${companyId}/${action === "retry" ? "corpus/retry" : "embeddings/approve"}`,
        { ...post(action === "approve" ? corpus?.externalEmbeddingEstimate : {}), signal });
      if (!signal?.aborted) await refresh();
    } catch (reason) { if (!signal?.aborted) setError((reason as Error).message); }
    finally { if (!signal?.aborted) setWorking(false); }
  }

  function openSource(citation: AnswerCitation) {
    if (citation.kind === "chunk") {
      close(false);
      onOpenCitation(citation);
    } else {
      const source = dialog.current?.querySelector<HTMLDetailsElement>(`#answer-source-${citation.label}`);
      if (source) { source.open = true; source.scrollIntoView({ block: "nearest" }); source.querySelector("summary")?.focus(); }
    }
  }

  const ready = corpus?.readiness === "ready" || corpus?.readiness === "ready_with_exclusions";
  const citations = answer?.citations ?? [];
  const prose = (items: Statement[]) => items.map((item, index) => <p key={index}>{item.statement}<span className="inline-citations">{item.citations.map((label) => {
    const citation = citations.find((source) => source.label === label);
    return citation ? <button type="button" key={label} title={citation.text} aria-label={`Open source ${label}`} onClick={() => openSource(citation)}>{label}</button> : null;
  })}</span></p>);

  return <>
    <button className="ask-launch" ref={trigger} aria-haspopup="dialog" onClick={() => setOpen(true)}>
      {answer ? "Return to answer" : working && askedQuestion ? "Question in progress" : "Ask the filings"}
    </button>
    <dialog ref={dialog} className="ask-dialog" aria-labelledby="ask-filings-title"
      onCancel={(event) => { event.preventDefault(); close(); }}>
      <header className="dialog-heading">
        <div><p>{companyName}</p><h2 id="ask-filings-title" tabIndex={-1}>Ask the filings</h2></div>
        <button onClick={() => close()} aria-label="Back to evidence">Back to evidence</button>
      </header>
      <div className="ask-body">
        <div className="ask-context"><p>Answers grounded in this company’s SEC filings. Open a source to explore it in your evidence bank.</p>
          {corpus && <span className={`corpus-state ${ready ? "ready" : "pending"}`}>{ready ? corpus.readiness === "ready_with_exclusions" ? "Ready with exclusions" : "Ready to ask" : "Preparing evidence"}</span>}
        </div>
        {!corpus ? <p className="research-progress">Checking evidence coverage…</p> : !ready ? <div className="corpus-progress">
          <p>This company’s evidence is being prepared. New questions unlock when processing finishes; you can continue searching its available evidence.</p>
          <dl>{Object.entries(corpus.stageCounts).map(([stage, count]) => <div key={stage}><dt>{stage.replaceAll("_", " ")}</dt><dd>{count}</dd></div>)}<div><dt>Financial facts</dt><dd>{corpus.structuredFactsComplete ? "Complete" : "Pending"}</dd></div><div><dt>Missing filing manifests</dt><dd>{corpus.coverage.missingManifests}</dd></div><div><dt>Queued or active tasks</dt><dd>{corpus.activeWorkCount ?? "Checking…"}</dd></div></dl>
          <div className="corpus-actions">
            {corpus.externalEmbeddingEstimate && <button onClick={() => void updateCorpus("approve")} disabled={working}>Approve external embedding of {corpus.externalEmbeddingEstimate.tokenEstimate.toLocaleString()} estimated tokens</button>}
            {(corpus.exclusions.some((item) => item.retryable) || corpus.failures.length > 0) && <button onClick={() => void updateCorpus("retry")} disabled={working}>Retry excluded evidence</button>}
          </div>
          {corpus.exclusions.length > 0 && <details><summary>{corpus.exclusions.length} excluded document{corpus.exclusions.length === 1 ? "" : "s"}</summary><ul>{corpus.exclusions.map((item) => <li key={item.id}><strong>{item.document_name}</strong><span>{item.exclusion_reason}</span></li>)}</ul></details>}
        </div> : null}
        {askedQuestion && <section className="asked-question"><h3>Your question</h3><p>{askedQuestion}</p></section>}
        {working && askedQuestion && <p className="answer-progress" role="status">Reviewing the evidence and checking support. You can return to the evidence bank while this finishes.</p>}
        {answer && <div className="research-answer" aria-live="polite">
          {answer.status === "answered" ? <>
            <section className="answer-summary"><h3>{answer.summary?.length ? "AI summary" : "Answer"}</h3>{prose(answer.summary?.length ? answer.summary : answer.findings)}</section>
            {Boolean(answer.summary?.length && answer.findings.length) && <details className="answer-detail"><summary>Supporting findings</summary>{prose(answer.findings)}</details>}
            {answer.interpretation.length > 0 && <section><h3>What this suggests</h3>{prose(answer.interpretation)}</section>}
            <p className="source-invitation">You can inspect the sources below to see the original wording.</p>
          </> : answer.status === "generation_limited" ? <>
            <section className="answer-fallback"><h3>Evidence only</h3><p>I found relevant passages, but couldn’t verify an AI summary. You can inspect these excerpts or try rephrasing your question.</p></section>
            <details className="answer-detail"><summary>View evidence excerpts</summary>{prose(answer.findings)}</details>
          </> : <section className="answer-fallback"><h3>More evidence is needed</h3><p>I couldn’t find enough evidence for this question. Try a broader period or different wording, or explore the evidence bank.</p></section>}
          {citations.length > 0 && <section className="answer-sources"><h3>Sources</h3>{citations.map((citation) => citation.kind === "chunk" ?
            <button type="button" key={citation.label} onClick={() => openSource(citation)}><strong>{citation.label}</strong><span>{citation.locator.formType} {citation.locator.accessionNumber}{citation.locator.pageStart ? ` · page ${citation.locator.pageStart}` : ""}</span><span>Inspect source</span></button> :
            <details key={citation.label} id={`answer-source-${citation.label}`}><summary>{citation.label} · {citation.locator.formType} · Financial fact</summary><p>{citation.text}</p><small>{citation.locator.accessionNumber}</small></details>)}</section>}
          {answer.limitations.length > 0 && <details className="answer-detail answer-limitations"><summary>{answer.status === "generation_limited" ? "Why no AI summary?" : "Limitations and coverage"}</summary><ul>{answer.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
          {answer.externalDisclosure && <p className="provider-disclosure">{answer.externalDisclosure}</p>}
        </div>}
        {!answer && !askedQuestion && ready && <div className="ask-start"><h3>What would you like to understand?</h3><p>Start with a question about the business, its risks, or a reporting period.</p>
          <div>{["What does the company do?", "What risks does the company describe?", "How did revenue change?"].map((suggestion) => <button key={suggestion} onClick={() => { setQuestion(suggestion); textarea.current?.focus(); }}>{suggestion}</button>)}</div>
        </div>}
        {error && <p className="ask-error" role="alert">{error}</p>}
      </div>
      <form className="question-form" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
        <label htmlFor="filing-question">Question</label>
        <div><textarea id="filing-question" ref={textarea} value={question} onChange={(event) => setQuestion(event.target.value)} disabled={!ready || working} minLength={2} maxLength={2000} placeholder="What would you like to know about the filings?" rows={2} /><button className="primary-button" disabled={!ready || working || question.trim().length < 2}>{working ? "Reviewing…" : "Ask"}</button></div>
        <small>Each question is independent. Your current answer stays here while you inspect its sources.</small>
      </form>
    </dialog>
  </>;
}
