"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as d3 from "d3";
import gsap from "gsap";
import { createClient } from "../../../lib/supabase/client";
import { getFinishedVisits, getFinalVisitPath, type FinishedVisit } from "../../../lib/session";
import FloorPlan from "../../components/FloorPlan";

// Standalone prototype. Does not modify /d3-test/[id].
// Replace the simplified floor plan below with your traced SVG later.
const WIDTH = 694;
const HEIGHT = 900;
const JOURNEY_LAYOUT_MARGIN = 30;

const WHITE_CIRCLE_SCALE = 1.6;
const WHITE_CIRCLE_Y_OFFSET = 15;


// Each artwork grows through three PNG frames once during the journey.
const MARK_FRAMES: Record<Group, readonly string[]> = {
  red: ["/marks/blue-dot.png", "/marks/blue-dot.png", "/marks/blue-dot.png"],
  green: ["/marks/blue-dot.png", "/marks/blue-dot.png", "/marks/blue-dot.png"],
  purple: ["/marks/blue-dot.png", "/marks/blue-dot.png", "/marks/blue-dot.png"],
};
const MARK_REVEAL_START = 0.10;

function markFrame(group: Group, index: number, progress: number, stage: string): string {
  const frames = MARK_FRAMES[group];
  if (stage !== "journey" || progress >= index + 1) {
    return frames[frames.length - 1];
  }

  const encounterProgress = Math.max(0, Math.min(1, progress - index));
  if (encounterProgress < MARK_REVEAL_START) return frames[0];

  const animationProgress = (encounterProgress - MARK_REVEAL_START) / (1 - MARK_REVEAL_START);
  const frameIndex = Math.min(
    frames.length - 1,
    1 + Math.floor(animationProgress * (frames.length - 1)),
  );
  return frames[frameIndex];
}

type Group = "red" | "green" | "purple";
type JourneyItem = {
  scanId: string;
  artworkId: string;
  name: string;
  artist: string;
  group: Group;
  x: number;
  y: number;
  encounterIndexes: number[];
};
type PositionedItem = JourneyItem;

function getJourneyMarkSize(itemCount: number): number {
  return Math.max(110, Math.min(280, 420 / Math.sqrt(itemCount || 1)));
}

// These anchors are artistic placeholders, not surveyed floor-plan coordinates.
const ANCHORS: Record<Group, { x: number; y: number; radius: number }> = {
  green: { x: 347, y: 180, radius: 82 },
  red: { x: 347, y: 450, radius: 83 },
  purple: { x: 347, y: 720, radius: 100 },
};
const COLORS: Record<Group, string> = {
  red: "#b85c5c",
  green: "#5f8f68",
  purple: "#8064a2",
};
const GROUP_LABELS: Record<Group, string> = {
  red: "Sichtbarkeit des Ungesehenen, »Nicht-Präsenz«",
  green: "Erinnerungskultur, Trauma und verdrängteGeschichte(n)",
  purple: "Realität oder Simulation –das Spiel mit der Wahrnehmung, Passagen Möglichen",
};

function normalizeGroup(value: string | null | undefined): Group {
  const group = value?.trim().toLowerCase();
  return group === "green" || group === "purple" || group === "blue"
    ? (group === "blue" ? "purple" : group)
    : "red";
}

// function FloorPlan() {
//   return (
//     <g transform="translate(0 85)">
//       <defs>
//         <clipPath id="blueprint-floorplan-clip">
//           <rect x={0} y={0} width={WIDTH} height={231} />
//         </clipPath>
//       </defs>
//       <image
//         href="/blueprint-5.png"
//         x={-43}
//         y={-42}
//         width={781}
//         height={315}
//         preserveAspectRatio="none"
//         clipPath="url(#blueprint-floorplan-clip)"
//         pointerEvents="none"
//       />
//     </g>
//   );
// }

