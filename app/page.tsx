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
    <main className={`${styles.visit} visitor-home${!name ? " visitor-welcome" : ""}`}>
      {name && <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>An exhibition, collected by you</p>
          <h1>Data Souvenir</h1>
        </div>
        {finishedVisits.length > 0 && <>
          <button type="button" className={styles.historyToggle} popoverTarget="visit-history">
            Previous visualisations
          </button>
          <section id="visit-history" className={styles.history} popover="auto" aria-labelledby="visit-history-heading">
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
          </section>
        </>}
      </header>}
      {error ? <p role="alert">{error}</p> : name === null ? (
        <p role="status">Opening your visit...</p>
      ) : !name ? (
        <section className={styles.welcome}>
          <div className={styles.welcomeMark} aria-hidden="true">
          <svg className={styles.welcomeLine} viewBox="0 0 360 660" preserveAspectRatio="none">
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
            <g opacity="0.85">
              <path className={styles.welcomeTrace} d="M 120 100 C 120 210 240 220 240 330 S 120 450 120 560" pathLength="1" fill="none" stroke="#c45b9c" strokeWidth="10" strokeLinecap="round" opacity="0.38" filter="url(#welcome-trace-halo)" />
              <path className={styles.welcomeTrace} d="M 120 100 C 120 210 240 220 240 330 S 120 450 120 560" pathLength="1" fill="none" stroke="#c45b9c" strokeWidth="5" strokeLinecap="round" opacity="0.45" filter="url(#welcome-trace-soft)" />
            </g>
          </svg>
          <svg className={styles.welcomeDot} viewBox="0 0 180 180">
            <image href="/svg-dot-3.svg" width="180" height="180" />
          </svg>
          <svg className={styles.welcomeDot} viewBox="0 0 180 180">
            <image href="/svg-dot-3.svg" width="180" height="180" />
          </svg>
          <svg className={styles.welcomeDot} viewBox="0 0 180 180">
            <image href="/svg-dot-3.svg" width="180" height="180" />
          </svg>
          </div>
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
