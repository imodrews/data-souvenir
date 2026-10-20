"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { getFinishedVisits, getFinalVisitPath, getSessionId, startFreshVisitIfFinished, type FinishedVisit } from "../lib/session";
import Collection from "./components/Collection";
import styles from "./page.module.css";

export default function Home() {
  const [name, setName] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [finishedVisits, setFinishedVisits] = useState<FinishedVisit[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const id = startFreshVisitIfFinished(getSessionId());
        setName(localStorage.getItem("visitor_name") ?? "");
        setSessionId(id);
        setFinishedVisits(getFinishedVisits());
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
    <main className={`${styles.visit}${!name ? " visitor-welcome" : ""}`}>
      {name && <header className={styles.header}>
        <p className={styles.eyebrow}>An exhibition, collected by you</p>
        <h1>Data Souvenir</h1>
      </header>}
      {name && finishedVisits.length > 0 && <section className={styles.history} aria-labelledby="visit-history-heading">
        <h2 id="visit-history-heading">Previous visualisations</h2>
        <ul>
          {finishedVisits.map((visit, index) => {
            const date = visit.finishedAt ? new Date(visit.finishedAt) : null;
            const label = date && !Number.isNaN(date.getTime())
              ? `Visit from ${date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
              : `Previous visit ${finishedVisits.length - index}`;
            return <li key={visit.sessionId}>
              <Link href={getFinalVisitPath(visit.sessionId)}>{label}</Link>
            </li>;
          })}
        </ul>
      </section>}
      {error ? <p role="alert">{error}</p> : name === null ? (
        <p role="status">Opening your visit...</p>
      ) : !name ? (
        <section className={styles.welcome}>
          <svg className={styles.welcomeMark} viewBox="0 0 360 660" aria-hidden="true">
            <defs>
              <filter id="welcome-trace-halo" x="0" y="0" width="360" height="660" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse">
                <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="8" result="grain" />
                <feDisplacementMap in="SourceGraphic" in2="grain" scale="8" xChannelSelector="R" yChannelSelector="G" result="organic" />
                <feGaussianBlur in="organic" stdDeviation="9" />
              </filter>
              <filter id="welcome-trace-soft" x="0" y="0" width="360" height="660" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse">
                <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="13" result="grain" />
                <feDisplacementMap in="SourceGraphic" in2="grain" scale="4" xChannelSelector="R" yChannelSelector="G" result="organic" />
                <feGaussianBlur in="organic" stdDeviation="3" />
              </filter>
            </defs>
            <g opacity="0.65">
              <path className={styles.welcomeTrace} d="M 120 100 C 120 210 240 220 240 330 S 120 450 120 560" pathLength="1" fill="none" stroke="#873c70" strokeWidth="10" strokeLinecap="round" opacity="0.2" filter="url(#welcome-trace-halo)" />
              <path className={styles.welcomeTrace} d="M 120 100 C 120 210 240 220 240 330 S 120 450 120 560" pathLength="1" fill="none" stroke="#873c70" strokeWidth="5" strokeLinecap="round" opacity="0.22" filter="url(#welcome-trace-soft)" />
            </g>
            <image className={styles.welcomeDot} href="/marks/blue-dot.png" x="30" y="10" width="180" height="180" />
            <image className={styles.welcomeDot} href="/marks/blue-dot.png" x="150" y="240" width="180" height="180" />
            <image className={styles.welcomeDot} href="/marks/blue-dot.png" x="30" y="470" width="180" height="180" />
          </svg>
          <form onSubmit={beginVisit} className={styles.form}>
            <label htmlFor="visitor-name">What should we call you?</label>
            <input id="visitor-name" name="visitor-name" autoComplete="given-name" maxLength={60}
              value={draft} onChange={(event) => setDraft(event.target.value)} required />
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
