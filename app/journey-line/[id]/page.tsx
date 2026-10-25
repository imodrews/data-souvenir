"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import gsap from "gsap";
import { createClient } from "../../../lib/supabase/client";

type Group = "green" | "red" | "purple";
type Artwork = { id: string; title: string; x: number | null; y: number | null };
type Artist = {
  id: string;
  name: string;
  group: Group;
  x: number | null;
  y: number | null;
  artworks: Artwork[];
};
type PlacedArtist = Artist & { cx: number; cy: number; radius: number };
type Row = { artists: PlacedArtist[]; cy: number; radius: number };

const WIDTH = 694;
const GROUPS: Group[] = ["green", "red", "purple"];
const COLORS: Record<Group, string> = {
  green: "#48ba38",
  red: "#e52d1d",
  purple: "#9639a6",
};
const MARKS: Record<Group, string> = {
  green: "/marks/green/03.png",
  red: "/marks/red/03.png",
  purple: "/marks/purple/03.png",
};

// Change these to experiment with the composition.
const DOT_RADIUS = 60;
const DOT_GAP = 16;
const LINE_GAP = 9;
const MAX_PER_ROW = 3;
const ROW_GAP = 110;
const SECTION_GAP = 55;
const USE_HANDMADE_MARKS = false;

function normalizeGroup(value: string | null): Group {
  const group = value?.trim().toLowerCase();
  if (group === "green") return "green";
  if (group === "purple" || group === "blue") return "purple";
  return "red";
}

function makeLayout(artists: Artist[]) {
  const rows: Row[] = [];
  const placed: PlacedArtist[] = [];
  let cy = 155;
  let previousRowBottom: number | null = null;
  let previousRowGroup: Group | null = null;

  // First encounter order is preserved within each curatorial section.
  for (const group of GROUPS) {
    const members = artists.filter((artist) => artist.group === group);
    if (!members.length) continue;

    for (let start = 0; start < members.length; start += MAX_PER_ROW) {
      const batch = members.slice(start, start + MAX_PER_ROW);
      const totalWidth = batch.length * DOT_RADIUS * 2 + (batch.length - 1) * DOT_GAP;
      const firstX = (WIDTH - totalWidth) / 2 + DOT_RADIUS;
      const rowArtists = batch.map((artist, index) => ({
        ...artist,
        cx: artist.x ?? firstX + index * (DOT_RADIUS * 2 + DOT_GAP),
        cy: artist.y ?? cy,
        radius: DOT_RADIUS,
      }));
      const lineArtists = [...rowArtists].sort((first, second) => first.cx - second.cx);
      const minimumCenterGap = DOT_RADIUS * 2 + DOT_GAP;

      for (let index = 1; index < lineArtists.length; index += 1) {
        lineArtists[index].cx = Math.max(
          lineArtists[index].cx,
          lineArtists[index - 1].cx + minimumCenterGap
        );
      }

      const minCenterX = 135 + LINE_GAP;
      const maxCenterX = WIDTH - DOT_RADIUS - LINE_GAP;
      const firstCenterX = lineArtists[0].cx;
      const lastCenterX = lineArtists[lineArtists.length - 1].cx;
      const availableSpan = maxCenterX - minCenterX;
      if (lastCenterX - firstCenterX > availableSpan) {
        lineArtists.forEach((artist, index) => {
          artist.cx = lineArtists.length === 1
            ? WIDTH / 2
            : minCenterX + (index / (lineArtists.length - 1)) * availableSpan;
        });
      } else {
        const shiftX = firstCenterX < minCenterX
          ? minCenterX - firstCenterX
          : lastCenterX > maxCenterX
            ? maxCenterX - lastCenterX
            : 0;
        lineArtists.forEach((artist) => { artist.cx += shiftX; });
      }

      const requestedRowCy = rowArtists.reduce((sum, artist) => sum + artist.cy, 0) / rowArtists.length;
      const groupGap = previousRowGroup === null || previousRowGroup === group ? 0 : SECTION_GAP;
      const requestedRowTop = Math.min(...rowArtists.map((artist) => artist.cy - artist.radius));
      const minimumRowTop = previousRowBottom === null
        ? DOT_RADIUS + LINE_GAP
        : previousRowBottom + ROW_GAP + groupGap;
      const rowShift = Math.max(0, minimumRowTop - requestedRowTop);
      rowArtists.forEach((artist) => { artist.cy += rowShift; });
      const rowCenterY = rowArtists.reduce((sum, artist) => sum + artist.cy, 0) / rowArtists.length;
      const rowBottom = Math.max(...rowArtists.map((artist) => artist.cy + artist.radius));

      rows.push({ artists: lineArtists, cy: rowCenterY, radius: DOT_RADIUS });
      placed.push(...lineArtists);
      previousRowBottom = rowBottom;
      previousRowGroup = group;
      cy += DOT_RADIUS * 2 + ROW_GAP;
    }
    cy += SECTION_GAP;
  }

  const height = placed.reduce(
    (max, artist) => Math.max(max, artist.cy + artist.radius + LINE_GAP + 135),
    550
  );
  return { rows, placed, height };
}

