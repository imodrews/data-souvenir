"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import * as d3 from "d3";
import gsap from "gsap";
import { createClient } from "../../../lib/supabase/client";
import FloorPlanSvg from "../../components/FloorPlan";

// Standalone prototype. Does not modify /d3-test/[id].
// Replace the simplified floor plan below with your traced SVG later.
const WIDTH = 694;
const HEIGHT = 400;

const WHITE_CIRCLE_SCALE = 1.6;
const WHITE_CIRCLE_Y_OFFSET = 15;


// Each artwork grows through three PNG frames once during the journey.
const MARK_FRAMES: Record<Group, readonly string[]> = {
  red: ["/marks/red/2/01.png", "/marks/red/2/02.png", "/marks/red/2/03.png"],
  green: ["/marks/green/2/01.png", "/marks/green/2/02.png", "/marks/green/2/03.png"],
  purple: ["/marks/purple/2/01.png", "/marks/purple/2/02.png", "/marks/purple/2/03.png"],
};

function markFrame(group: Group, index: number, progress: number, stage: string): string {
  const frames = MARK_FRAMES[group];
  if (stage !== "journey" || progress >= index + 1) {
    return frames[frames.length - 1];
  }

  const encounterProgress = Math.max(0, Math.min(1, progress - index));
  if (encounterProgress < 0.72) return frames[0];

  const animationProgress = (encounterProgress - 0.72) / 0.28;
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
};
type PositionedItem = JourneyItem & { targetX: number; targetY: number; radius: number };
type PackDatum = { children?: PackDatum[]; item?: JourneyItem; value?: number };

// These anchors are artistic placeholders, not surveyed floor-plan coordinates.
const ANCHORS: Record<Group, { x: number; y: number; radius: number }> = {
  purple: { x: 112, y: 210, radius: 82 }, // top floor, flattened to the left
  red: { x: 292, y: 210, radius: 83 },
  green: { x: 492, y: 210, radius: 100 },
};
const COLORS: Record<Group, string> = {
  red: "#b85c5c",
  green: "#5f8f68",
  purple: "#8064a2",
};

function normalizeGroup(value: string | null | undefined): Group {
  const group = value?.trim().toLowerCase();
  return group === "green" || group === "purple" || group === "blue"
    ? (group === "blue" ? "purple" : group)
    : "red";
}

function FloorPlan() {
 return (
    <g transform="translate(0 85)">
  <FloorPlanSvg  />
</g>
  );
}

