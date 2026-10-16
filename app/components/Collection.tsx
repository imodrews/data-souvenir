"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { scaleLinear } from "d3";
import { createClient } from "../../lib/supabase/client";
import type { Artwork } from "../../types/artwork";
import styles from "../page.module.css";

type CollectedArtwork = Artwork & {
  artist: { name: string } | { name: string }[] | null;
};

type Props = { sessionId: string; artworkId?: string };

export default function Collection({ sessionId, artworkId }: Props) {
  const [encounters, setEncounters] = useState<CollectedArtwork[]>([]);
  const [current, setCurrent] = useState<CollectedArtwork | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const scanRequest = useRef<{ key: string; promise: Promise<CollectedArtwork> } | null>(null);
  const filterId = useId().replaceAll(":", "");

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function loadScans() {
      const { data, error: queryError } = await supabase.from("scans")
        .select("id, artwork:artworks (*, artist:artists (name))")
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
        const key = `${sessionId}:${artworkId}`;
        if (scanRequest.current?.key !== key) {
          const promise = (async () => {
            const { data, error: artworkError } = await supabase.from("artworks")
              .select("*, artist:artists (name)").eq("id", artworkId).single();
            if (artworkError || !data) throw new Error("This artwork could not be found. Please check the tag and try again.");
            const { error: scanError } = await supabase.from("scans")
              .insert({ session_id: sessionId, artwork_id: artworkId });
            if (scanError) throw new Error(`Your tap could not be saved: ${scanError.message}`);
            return data as unknown as CollectedArtwork;
          })();
          scanRequest.current = { key, promise };
        }
        const artwork = await scanRequest.current.promise;
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
  const coordinates = artworks.map((artwork, index) => ({
    ...artwork,
    sourceX: artwork.x ?? (index % 3) * 200,
    sourceY: artwork.y ?? Math.floor(index / 3) * 100,
  }));
  const xValues = coordinates.map((artwork) => artwork.sourceX);
  const yValues = coordinates.map((artwork) => artwork.sourceY);
  const xScale = scaleLinear().domain([Math.min(...xValues), Math.max(...xValues)]).range([100, 594]);
  const yScale = scaleLinear().domain([Math.min(...yValues), Math.max(...yValues)]).range([100, 660]);
  const positioned = coordinates.map((artwork) => ({ ...artwork, px: xScale(artwork.sourceX), py: yScale(artwork.sourceY) }));
  const nodes = new Map(positioned.map((artwork) => [artwork.id, artwork]));
  const markSize = Math.max(90, Math.min(220, 360 / Math.sqrt(artworks.length || 1)));
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
    <>
      {current && <section className={styles.artworkDetails} aria-live="polite">
        <p className={styles.eyebrow}>Added to your collection</p>
        <h2>{current.title}</h2>
        {artist && <p>{artist.name}{current.year ? `, ${current.year}` : ""}</p>}
        {current.material_eng && <p className={styles.note}>{current.material_eng}</p>}
        {current.text_eng && <p className={styles.description}>{current.text_eng}</p>}
      </section>}
      <div className={styles.collectionHeading}>
        <h3>Your trace</h3>
        <p>{artworks.length} {artworks.length === 1 ? "artwork" : "artworks"} collected</p>
      </div>
      {artworks.length ? (
        <>
          <svg className={styles.journey} viewBox="0 0 694 760" role="img" aria-label={`Your journey through ${artworks.length} artworks`}>
            <defs>
              <filter id={`${filterId}-halo`} x="-30%" y="-30%" width="160%" height="160%">
                <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="8" result="grain" />
                <feDisplacementMap in="SourceGraphic" in2="grain" scale="8" xChannelSelector="R" yChannelSelector="G" />
                <feGaussianBlur stdDeviation="9" />
              </filter>
              <filter id={`${filterId}-soft`}><feGaussianBlur stdDeviation="3" /></filter>
            </defs>
            {encounters.slice(1).map((artwork, index) => {
              const start = nodes.get(encounters[index].id);
              const end = nodes.get(artwork.id);
              if (!start || !end || start.id === end.id) return null;
              const dx = end.px - start.px;
              const dy = end.py - start.py;
              const path = `M ${start.px} ${start.py} Q ${(start.px + end.px) / 2 - dy * .15} ${(start.py + end.py) / 2 + dx * .15} ${end.px} ${end.py}`;
              return <g key={`${artwork.id}-${index}`} opacity="0.65">
                <path d={path} fill="none" stroke="#873c70" strokeWidth="10" opacity="0.2" filter={`url(#${filterId}-halo)`} />
                <path d={path} fill="none" stroke="#873c70" strokeWidth="5" opacity="0.22" filter={`url(#${filterId}-soft)`} pathLength="1" className={styles.trace} />
              </g>;
            })}
            {positioned.map((artwork) => <g key={artwork.id}>
              <title>{artwork.title}</title>
              <image href="/marks/blue-dot.png" x={artwork.px - markSize / 2} y={artwork.py - markSize / 2}
                width={markSize} height={markSize} className={styles.mark} />
            </g>)}
          </svg>
          <ol className={styles.artworkList}>
            {artworks.map((artwork, index) => <li key={artwork.id}>
              <span className={styles.number}>{String(index + 1).padStart(2, "0")}</span>
              <span>{artwork.title}</span>
            </li>)}
          </ol>
          <Link className={styles.textLink} href={`/floor-test/${sessionId}`}>View my full souvenir</Link>
        </>
      ) : <div className={styles.empty}>
        <svg viewBox="0 0 300 220" aria-hidden="true"><image href="/marks/blue-dot.png" x="50" y="10" width="200" height="200" /></svg>
        <p>No artworks collected yet.</p>
      </div>}
    </>
  );
}