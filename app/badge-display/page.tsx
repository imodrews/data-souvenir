"use client";

import { useEffect, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { createClient } from "../../lib/supabase/client";
import styles from "../page.module.css";

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL || "https://data-souvenir.vercel.app").replace(/\/$/, "");
const BADGE_EXIT_CHANNEL = "badge-exit-display";

export default function BadgeDisplayPage() {
  const [sessionInput, setSessionInput] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const querySessionId = new URLSearchParams(window.location.search).get("session_id") ?? "";
      if (SESSION_ID_PATTERN.test(querySessionId)) {
        setSessionInput(querySessionId);
        setSessionId(querySessionId);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(BADGE_EXIT_CHANNEL)
      .on("broadcast", { event: "session-ended" }, ({ payload }) => {
        const receivedSessionId = (payload as { session_id?: unknown }).session_id;
        if (typeof receivedSessionId !== "string" || !SESSION_ID_PATTERN.test(receivedSessionId)) return;

        setSessionInput(receivedSessionId);
        setSessionId(receivedSessionId);
        setError("");
        window.history.replaceState(null, "", `/badge-display?session_id=${encodeURIComponent(receivedSessionId)}`);
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  function showVisualization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = sessionInput.trim();
    if (!SESSION_ID_PATTERN.test(candidate)) {
      setError("Enter a valid session ID.");
      return;
    }

    setError("");
    setSessionId(candidate);
    window.history.replaceState(null, "", `/badge-display?session_id=${encodeURIComponent(candidate)}`);
  }

  function resetDisplay() {
    setSessionId("");
    setSessionInput("");
    setError("");
    window.history.replaceState(null, "", "/badge-display");
  }

  const visualizationUrl = sessionId
    ? new URL(`/ending-test/${encodeURIComponent(sessionId)}`, SITE_ORIGIN).toString()
    : "";

  return (
    <main className={`${styles.kioskPage} kiosk-display-root`}>
      <div className={styles.kioskContent}>
        <p className={styles.kioskEyebrow}>Data Souvenir · Exit</p>
        {sessionId ? (
          <section className={styles.kioskResult} aria-live="polite">
            <h1>Your visit is ready</h1>
            <p>Scan to open your final visualisation.</p>
            <div className={styles.kioskQr}>
              <QRCodeSVG value={visualizationUrl} size={320} level="M" marginSize={2} title="QR code for your final visualisation" />
            </div>
            <a className={styles.kioskLink} href={visualizationUrl}>Open visualisation</a>
            <button className={styles.kioskButton} type="button" onClick={resetDisplay}>Next visitor</button>
          </section>
        ) : (
          <section className={styles.kioskIdle}>
            <h1>Ready for the next visitor</h1>
            <form className={styles.kioskForm} onSubmit={showVisualization}>
              <label htmlFor="session-id">Session ID</label>
              <input
                id="session-id"
                autoComplete="off"
                spellCheck={false}
                value={sessionInput}
                onChange={(event) => setSessionInput(event.target.value)}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "session-id-error" : undefined}
              />
              {error && <p className={styles.kioskError} id="session-id-error" role="alert">{error}</p>}
              <button className={styles.kioskButton} type="submit">Show QR code</button>
            </form>
          </section>
        )}
      </div>
    </main>
  );
}