// A single flowing stroke. All joins are tangent-continuous:
// - horizontal tangents above/below each row
// - an exact half-circle around the last artist
// - a broad left-side Bezier that departs and arrives horizontally
// There are no abrupt line-to-curve joins or straight diagonal connectors.
function makeLine(rows: Row[], height: number): string {
  if (!rows.length) return "";

  const fmt = (n: number) => Number(n.toFixed(2));
  const first = rows[0].artists[0];
  const firstTop = Math.min(...rows[0].artists.map((artist) => artist.cy - artist.radius)) - LINE_GAP;
  const entryX = first.cx - 135;

  // The entry is one cubic: vertical at the top, horizontal at the first row.
  let d = `M ${fmt(entryX)} 0`;
  d += ` C ${fmt(entryX)} ${fmt(firstTop * 0.68)}, ${fmt(first.cx - 115)} ${fmt(firstTop)}, ${fmt(first.cx)} ${fmt(firstTop)}`;

  rows.forEach((row, index) => {
    const left = row.artists[0];
    const right = row.artists[row.artists.length - 1];
    const top = Math.min(...row.artists.map((artist) => artist.cy - artist.radius)) - LINE_GAP;
    const bottom = Math.max(...row.artists.map((artist) => artist.cy + artist.radius)) + LINE_GAP;
    const turnRadius = Math.min(right.radius + LINE_GAP, (bottom - top) / 2);
    const turnX = right.cx + turnRadius;

    // Follow the row's full vertical extent so scattered dots stay inside the turn.
    if (right.cx !== left.cx) d += ` H ${fmt(right.cx)}`;
    d += ` A ${fmt(turnRadius)} ${fmt(turnRadius)} 0 0 1 ${fmt(turnX)} ${fmt(top + turnRadius)}`;
    if (bottom - top > turnRadius * 2) d += ` L ${fmt(turnX)} ${fmt(bottom - turnRadius)}`;
    d += ` A ${fmt(turnRadius)} ${fmt(turnRadius)} 0 0 1 ${fmt(right.cx)} ${fmt(bottom)}`;
    if (right.cx !== left.cx) d += ` H ${fmt(left.cx)}`;

    const next = rows[index + 1];
    if (next) {
      const nextLeft = next.artists[0];
      const nextTop = Math.min(...next.artists.map((artist) => artist.cy - artist.radius)) - LINE_GAP;
      const verticalDistance = nextTop - bottom;
      // Controls are *both horizontal*. This makes the path leave heading
      // left and arrive heading right, with no sudden angle change.
      // The handles stay proportional to the row separation so the curve
      // makes a broad rounded U rather than a sharp point or diagonal.
      const reach = Math.min(155, Math.max(85, verticalDistance * 0.7));
      d += ` C ${fmt(left.cx - reach)} ${fmt(bottom)}, ${fmt(nextLeft.cx - reach)} ${fmt(nextTop)}, ${fmt(nextLeft.cx)} ${fmt(nextTop)}`;
    } else {
      // End with a smooth left-to-down curve, not an L-shaped corner.
      const exitX = left.cx - 125;
      d += ` C ${fmt(left.cx - 105)} ${fmt(bottom)}, ${fmt(exitX)} ${fmt(height - 90)}, ${fmt(exitX)} ${fmt(height)}`;
    }
  });

  return d;
}

