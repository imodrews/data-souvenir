"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "../../../lib/supabase/client";
import { getFinishedVisits, getFinalVisitPath, type FinishedVisit } from "../../../lib/session";
import JourneyVisualisation, { type JourneyEncounter } from "../../components/JourneyVisualisation";

export default function FloorTestPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;
  const [encounters, setEncounters] = useState<JourneyEncounter[]>([]);
  const [previousVisits, setPreviousVisits] = useState<FinishedVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        setPreviousVisits(getFinishedVisits().filter((visit) => visit.sessionId !== sessionId));
      } catch {
        setPreviousVisits([]);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const supabase = createClient();
      const { data, error: queryError } = await supabase
        .from("scans")
        .select("id, scanned_at, artwork:artworks (id, title, x, y, artist:artists (name, curatorial_group))")
        .eq("session_id", sessionId)
        .order("scanned_at", { ascending: true });
      if (cancelled) return;
      if (queryError) {
        setError(queryError.message);
        setEncounters([]);
      } else {
        const normalized = (data ?? []).flatMap((raw) => {
          type Artist = { name: string; curatorial_group: string | null };
          type ScannedArtwork = {
            id: string;
            title: string | null;
            x: number | null;
            y: number | null;
            artist: Artist | Artist[] | null;
          };
          const scan = raw as unknown as {
            id: string | number;
            artwork: ScannedArtwork | ScannedArtwork[] | null;
          };
          const artwork = Array.isArray(scan.artwork) ? scan.artwork[0] : scan.artwork;
          if (!artwork || artwork.x == null || artwork.y == null) return [];
          const artist = Array.isArray(artwork.artist) ? artwork.artist[0] : artwork.artist;
          return [{
            scanId: String(scan.id),
            artworkId: artwork.id,
            name: artwork.title ?? "Untitled",
            artist: artist?.name ?? "Unknown artist",
            group: artist?.curatorial_group,
            x: artwork.x,
            y: artwork.y,
          } satisfies JourneyEncounter];
        });
        setEncounters(normalized);
      }
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [sessionId]);

  const artworkCount = new Set(encounters.map((encounter) => encounter.artworkId)).size;

  return (
    <main style={{ minHeight: "100vh", padding: "28px 18px", background: "#f3f2e6", color: "#222" }}>
      <div style={{ maxWidth: 520, margin: "0 auto" }}>
        <h1 style={{ fontWeight: 400 }}>Your exhibition constellation</h1>
        <p style={{ fontSize: 13, opacity: 0.65 }}>{"\u00b7 "}{artworkCount} artists collected</p>
        {loading && <p>Loading scans{"\u2026"}</p>}
        {error && <p role="alert">Could not load scans: {error}</p>}
        {!loading && !error && !encounters.length && <p>No artwork scans found for this session.</p>}
        {!loading && !error && encounters.length > 0 && <JourneyVisualisation key={sessionId} encounters={encounters} mode="final" />}
        {previousVisits.length > 0 && (
          <nav aria-label="Previous visualisations" style={{ marginTop: 32, borderTop: "1px solid #dedede", paddingTop: 20 }}>
            <h2 style={{ fontSize: 18, fontWeight: 400 }}>Previous visualisations</h2>
            <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
              {previousVisits.map((visit, index) => {
                const date = visit.finishedAt ? new Date(visit.finishedAt) : null;
                const label = date && !Number.isNaN(date.getTime())
                  ? `Visit from ${date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
                  : `Previous visit ${previousVisits.length - index}`;
                return <li key={visit.sessionId} style={{ borderTop: "1px solid #eee" }}>
                  <Link href={getFinalVisitPath(visit.sessionId)} style={{ display: "block", padding: "12px 0", textUnderlineOffset: 4, overflowWrap: "anywhere" }}>
                    {label}
                  </Link>
                </li>;
              })}
            </ul>
          </nav>
        )}
      </div>
    </main>
  );
}