export default function FloorTestPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;
  const [items, setItems] = useState<JourneyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<"journey" | "packing" | "packed">("journey");
  const [journeyProgress, setJourneyProgress] = useState(0);
  const [packProgress, setPackProgress] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoomProgress, setZoomProgress] = useState(0);
  const [replayKey, setReplayKey] = useState(0);
  const zoomTween = useRef<gsap.core.Tween | null>(null);
  const zoomValue = useRef({ value: 0 });

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
          return [{
            scanId: String(scan.id),
            artworkId: artwork.id,
            name: artwork.title ?? "Untitled",
            artist: artist?.name ?? "Unknown artist",
            group: normalizeGroup(artist?.curatorial_group),
            x: Number(artwork.x),
            // Your original journey uses a 694 × 231 floor-plan coordinate space.
            y: 105 + (Number(artwork.y) / 231) * 190,
          } satisfies JourneyItem];
        });
        setItems(normalized);
      }
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [sessionId]);

  // Pack each curatorial group separately, then position it on the flattened plan.
  const positioned = useMemo<PositionedItem[]>(() => {
    const byId = new Map<string, PositionedItem>();
    for (const group of ["purple", "red", "green"] as const) {
      const members = items.filter((item) => item.group === group);
      if (!members.length) continue;
      const anchor = ANCHORS[group];
      const diameter = anchor.radius * 2;
      const packData: PackDatum = { children: members.map((item) => ({ item, value: 1 })) };
      const hierarchy = d3.hierarchy<PackDatum>(packData).sum((d) => d.value ?? 0);
      const packed = d3.pack<PackDatum>().size([diameter, diameter]).padding(7)(hierarchy);
      for (const leaf of packed.leaves()) {
        const item = leaf.data.item;
        if (!item) continue;
        byId.set(item.scanId, {
          ...item,
          targetX: anchor.x - anchor.radius + leaf.x,
          targetY: anchor.y - anchor.radius + leaf.y,
          radius: Math.max(8, leaf.r),
        });
      }
    }
    return items.flatMap((item) => {
      const found = byId.get(item.scanId);
      return found ? [found] : [];
    });
  }, [items]);

  useEffect(() => {
    if (!positioned.length) return;
    setStage("journey");
    setJourneyProgress(0);
    setPackProgress(0);
    setSelected(null);
    setZoomProgress(0);
    zoomValue.current.value = 0;
    zoomTween.current?.kill();

    const values = { journey: 0, packing: 0 };
    const timeline = gsap.timeline();
    timeline.to(values, {
      journey: positioned.length,
      duration: Math.max(1.2, positioned.length * 0.8),
      ease: "none",
      onUpdate: () => setJourneyProgress(values.journey),
    });
    timeline.to({}, { duration: 0.6 });
    timeline.call(() => setStage("packing"));
    timeline.to(values, {
      packing: 1,
      duration: 2.3,
      ease: "power2.inOut",
      onUpdate: () => setPackProgress(values.packing),
    });
    timeline.call(() => setStage("packed"));
    return () => { timeline.kill(); };
  }, [positioned, replayKey]);

  useEffect(() => () => { zoomTween.current?.kill(); }, []);

  function enterOrExit(scanId: string) {
    if (stage !== "packed") return;
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

  const path = d3.line<[number, number]>().x((d) => d[0]).y((d) => d[1])
    .curve(d3.curveBumpX)(positioned.map((item) => [item.x, item.y]));

  return (
    <main style={{ minHeight: "100vh", padding: "28px 18px", background: "#ffffff", color: "#222" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ fontFamily: "serif", fontWeight: 400 }}>Your exhibition constellation</h1>
        <p style={{ fontSize: 13, opacity: 0.65 }}>
          A flattened interpretation of both floors · {positioned.length} encounters
        </p>
        {loading && <p>Loading scans…</p>}
        {error && <p role="alert">Could not load scans: {error}</p>}
        {!loading && !error && !positioned.length && <p>No artwork scans found for this session.</p>}
        {!loading && positioned.length > 0 && (
          <>
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              width="100%"
              style={{ display: "block", background: "white", overflow: "hidden" }}
              onClick={exitZoom}
              aria-label="Visitor journey and interactive constellation"
            >
              <FloorPlan />
              {/* The path is a sequence of encounters, not a measured walking route. */}
              {path && (
                <path d={path} fill="none" stroke="#555" strokeWidth={2}
                  opacity={(1 - packProgress) * 0.65}
                  pathLength={1} strokeDasharray="1"
                  strokeDashoffset={1 - Math.min(1, journeyProgress / Math.max(1, positioned.length))}
                  pointerEvents="none" />
              )}
              {(["purple", "red", "green"] as const).map((group) => {
              
                const anchor = ANCHORS[group];
                const visited = positioned.some((item) => item.group === group);
                  const size = anchor.radius * 4 * WHITE_CIRCLE_SCALE;
                return visited ? (
                  <g key={group}  opacity={packProgress * (selected ? 1 - zoomProgress : 1)} pointerEvents="none">
<image
  href="/marks/white.png"
  x={anchor.x - size / 2}
  y={anchor.y - size / 2 + WHITE_CIRCLE_Y_OFFSET}
  width={size}
  height={size}
  preserveAspectRatio="xMidYMid meet"
  style={{ pointerEvents: "none" }}
/>
                    <text x={anchor.x} y={anchor.y + anchor.radius + 15} textAnchor="middle" fill={COLORS[group]} fontSize="12">{group.toUpperCase()}</text>
                  </g>
                ) : null;
              })}
              {positioned.map((item, index) => {
                if (stage === "journey" && journeyProgress < index) return null;
                const x = d3.interpolateNumber(item.x, item.targetX)(packProgress);
                const y = d3.interpolateNumber(item.y, item.targetY)(packProgress);
                const size = d3.interpolateNumber(42, item.radius * 2)(packProgress);
                const active = selected === item.scanId;
                const displayX = active ? d3.interpolateNumber(x, WIDTH / 2)(zoomProgress) : x;
                const displayY = active ? d3.interpolateNumber(y, HEIGHT / 2)(zoomProgress) : y;
                const displaySize = active ? d3.interpolateNumber(size, WIDTH * 0.9)(zoomProgress) : size;
                const opacity = !selected || active ? 1 : 1 - zoomProgress;
                return (
                  <g key={item.scanId} opacity={opacity} style={{ cursor: stage === "packed" ? "pointer" : "default" }}
                    pointerEvents={selected && !active ? "none" : "auto"}
                    onClick={(event) => { event.stopPropagation(); enterOrExit(item.scanId); }}>
                    <title>{`${item.artist} — ${item.name}`}</title>
                    <image href={markFrame(item.group, index, journeyProgress, stage)} x={displayX - displaySize / 2} y={displayY - displaySize / 2}
                      width={displaySize} height={displaySize} preserveAspectRatio="xMidYMid meet" />
                    <circle cx={displayX} cy={displayY} r={displaySize * 0.38} fill="transparent" />
                  </g>
                );
              })}
            </svg>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
              <button onClick={() => setReplayKey((value) => value + 1)}
                style={{ padding: "9px 16px", border: "1px solid #777", borderRadius: 3, background: "transparent", cursor: "pointer" }}>
                ↻ Replay
              </button>
              <span style={{ fontSize: 12, opacity: 0.6 }}>
                {stage === "packed" ? "Tap a mark to zoom; tap again to return" : "Reconstructing your encounters…"}
              </span>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