export default function JourneyLinePage() {
  const { id: sessionId } = useParams<{ id: string }>();
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [replay, setReplay] = useState(0);
  const pathRef = useRef<SVGPathElement>(null);
  const marksRef = useRef<(SVGGElement | null)[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const supabase = createClient();
      const { data, error: queryError } = await supabase
        .from("scans")
        .select(`
          id, scanned_at,
          artwork:artworks (
            id, title, x, y,
            artist:artists (id, name, curatorial_group)
          )
        `)
        .eq("session_id", sessionId)
        .order("scanned_at", { ascending: true });

      if (cancelled) return;
      if (queryError) {
        setError(queryError.message);
        setArtists([]);
        setLoading(false);
        return;
      }

      type RawArtist = { id: string; name: string; curatorial_group: string | null };
      type RawArtwork = {
        id: string;
        title: string | null;
        x: number | null;
        y: number | null;
        artist: RawArtist | RawArtist[] | null;
      };
      type RawScan = { artwork: RawArtwork | RawArtwork[] | null };
      const map = new Map<string, Artist>();

      for (const row of data ?? []) {
        const scan = row as unknown as RawScan;
        const artwork = Array.isArray(scan.artwork) ? scan.artwork[0] : scan.artwork;
        if (!artwork) continue;
        const artist = Array.isArray(artwork.artist) ? artwork.artist[0] : artwork.artist;
        if (!artist) continue;

        const artworkEntry: Artwork = {
          id: artwork.id,
          title: artwork.title ?? "Untitled",
          x: artwork.x == null ? null : Number(artwork.x),
          y: artwork.y == null ? null : Number(artwork.y),
        };
        const existing = map.get(artist.id);
        if (existing) {
          if (!existing.artworks.some((entry) => entry.id === artwork.id)) {
            existing.artworks.push(artworkEntry);
          }
        } else {
          map.set(artist.id, {
            id: artist.id,
            name: artist.name,
            group: normalizeGroup(artist.curatorial_group),
            x: artworkEntry.x,
            y: artworkEntry.y,
            artworks: [artworkEntry],
          });
        }
      }

      setArtists([...map.values()]);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [sessionId]);

  const layout = useMemo(() => makeLayout(artists), [artists]);
  const path = useMemo(() => makeLine(layout.rows, layout.height), [layout]);

  useEffect(() => {
    const line = pathRef.current;
    if (!line || !layout.placed.length) return;
    setSelected(null);
    setFinished(false);

    const length = line.getTotalLength();
    const marks = marksRef.current.slice(0, layout.placed.length)
      .filter((mark): mark is SVGGElement => mark !== null);

    gsap.set(line, { strokeDasharray: length, strokeDashoffset: length });
    gsap.set(marks, { opacity: 0, scale: 0.15, transformOrigin: "50% 50%" });

    const duration = Math.max(4, layout.placed.length * 0.85);
    const timeline = gsap.timeline({ onComplete: () => setFinished(true) });
    timeline.to(line, { strokeDashoffset: 0, duration, ease: "none" }, 0);

    // Reveal marks as the line passes their position. Sample the actual SVG
    // path to estimate the first point close to each circle.
    const samples = 500;
    const points = Array.from({ length: samples + 1 }, (_, index) => {
      const distance = (index / samples) * length;
      const point = line.getPointAtLength(distance);
      return { x: point.x, y: point.y, progress: index / samples };
    });

    layout.placed.forEach((artist, index) => {
      const mark = marks[index];
      if (!mark) return;
      let best = { distance: Infinity, progress: 0 };
      for (const point of points) {
        const distance = Math.hypot(point.x - artist.cx, point.y - artist.cy);
        if (distance < best.distance) best = { distance, progress: point.progress };
      }
      timeline.to(mark, {
        opacity: 1,
        scale: 1,
        duration: 0.65,
        ease: "back.out(1.3)",
      }, Math.max(0, best.progress * duration - 0.1));
    });

    return () => { timeline.kill(); };
  }, [layout, path, replay]);

  const activeArtist = layout.placed.find((artist) => artist.id === selected);

  return (
    <main style={{ minHeight: "100vh", background: "var(--background)", color: "#e1dfd2", padding: "28px 18px" }}>
      <div style={{ maxWidth: 850, margin: "0 auto" }}>
        <h1 style={{ fontWeight: 400, marginBottom: 6 }}>
          Your exhibition journey
        </h1>
        <p style={{ fontSize: 13, opacity: 0.65, marginTop: 0 }}>
          {artists.length} artists encountered
        </p>
        {loading && <p>Loading journey…</p>}
        {error && <p role="alert">Could not load journey: {error}</p>}
        {!loading && !error && !artists.length && <p>No scans found for this session.</p>}

        {!loading && layout.placed.length > 0 && (
          <>
            <svg
              viewBox={`0 0 ${WIDTH} ${layout.height}`}
              width="100%"
              preserveAspectRatio="xMidYMid meet"
              aria-label="Animated visitor journey through green, red and purple artists"
              style={{ display: "block", overflow: "visible" }}
            >
              <path
                ref={pathRef}
                d={path}
                fill="none"
                stroke="#799a95"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                pointerEvents="none"
              />

              {layout.placed.map((artist, index) => (
                <g
                  key={artist.id}
                  ref={(element) => { marksRef.current[index] = element; }}
                  onClick={() => { if (finished) setSelected(artist.id); }}
                  style={{ cursor: finished ? "pointer" : "default" }}
                >
                  <title>{artist.name} — {artist.artworks.length} artworks</title>
                  {USE_HANDMADE_MARKS ? (
                    <image
                      href={MARKS[artist.group]}
                      x={artist.cx - artist.radius}
                      y={artist.cy - artist.radius}
                      width={artist.radius * 2}
                      height={artist.radius * 2}
                      preserveAspectRatio="xMidYMid meet"
                    />
                  ) : (
                    <circle
                      cx={artist.cx}
                      cy={artist.cy}
                      r={artist.radius}
                      fill={COLORS[artist.group]}
                    />
                  )}
                  <circle cx={artist.cx} cy={artist.cy} r={artist.radius * 0.85} fill="transparent" />
                </g>
              ))}
            </svg>

            <button
              onClick={() => setReplay((value) => value + 1)}
              style={{ marginTop: 20, padding: "10px 18px", background: "transparent", border: "1px solid #777", cursor: "pointer" }}
            >
              ↻ Replay journey
            </button>

            {activeArtist && (
              <div
                role="dialog"
                aria-modal="true"
                aria-label={`Artworks by ${activeArtist.name}`}
                onClick={() => setSelected(null)}
                style={{ position: "fixed", inset: 0, background: "rgba(247,246,242,0.95)", display: "grid", placeItems: "center", padding: 20, zIndex: 10 }}
              >
                <div
                  onClick={(event) => event.stopPropagation()}
                  style={{ width: "100%", maxWidth: 420, maxHeight: "85vh", overflowY: "auto", background: "white", borderRadius: 16, padding: 28 }}
                >
                  <button
                    onClick={() => setSelected(null)}
                    aria-label="Close artist details"
                    style={{ float: "right", border: 0, background: "transparent", fontSize: 26, cursor: "pointer" }}
                  >×</button>
                  <img src={MARKS[activeArtist.group]} alt="" width={130} height={130} style={{ display: "block", objectFit: "contain", margin: "0 auto" }} />
                  <h2>{activeArtist.name}</h2>
                  <p>Artworks you encountered:</p>
                  <ul>{activeArtist.artworks.map((artwork) => <li key={artwork.id}>{artwork.title}</li>)}</ul>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
