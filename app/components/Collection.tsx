"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "../../lib/supabase/client";
import { getFinalVisitPath, isVisitFinished } from "../../lib/session";
import type { Artwork } from "../../types/artwork";
import JourneyVisualisation, { type JourneyEncounter } from "./JourneyVisualisation";
import styles from "../page.module.css";

type CollectedArtist = { name: string; curatorial_group: string | null };
type CollectedArtwork = Artwork & {
  artist: CollectedArtist | CollectedArtist[] | null;
};

type Props = { sessionId: string; artworkId?: string };

export default function Collection({ sessionId, artworkId }: Props) {
  const [encounters, setEncounters] = useState<CollectedArtwork[]>([]);
  const [current, setCurrent] = useState<CollectedArtwork | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const scanRequest = useRef<{ key: string; promise: Promise<CollectedArtwork | null> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function loadScans() {
      const { data, error: queryError } = await supabase.from("scans")
        .select("id, artwork:artworks (*, artist:artists (name, curatorial_group))")
        .eq("session_id", sessionId).order("scanned_at", { ascending: true });
      if (queryError) throw new Error(queryError.message);
      if (!cancelled) {
        setEncounters((data ?? []).flatMap((scan) => {
          const artwork = Array.isArray(scan.artwork) ? scan.artwork[0] : scan.artwork;
          return artwork ? [artwork as unknown as CollectedArtwork] : [];
        }));
      }
    }

    async function load() {
      if (artworkId) {
        if (isVisitFinished(sessionId)) {
          window.location.replace(getFinalVisitPath(sessionId));
          return;
        }
        const key = `${sessionId}:${artworkId}`;
        if (scanRequest.current?.key !== key) {
          const promise = (async () => {
            const { data, error: artworkError } = await supabase.from("artworks")
              .select("*, artist:artists (name, curatorial_group)").eq("id", artworkId).single();
            if (artworkError || !data) throw new Error("This artwork could not be found. Please check the tag and try again.");
            if (isVisitFinished(sessionId)) {
              window.location.replace(getFinalVisitPath(sessionId));
              return null;
            }
            const { error: scanError } = await supabase.from("scans")
              .insert({ session_id: sessionId, artwork_id: artworkId });
            if (scanError) throw new Error(`Your tap could not be saved: ${scanError.message}`);
            return data as unknown as CollectedArtwork;
          })();
          scanRequest.current = { key, promise };
        }
        const artwork = await scanRequest.current.promise;
        if (!artwork) return;
        if (!cancelled) setCurrent(artwork);
      }
      await loadScans();
      if (!cancelled) {
        setLoading(false);
        setError("");
      }
    }

    void load().catch((cause: unknown) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : "Your collection could not be loaded.");
        setLoading(false);
      }
    });

    const channel = supabase.channel(`collection-${sessionId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "scans", filter: `session_id=eq.${sessionId}`,
      }, () => {
        void loadScans().catch((cause: unknown) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : "Your collection could not be refreshed.");
        });
      }).subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [sessionId, artworkId, retry]);

  const artworks = [...new Map(encounters.map((artwork) => [artwork.id, artwork])).values()];
  const journeyEncounters = useMemo<JourneyEncounter[]>(() => encounters.map((artwork, index) => {
    const artist = Array.isArray(artwork.artist) ? artwork.artist[0] : artwork.artist;
    return {
      scanId: `${artwork.id}-${index}`,
      artworkId: artwork.id,
      name: artwork.title ?? "Untitled",
      artist: artist?.name ?? "Unknown artist",
      group: artist?.curatorial_group,
      x: artwork.x,
      y: artwork.y,
    };
  }), [encounters]);
  const artist = current && (Array.isArray(current.artist) ? current.artist[0] : current.artist);

  if (loading) return <p className={styles.status} role="status">{artworkId ? "Collecting your artwork..." : "Opening your collection..."}</p>;
  if (error) return (
    <div className={styles.status}>
      <p role="alert">{error}</p>
      <button className={styles.action} onClick={() => {
        if (!current) scanRequest.current = null;
        setError("");
        setLoading(true);
        setRetry((value) => value + 1);
      }}>Try again</button>
      <Link className={styles.textLink} href="/">Back to my visit</Link>
    </div>
  );

  return (
    <div className={styles.collectionContent}>
      {current && <section className={styles.artworkDetails} aria-live="polite">
        <p className={styles.eyebrow}>Added to your collection</p>
        <h2>{current.title}</h2>
        {artist && <p>{artist.name}{current.year ? `, ${current.year}` : ""}</p>}
      </section>}
      <div className={styles.collectionHeading}>
        <h3>Your trace</h3>
        <p>{artworks.length} {artworks.length === 1 ? "artwork" : "artworks"} collected</p>
      </div>
      {artworks.length ? (
        <>
          <JourneyVisualisation encounters={journeyEncounters} mode="live" />
          {current && (current.material_eng || current.text_eng) && <section className={styles.artworkDetails} aria-label="Artwork details">
            {current.material_eng && <p className={styles.note}>{current.material_eng}</p>}
            {current.text_eng && <p className={styles.description}>{current.text_eng}</p>}
          </section>}
          <ol className={styles.artworkList}>
            {artworks.map((artwork, index) => <li key={artwork.id}>
              <span className={styles.number}>{String(index + 1).padStart(2, "0")}</span>
              <span>{artwork.title}</span>
            </li>)}
          </ol>
          <Link className={styles.textLink} href={`/floor-test/${sessionId}`}>View my full souvenir</Link>
        </>
      ) : <figure className={styles.empty}>
        <figcaption>
          <h3>Start your collection</h3>
          <p>Tap your phone on the tag beside an artwork. A dot will appear here for each artwork you collect.</p>
        </figcaption>
        <svg viewBox="0 0 400 200" aria-hidden="true">
          <image href="/correct_color.png" x="100" y="0" width="200" height="200" />
        </svg>
      </figure>}
      <footer className={styles.collectionFooter}>
        <Link className={styles.action} href="/exit">Exit and view my souvenir</Link>
      </footer>
    </div>
  );
}