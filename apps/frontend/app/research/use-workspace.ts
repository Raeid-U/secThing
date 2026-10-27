"use client";

import { useCallback, useEffect, useState } from "react";
import {
  emptyLocation,
  request,
  type Company,
  type Detail,
  type Hit,
  type Location,
  type Reader,
} from "./types";

export function useWorkspace() {
  const [location, setLocation] = useState<Location>(emptyLocation);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reader, setReader] = useState<Reader | null>(null);
  const [hits, setHits] = useState<Hit[]>([]);
  const [error, setError] = useState("");
  const [readerError, setReaderError] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState("");
  const [revision, setRevision] = useState(0);
  const [searchRevision, setSearchRevision] = useState(0);
  const rerunSearch = useCallback(() => setSearchRevision((v) => v + 1), []);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);

  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      setLocation(
        Object.fromEntries(
          Object.entries(emptyLocation).map(([key, value]) => [
            key,
            params.get(key) ?? value,
          ]),
        ) as Location,
      );
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  const navigate = useCallback(
    (patch: Partial<Location>, replace = false) => {
      const next = { ...location, ...patch };
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(next))
        if (value) params.set(key, value);
      window.history[replace ? "replaceState" : "pushState"](
        null,
        "",
        `/records?${params}`,
      );
      setLocation(next);
    },
    [location],
  );

  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      request<Company[]>("/api/v1/companies", { signal: controller.signal })
        .then(setCompanies)
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        });
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [revision]);

  useEffect(() => {
    setDetail(null);
    setError("");
    if (!location.company) return;
    const controller = new AbortController();
    const load = () =>
      request<Detail>(`/api/v1/companies/${location.company}`, {
        signal: controller.signal,
      })
        .then((data) => {
          if (!controller.signal.aborted) setDetail(data);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        });
    void load();
    const timer = setInterval(load, 4000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [location.company, revision]);

  useEffect(() => {
    setReader(null);
    setReaderError("");
    if (!location.filing) return;
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (location.hash) params.set("textHash", location.hash);
    if (location.document) params.set("documentId", location.document);
    if (location.generation) params.set("normalizedDocumentId", location.generation);
    void request<Reader>(
      `/api/v1/filings/${location.filing}/parsed?${params}`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (!controller.signal.aborted) setReader(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setReaderError(e.message);
      });
    return () => controller.abort();
  }, [location.filing, location.hash, location.document, location.generation, revision]);

  useEffect(() => {
    setHits([]);
    setSearchNote("");
    if (!location.company || !location.q) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      q: location.q,
      mode: location.mode,
      limit: "40",
    });
    for (const key of [
      "formType",
      "sectionType",
      "filedAfter",
      "filedBefore",
    ] as const)
      if (location[key]) params.set(key, location[key]);
    setSearching(true);
    void request<{ results: Hit[]; fallback: string | null }>(
      `/api/v1/companies/${location.company}/search?${params}`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (!controller.signal.aborted) {
          setHits(data.results);
          setSearchNote(
            data.fallback ? `Showing keyword results. ${data.fallback}` : "",
          );
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setSearchNote(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSearching(false);
      });
    return () => controller.abort();
  }, [
    location.company,
    location.q,
    location.mode,
    location.formType,
    location.sectionType,
    location.filedAfter,
    location.filedBefore,
    revision,
    searchRevision,
  ]);

  return {
    location,
    navigate,
    companies,
    detail,
    reader,
    hits,
    error,
    setError,
    readerError,
    searching,
    searchNote,
    setSearchNote,
    refresh,
    rerunSearch,
  };
}
