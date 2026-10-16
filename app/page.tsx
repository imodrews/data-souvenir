"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getFinalVisitPath, getSessionId, isVisitFinished } from "../lib/session";
import Collection from "./components/Collection";
import styles from "./page.module.css";

export default function Home() {
  const [name, setName] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const id = getSessionId();
        if (isVisitFinished(id)) {
          window.location.replace(getFinalVisitPath(id));
          return;
        }
        setName(localStorage.getItem("visitor_name") ?? "");
        setSessionId(id);
      } catch {
        setError("Please allow browser storage to begin your visit.");
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  function beginVisit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const visitorName = draft.trim();
    if (!visitorName) return;
    try {
      localStorage.setItem("visitor_name", visitorName);
      const artworkId = new URLSearchParams(window.location.search).get("artwork");
      if (artworkId) {
        window.location.replace(`/artwork/${encodeURIComponent(artworkId)}`);
        return;
      }
      setName(visitorName);
    } catch {
      setError("Please allow browser storage to begin your visit.");
    }
  }

  return (
    <main className={styles.visit}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>An exhibition, collected by you</p>
        <h1>Data Souvenir</h1>
      </header>
      {error ? <p role="alert">{error}</p> : name === null ? (
        <p role="status">Opening your visit...</p>
      ) : !name ? (
        <section className={styles.welcome}>
          <svg className={styles.welcomeMark} viewBox="0 0 360 240" aria-hidden="true">
            <path d="M 70 150 Q 140 20 280 90" fill="none" stroke="#873c70" strokeWidth="2" />
            <image href="/marks/blue-dot.png" x="0" y="80" width="140" height="140" />
            <image href="/marks/blue-dot.png" x="210" y="20" width="140" height="140" />
          </svg>
          <h2>Every visit leaves a trace.</h2>
          <form onSubmit={beginVisit} className={styles.form}>
            <label htmlFor="visitor-name">What should we call you?</label>
            <input id="visitor-name" name="visitor-name" autoComplete="given-name" maxLength={60}
              value={draft} onChange={(event) => setDraft(event.target.value)} required />
            <p className={styles.note}>Your name stays in this browser. It is not saved to our database.</p>
            <button type="submit" disabled={!draft.trim() || !sessionId}>Begin my visit</button>
          </form>
        </section>
      ) : (
        <section className={styles.collection}>
          <h2>{name}&apos;s collection</h2>
          {sessionId && <Collection sessionId={sessionId} />}
        </section>
      )}
    </main>
  );
}
