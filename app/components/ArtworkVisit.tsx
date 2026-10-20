"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSessionId, startFreshVisitIfFinished } from "../../lib/session";
import Collection from "./Collection";
import styles from "../page.module.css";

export default function ArtworkVisit({ artworkId }: { artworkId: string }) {
  const router = useRouter();
  const [visitor, setVisitor] = useState<{ name: string; sessionId: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const sessionId = startFreshVisitIfFinished(getSessionId());
        const name = localStorage.getItem("visitor_name");
        if (!name) {
          router.replace(`/?artwork=${encodeURIComponent(artworkId)}`);
          return;
        }
        setVisitor({ name, sessionId });
      } catch {
        setError("Please allow browser storage to collect artworks.");
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [artworkId, router]);

  return <main className={`${styles.visit} ${styles.artworkVisit}`}>
    <header className={styles.header}>
      <Link href="/" className={styles.eyebrow}>Data Souvenir</Link>
      <h1>{visitor ? `${visitor.name}'s collection` : "Your collection"}</h1>
    </header>
    {error ? <p role="alert">{error}</p> : visitor ? (
      <Collection key={`${visitor.sessionId}:${artworkId}`} sessionId={visitor.sessionId} artworkId={artworkId} />
    ) : <p className={styles.status} role="status">Opening your visit...</p>}
    <Link className={styles.textLink} href="/">Back to my collection</Link>
  </main>;
}