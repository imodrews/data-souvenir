"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { finishVisit, getFinalVisitPath } from "../../lib/session";
import styles from "../page.module.css";

export default function ExitPage() {
  const [error, setError] = useState("");

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const sessionId = localStorage.getItem("session_id");
        if (!sessionId || !localStorage.getItem("visitor_name")) {
          window.location.replace("/");
          return;
        }
        finishVisit(sessionId);
        window.location.replace(getFinalVisitPath(sessionId));
      } catch {
        setError("Your visit could not be finished. Please allow browser storage and try again.");
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return <main className={styles.visit}>
    <header className={styles.header}><h1>Your souvenir</h1></header>
    {error ? <div className={styles.status}>
      <p role="alert">{error}</p>
      <Link className={styles.textLink} href="/">Back to my collection</Link>
    </div> : <p className={styles.status} role="status">Finishing your visit...</p>}
  </main>;
}