export default function FloorTestPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;
  const [items, setItems] = useState<JourneyItem[]>([]);
  const [previousVisits, setPreviousVisits] = useState<FinishedVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<"journey" | "labels" | "complete">("journey");
  const [journeyProgress, setJourneyProgress] = useState(0);
  const [labelsProgress, setLabelsProgress] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [zoomProgress, setZoomProgress] = useState(0);
  const [replayKey, setReplayKey] = useState(0);
  const zoomTween = useRef<gsap.core.Tween | null>(null);
  const zoomValue = useRef({ value: 0 });

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
        .select(`id, scanned_at, artwork:artworks (id, title, x, y, artist:artists (name, curatorial_group))`)
        .eq("session_id", sessionId)
        .order("scanned_at", { ascending: true });
      if (cancelled) return;
      if (queryError) {
        setError(queryError.message);
        setItems([]);
      } else {
        // Supabase nested relation types vary by generated schema. Normalize here.
        let encounterIndex = 0;
        const normalized = (data ?? []).flatMap((raw) => {
          const scan = raw as unknown as {
            id: string | number;
            artwork: {
              id: string; title: string | null; x: number | null; y: number | null;
              artist: { name: string; curatorial_group: string | null } | null;
            } | { id: string; title: string | null; x: number | null; y: number | null;
              artist: { name: string; curatorial_group: string | null } | null }[] | null;
          };
          const artwork = Array.isArray(scan.artwork) ? scan.artwork[0] : scan.artwork;
          if (!artwork || artwork.x == null || artwork.y == null) return [];
          const artist = Array.isArray(artwork.artist) ? artwork.artist[0] : artwork.artist;
          const currentEncounterIndex = encounterIndex;
          encounterIndex += 1;
          return [{
            scanId: String(scan.id),
            artworkId: artwork.id,
            name: artwork.title ?? "Untitled",
            artist: artist?.name ?? "Unknown artist",
            group: normalizeGroup(artist?.curatorial_group),
            x: Number(artwork.x),
            // Your original journey uses a 694 × 231 floor-plan coordinate space.
            y: 65 + (Number(artwork.y) / 231) * (HEIGHT - 130),
            encounterIndexes: [currentEncounterIndex],
          } satisfies JourneyItem];
        });
        const uniqueArtworks = new Map<string, JourneyItem>();
        for (const item of normalized) {
          const existing = uniqueArtworks.get(item.artworkId);
          if (existing) {
            existing.encounterIndexes.push(...item.encounterIndexes);
          } else {
            uniqueArtworks.set(item.artworkId, item);
          }
        }
        setItems([...uniqueArtworks.values()]);
      }
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [sessionId]);

  const encounterCount = items.reduce(
    (count, item) => count + item.encounterIndexes.length,
    0
  );
  const journeyMarkSize = getJourneyMarkSize(items.length);

  // Pack each curatorial group separately, then position it on the flattened plan.
  const positioned = useMemo<PositionedItem[]>(() => {
    const dataMinX = Math.min(...items.map((item) => item.x));
    const dataMaxX = Math.max(...items.map((item) => item.x));
    const dataMinY = Math.min(...items.map((item) => item.y));
    const dataMaxY = Math.max(...items.map((item) => item.y));
    const marginX = Math.max(JOURNEY_LAYOUT_MARGIN, journeyMarkSize / 2 + 12);
    const marginY = Math.max(JOURNEY_LAYOUT_MARGIN, journeyMarkSize / 2 + 12);
    const fitCoordinate = (value: number, min: number, max: number, extent: number, margin: number) => {
      if (max <= min) return extent / 2;
      const fittedSpan = (extent - margin * 2) * 0.9;
      const fittedMargin = (extent - fittedSpan) / 2;
      return fittedMargin + ((value - min) / (max - min)) * fittedSpan;
    };
    const purpleXCoordinates = items
      .filter((item) => item.group === "purple")
      .map((item) => fitCoordinate(item.x, dataMinX, dataMaxX, WIDTH, marginX));
    const purpleOffsetX = purpleXCoordinates.length
      ? WIDTH / 2 - (Math.min(...purpleXCoordinates) + Math.max(...purpleXCoordinates)) / 2
      : 0;

    const journeyItems = items.map((item) => ({
      ...item,
      x: fitCoordinate(item.x, dataMinX, dataMaxX, WIDTH, marginX) + (item.group === "purple" ? purpleOffsetX : 0),
      y: fitCoordinate(item.y, dataMinY, dataMaxY, HEIGHT, marginY) + (item.group === "purple" ? 55 : 0),
    }));

    const minCenterDistance = journeyMarkSize * 0.82 + 8;
    const visibleHalfSize = journeyMarkSize * 0.82 / 2;
    const minX = visibleHalfSize + 8;
    const maxX = WIDTH - minX;
    const minY = visibleHalfSize + 8;
    const maxY = HEIGHT - minY;

    // Move only overlapping journey marks; leave already-separated coordinates alone.
    for (let pass = 0; pass < 60; pass += 1) {
      let moved = false;
      for (let firstIndex = 0; firstIndex < journeyItems.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < journeyItems.length; secondIndex += 1) {
          const first = journeyItems[firstIndex];
          const second = journeyItems[secondIndex];
          let dx = second.x - first.x;
          let dy = second.y - first.y;
          let distance = Math.hypot(dx, dy);
          if (distance >= minCenterDistance) continue;

          if (distance < 0.001) {
            const angle = ((firstIndex + secondIndex) % 8) * (Math.PI / 4);
            dx = Math.cos(angle);
            dy = Math.sin(angle);
            distance = 1;
          }

          const push = (minCenterDistance - distance) / 2;
          first.x -= (dx / distance) * push;
          first.y -= (dy / distance) * push;
          second.x += (dx / distance) * push;
          second.y += (dy / distance) * push;
          moved = true;
        }
      }

      journeyItems.forEach((item) => {
        item.x = Math.max(minX, Math.min(maxX, item.x));
        item.y = Math.max(minY, Math.min(maxY, item.y));
      });
      if (!moved) break;
    }

    return journeyItems;
  }, [items, journeyMarkSize]);

  useEffect(() => {
    if (!positioned.length) return;
    setStage("journey");
    setJourneyProgress(0);
    setLabelsProgress(0);
    setSelected(null);
    setZoomProgress(0);
    zoomValue.current.value = 0;
    zoomTween.current?.kill();

    const values = { journey: 0, labels: 0 };
    const timeline = gsap.timeline();
    timeline.to(values, {
      journey: encounterCount,
      duration: Math.max(1.2, encounterCount * 1.0),
      ease: "none",
      onUpdate: () => setJourneyProgress(values.journey),
    });
    timeline.to({}, { duration: 0.6 });
    timeline.call(() => setStage("labels"));
    timeline.to(values, {
      labels: 1,
      duration: 0.8,
      ease: "back.out(1.4)",
      onUpdate: () => setLabelsProgress(values.labels),
    });
    timeline.call(() => setStage("complete"));
    return () => { timeline.kill(); };
  }, [positioned, encounterCount, replayKey]);

  useEffect(() => () => { zoomTween.current?.kill(); }, []);

  function enterOrExit(scanId: string) {
    if (stage !== "complete") return;
    zoomTween.current?.kill();
    if (selected === scanId) {
      zoomTween.current = gsap.to(zoomValue.current, {
        value: 0, duration: 0.9, ease: "power3.inOut",
        onUpdate: () => setZoomProgress(zoomValue.current.value),
        onComplete: () => setSelected(null),
      });
    } else if (!selected) {
      setSelected(scanId);
      zoomTween.current = gsap.to(zoomValue.current, {
        value: 1, duration: 0.9, ease: "power3.inOut",
        onUpdate: () => setZoomProgress(zoomValue.current.value),
      });
    }
  }

  function exitZoom() {
    if (selected) enterOrExit(selected);
  }

  const encounterSequence = positioned
    .flatMap((item) => item.encounterIndexes.map((encounterIndex) => ({ item, encounterIndex })))
    .sort((first, second) => first.encounterIndex - second.encounterIndex);
  const entranceSegment = encounterSequence[0]
    ? d3.line<[number, number]>().x((point) => point[0]).y((point) => point[1])
      .curve(d3.curveBumpY)([[WIDTH / 2, 32], [encounterSequence[0].item.x, encounterSequence[0].item.y]])
    : null;
  const pathSegments = [
    ...(entranceSegment ? [{ d: entranceSegment, index: 0 }] : []),
    ...encounterSequence.slice(0, -1).flatMap((visit, index) => {
    const next = encounterSequence[index + 1];
    if (!next) return [];
    const segment = d3.line<[number, number]>().x((point) => point[0]).y((point) => point[1])
      .curve(d3.curveBumpX)([[visit.item.x, visit.item.y], [next.item.x, next.item.y]]);
    return segment ? [{ d: segment, index: index + 1 }] : [];
    }),
  ];

  return (
    <main style={{ minHeight: "100vh", padding: "28px 18px", background: "#ffffff", color: "#222" }}>
      <div style={{ maxWidth: 520, margin: "0 auto" }}>
        <h1 style={{ fontFamily: "serif", fontWeight: 400 }}>Your exhibition constellation</h1>
        <p style={{ fontSize: 13, opacity: 0.65 }}>
           · {positioned.length} artists collected
        </p>
        {loading && <p>Loading scans…</p>}
        {error && <p role="alert">Could not load scans: {error}</p>}
        {!loading && !error && !positioned.length && <p>No artwork scans found for this session.</p>}
        {!loading && positioned.length > 0 && (
          <>
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              width="100%"
              preserveAspectRatio="xMidYMid meet"
              style={{
                display: "block",
                width: "100%",
                height: "min(742px, calc(100dvh - 220px))",
                background: "#f3f2e6",
                overflow: "hidden",
              }}
              onClick={exitZoom}
              aria-label="Visitor journey and interactive constellation"
            >
              {/* <FloorPlan yOffset={85} /> */}
              <defs>
                <filter id="trace-halo" x="0" y="0" width={WIDTH} height={HEIGHT} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse">
                  <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="8" result="grain" />
                  <feDisplacementMap in="SourceGraphic" in2="grain" scale="8" xChannelSelector="R" yChannelSelector="G" result="organic" />
                  <feGaussianBlur in="organic" stdDeviation="9" />
                </filter>
                <filter id="trace-soft" x="0" y="0" width={WIDTH} height={HEIGHT} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse">
                  <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="13" result="grain" />
                  <feDisplacementMap in="SourceGraphic" in2="grain" scale="4" xChannelSelector="R" yChannelSelector="G" result="organic" />
                  <feGaussianBlur in="organic" stdDeviation="3" />
                </filter>
              </defs>
              <text
                x={WIDTH / 2}
                y={16}
                textAnchor="middle"
                fill="#555"
                fontSize="12"
                pointerEvents="none"
              >
                entrance
              </text>
              <g>
              {/* The path is a sequence of encounters, not a measured walking route. */}
              {pathSegments.map(({ d, index }) => {
                const segmentProgress = Math.max(0, Math.min(1, journeyProgress - index));
                const strokeDashoffset = 1 - segmentProgress;
                return (
                  <g key={index} opacity={0.65} pointerEvents="none">
                    <path d={d} fill="none" stroke="#873c70" strokeWidth={10} strokeLinecap="round"
                      opacity={0.2} pathLength={1} strokeDasharray="1" strokeDashoffset={strokeDashoffset}
                      filter="url(#trace-halo)" />
                    <path d={d} fill="none" stroke="#873c70" strokeWidth={5} strokeLinecap="round"
                      opacity={0.22} pathLength={1} strokeDasharray="1" strokeDashoffset={strokeDashoffset}
                      filter="url(#trace-soft)" />
                  </g>
                );
              })}
              {(["purple", "red", "green"] as const).map((group) => {
              
                const anchor = ANCHORS[group];
                const labelX = anchor.x + anchor.radius + 12;
                const labelY = anchor.y;
                const visited = positioned.some((item) => item.group === group);
                const labelProgress = Math.max(0, Math.min(1, labelsProgress));
                const labelScale = 0.9 + labelProgress * 0.1;
                return visited ? (
                  <g
                    key={group}
                    opacity={labelProgress * (selected ? 1 - zoomProgress : 1)}
                    transform={`translate(${anchor.x} ${anchor.y}) scale(${labelScale}) translate(${-anchor.x} ${-anchor.y})`}
                    pointerEvents="none"
                  >
{/* <image
  href="/marks/purple/2/03.png"
  x={anchor.x - size / 2}
  y={anchor.y - size / 2 + WHITE_CIRCLE_Y_OFFSET}
  width={size}
  height={size}
  preserveAspectRatio="xMidYMid meet"
  style={{ pointerEvents: "none" }}
/> */}
                    <text x={labelX} y={labelY} textAnchor="middle" fill={COLORS[group]} fontSize="6">{GROUP_LABELS[group]}</text>
                  </g>
                ) : null;
              })}
              {positioned.map((item, index) => {
                const firstEncounterIndex = item.encounterIndexes[0];
                if (stage === "journey" && journeyProgress < firstEncounterIndex + 1) return null;
                const completedEncounters = item.encounterIndexes.filter(
                  (encounterIndex) => journeyProgress >= encounterIndex + 1
                ).length;
                const brightness = Math.max(0.45, 1 - Math.max(0, completedEncounters - 1) * 0.18);
                const x = item.x;
                const y = item.y;
                const size = journeyMarkSize;
                const active = selected === item.scanId;
                const displayX = active ? d3.interpolateNumber(x, WIDTH / 2)(zoomProgress) : x;
                const displayY = active ? d3.interpolateNumber(y, HEIGHT / 2)(zoomProgress) : y;
                const displaySize = active ? d3.interpolateNumber(size, WIDTH * 0.9)(zoomProgress) : size;
                const artistFontSize = Math.max(6, Math.min(10, displaySize * 0.105));
                const artistTextWidth = Math.min(displaySize * 0.72, item.artist.length * artistFontSize * 0.6);
                const opacity = !selected || active ? 1 : 1 - zoomProgress;
                return (
                  <g key={item.scanId} opacity={opacity} style={{ cursor: stage === "complete" ? "pointer" : "default" }}
                    pointerEvents={selected && !active ? "none" : "auto"}
                    onMouseEnter={() => { if (stage === "complete") setHovered(item.scanId); }}
                    onMouseLeave={() => setHovered(null)}
                    onClick={(event) => { event.stopPropagation(); enterOrExit(item.scanId); }}>
                    <title>{`${item.artist} — ${item.name}`}</title>
                    <image href={markFrame(item.group, firstEncounterIndex, journeyProgress - 1, stage)} x={displayX - displaySize / 2} y={displayY - displaySize / 2}
                      width={displaySize} height={displaySize} preserveAspectRatio="xMidYMid meet"
                      style={{ filter: `brightness(${brightness})` }} />
                    <circle cx={displayX} cy={displayY} r={displaySize * 0.38} fill="transparent" />
                    {(active || hovered === item.scanId) && (
                      <text x={displayX} y={displayY} textAnchor="middle" dominantBaseline="central"
                        fill="#f3f2e6" fontSize={artistFontSize} fontWeight="400"
                        textLength={artistTextWidth} lengthAdjust="spacingAndGlyphs" pointerEvents="none">
                        {item.artist}
                      </text>
                    )}
                  </g>
                );
              })}
              </g>
            </svg>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
              <button onClick={() => setReplayKey((value) => value + 1)}
                style={{ padding: "9px 16px", border: "1px solid #777", borderRadius: 3, background: "transparent", cursor: "pointer" }}>
                ↻ Replay
              </button>
              <span style={{ fontSize: 12, opacity: 0.6 }}>
                {stage === "complete" ? "Tap a mark to zoom; tap again to return" : "Reconstructing your encounters…"}
              </span>
            </div>
          </>
        )}
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
