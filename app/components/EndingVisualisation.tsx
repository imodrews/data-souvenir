"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import * as d3 from "d3";
import gsap from "gsap";

const WIDTH = 694;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/* ---------- Floor plan: isometric wireframe of the space, drawn in code ---------- */
// Plan units: the hall is 10 wide (x) and 24 deep (y). The mezzanine covers y 0-8 at the back.
const PLAN_SCALE = WIDTH / 358;
const PLAN_TOP = 24;
const SLAB_BOTTOM = 4.5;
const SLAB_TOP = 4.9;
const CANVAS_HEIGHT = Math.round(PLAN_TOP + 372 * PLAN_SCALE);

function iso(x: number, y: number, z = 0) {
  return {
    x: (203 + 14.4 * x - 8 * y) * PLAN_SCALE,
    y: PLAN_TOP + (80 + 4.8 * x + 9.92 * y - 14.4 * z) * PLAN_SCALE,
  };
}

type Point = { x: number; y: number };
const points = (...list: Point[]) => list.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
const line = (a: Point, b: Point) => `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;

const PLAN = (() => {
  const steps = 12;
  const run = 6 / steps;
  const rise = SLAB_BOTTOM / steps;
  const stringer = (x: number) => {
    const profile: Point[] = [iso(x, 8, SLAB_BOTTOM)];
    for (let i = 0; i < steps; i += 1) {
      const z = SLAB_BOTTOM - (i + 1) * rise;
      profile.push(iso(x, 8 + i * run, z), iso(x, 8 + (i + 1) * run, z));
    }
    return points(...profile);
  };
  const treads = Array.from({ length: steps }, (_, i) => {
    const z = SLAB_BOTTOM - (i + 1) * rise;
    return line(iso(4, 8 + i * run, z), iso(5.6, 8 + i * run, z));
  }).join("");
  return {
    floor: points(iso(0, 0), iso(10, 0), iso(10, 24), iso(0, 24)),
    columns: ([[10, 0], [0, 8], [10, 8]] as const).map(([x, y]) => line(iso(x, y), iso(x, y, SLAB_BOTTOM))).join(""),
    stringers: [stringer(4), stringer(5.6)],
    treads,
    slabTop: points(iso(0, 0, SLAB_TOP), iso(10, 0, SLAB_TOP), iso(10, 8, SLAB_TOP), iso(0, 8, SLAB_TOP)),
    slabFront: points(iso(0, 8, SLAB_TOP), iso(0, 8, SLAB_BOTTOM), iso(10, 8, SLAB_BOTTOM), iso(10, 8, SLAB_TOP)),
    slabSide: points(iso(10, 0, SLAB_TOP), iso(10, 0, SLAB_BOTTOM), iso(10, 8, SLAB_BOTTOM), iso(10, 8, SLAB_TOP)),
    upperLabel: { x: 290 * PLAN_SCALE, y: PLAN_TOP + 30 * PLAN_SCALE },
    groundLabel: { x: 300 * PLAN_SCALE, y: PLAN_TOP + 222 * PLAN_SCALE },
  };
})();

/* ---------- Where scan coordinates land in the drawing ---------- */
// Same split as the calibration rows of the old 3-D-14.svg: floorY 0-184 is on the mezzanine,
// 184-231 is the ground floor, from just under the mezzanine edge to the front wall.
const FLOOR_X_MAX = 694;
const FLOOR_Y_MEZZANINE_EDGE = 184;
const FLOOR_Y_MAX = 231;

function getModelPosition(floorX: number, floorY: number) {
  const x = 0.6 + clamp(floorX / FLOOR_X_MAX, 0, 1) * 8.8;
  const y = clamp(floorY, 0, FLOOR_Y_MAX);
  if (y <= FLOOR_Y_MEZZANINE_EDGE) return iso(x, 0.6 + (y / FLOOR_Y_MEZZANINE_EDGE) * 6.8, SLAB_TOP);
  return iso(x, 8.6 + ((y - FLOOR_Y_MEZZANINE_EDGE) / (FLOOR_Y_MAX - FLOOR_Y_MEZZANINE_EDGE)) * 14.8, 0);
}

type Coordinate = readonly [number, number];
const MODEL_ENTRANCE_FLOOR: Coordinate = [694 * 0.46, 231];
const MODEL_ENTRANCE_POSITION = getModelPosition(...MODEL_ENTRANCE_FLOOR);
const ENTRANCE_LABEL_OFFSET = 24;

/* ---------- Look ---------- */
const GROUND = "#111111";
const INK = "#EFEFE8";
const INK_MUTED = "rgba(239, 239, 232, 0.62)";
const ACCENT = "#B4A7FF"; // POI Lilac: only on what the visitor is focused on
const ACCENT_TEXT = "#CFC6FF";
const DISPLAY_FONT = "var(--font-recursive, 'Recursive'), 'Neue Haas Grotesk Text', sans-serif";
const MONO_FONT = "var(--font-recursive, 'Recursive'), 'Neue Haas Grotesk Text Mono', monospace";
const BODY_FONT = "var(--font-atkinson, 'Atkinson Hyperlegible Next'), 'Neue Haas Grotesk Text', sans-serif";
const DISPLAY: CSSProperties = { fontFamily: DISPLAY_FONT, fontVariationSettings: '"CASL" 1', fontWeight: 700 };
const MONO: CSSProperties = { fontFamily: MONO_FONT, fontVariationSettings: '"MONO" 1, "CASL" 1' };
const GLASS: CSSProperties = { backgroundColor: "rgba(239, 239, 232, 0.05)", boxShadow: "inset 1px 1px 5px rgba(239, 239, 232, 0.4)" };

/* ---------- Marks ---------- */
const DOT_RADIUS = 7;
const FIRST_RING = 13; // one ring per return visit
const RING_GAP = 6;
const LABEL_SIZE = 15;
const CARD_WIDTH = 118;
const CARD_HEIGHT = 148;
const CARD_PADDING = 7;
const CARD_PADDING_BOTTOM = 24;
const CARD_SPREAD = 54;
const CARD_TILT = 7;
const BAR_HEIGHT = 92;


type Group = "red" | "green" | "purple";
type JourneyItem = {
  scanId: string;
  artworkId: string;
  name: string;
  artist: string;
  group: Group;
  floorX: number;
  floorY: number;
  x: number;
  y: number;
  encounterIndexes: number[];
};

export type JourneyEncounter = {
  scanId: string;
  artworkId: string;
  name: string;
  artist: string;
  group: string | null | undefined;
  x: number | null;
  y: number | null;
};

const GROUP_ORDER: readonly Group[] = ["red", "green", "purple"];
const THEMES: Record<Group, { short: string; full: string }> = {
  red: { short: "Nicht-Präsenz", full: "Sichtbarkeit des Ungesehenen, »Nicht-Präsenz«" },
  green: { short: "Erinnerung", full: "Erinnerungskultur, Trauma und verdrängte Geschichte(n)" },
  purple: { short: "Simulation", full: "Realität oder Simulation – das Spiel mit der Wahrnehmung, Passagen Möglichen" },
};
const ARTWORK_FILES = [
  "/artwork/01a_Lisa%20Mazenauer_The%20Right%20To%20Forget.jpg",
  "/artwork/01b_Lisa%20Mazenauer_The%20Right%20To%20Forget.jpg",
  "/artwork/02a_Teresa%20Fischer_Nobody%20Wants%20to%20Leave%20Here.jpg",
  "/artwork/03a_Anastasiia%20Batishcheva_Tr%C3%A4ume%20einer%20Menschheitsgeschichte.jpg",
  "/artwork/03b_Anastasiia%20Batishcheva_Tr%C3%A4ume%20einer%20Menschheitsgeschichte.jpg",
  "/artwork/04a_Nora%20Handsley_Good%20Luck%20Around%20Every%20Turn.jpg",
  "/artwork/04b_Nora%20Handsley_Good%20Lucj%20Around%20Every%20Turn.jpg",
  "/artwork/04c_Nora%20Handsley_Good%20Luck%20Around%20Every%20Turn.jpg",
  "/artwork/05a_Vincent%20V%C3%B6lker_Zugang.Struktur.Haltung.png",
  "/artwork/06a_Cedric%20Zellweger_If%20life%20is%20a%20video%20game....jpg",
  "/artwork/06b_Cedric%20Zellweger_If%20life%20is%20a%20video%20game....jpg",
  "/artwork/06c_Cedric%20Zellweger_If%20life%20is%20a%20video%20game...%20behind%20the%20scenes.jpg",
  "/artwork/07a_Pavle%20Nikoli%C4%87_False%20Friends.jpeg",
  "/artwork/07b_Pavle%20Nikoli%C4%87_False%20Friends.jpg",
  "/artwork/08a_Mai%20Do_Every%20Weekend%2C%20Our%20Attic%20Becomes%20Vietnam.jpg",
  "/artwork/08b_Mai%20Do_Every%20Weekend%2C%20Our%20Attic%20Becomes%20Vietnam.jpg",
];

function getArtistArtworkFiles(artist: string) {
  return ARTWORK_FILES.filter((path) => {
    const filename = decodeURIComponent(path.split("/").at(-1) ?? "");
    return filename.match(/^\d+[a-z]_(.+?)_/)?.[1] === artist;
  });
}

function getArtworkTitle(path: string) {
  const filename = decodeURIComponent(path.split("/").at(-1) ?? "");
  return filename.replace(/^\d+[a-z]_[^_]+_/, "").replace(/\.[^.]+$/, "").replace("Good Lucj", "Good Luck");
}

function truncate(text: string, maxCharacters: number) {
  return text.length > maxCharacters ? `${text.slice(0, maxCharacters - 1).trimEnd()}…` : text;
}

function surname(artist: string) {
  return artist.trim().split(/\s+/).at(-1) ?? artist;
}

function outerRadius(visits: number) {
  return visits > 1 ? FIRST_RING + RING_GAP * (visits - 2) : DOT_RADIUS;
}

type Box = readonly [x0: number, y0: number, x1: number, y1: number];
type LabelPlacement = { x: number; y: number; anchor: "start" | "middle" | "end" };
const overlaps = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

// Puts each name below, above, right or left of its dot, whichever is free first.
function placeLabels(dots: { id: string; x: number; y: number; visits: number; text: string }[]) {
  const dotBoxes = new Map<string, Box>(dots.map((dot) => {
    const r = outerRadius(dot.visits) + 2;
    return [dot.id, [dot.x - r, dot.y - r, dot.x + r, dot.y + r]] as const;
  }));
  // Keep names off the ENTRANCE label.
  const entranceHalfWidth = 8 * 12 * 0.6 / 2 + 4;
  const placedBoxes: Box[] = [[
    MODEL_ENTRANCE_POSITION.x - entranceHalfWidth, MODEL_ENTRANCE_POSITION.y - 8,
    MODEL_ENTRANCE_POSITION.x + entranceHalfWidth, MODEL_ENTRANCE_POSITION.y + ENTRANCE_LABEL_OFFSET + 4,
  ]];
  const result = new Map<string, LabelPlacement>();
  for (const dot of dots) {
    const offset = outerRadius(dot.visits) + 6;
    const width = dot.text.length * LABEL_SIZE * 0.6;
    const height = LABEL_SIZE;
    const candidates: { placement: LabelPlacement; box: Box }[] = [
      { placement: { x: dot.x, y: dot.y + offset + height * 0.8, anchor: "middle" }, box: [dot.x - width / 2, dot.y + offset, dot.x + width / 2, dot.y + offset + height] },
      { placement: { x: dot.x, y: dot.y - offset - 3, anchor: "middle" }, box: [dot.x - width / 2, dot.y - offset - height, dot.x + width / 2, dot.y - offset] },
      { placement: { x: dot.x + offset, y: dot.y + height * 0.35, anchor: "start" }, box: [dot.x + offset, dot.y - height / 2, dot.x + offset + width, dot.y + height / 2] },
      { placement: { x: dot.x - offset, y: dot.y + height * 0.35, anchor: "end" }, box: [dot.x - offset - width, dot.y - height / 2, dot.x - offset, dot.y + height / 2] },
    ];
    const free = candidates.find(({ box }) =>
      box[0] >= 4 && box[2] <= WIDTH - 4 && box[1] >= 4 && box[3] <= CANVAS_HEIGHT - 4
      && !placedBoxes.some((other) => overlaps(box, other))
      && ![...dotBoxes].some(([id, other]) => id !== dot.id && overlaps(box, other)));
    const chosen = free ?? candidates[0];
    placedBoxes.push(chosen.box);
    result.set(dot.id, chosen.placement);
  }
  return result;
}

type JourneyVisualisationProps = {
  encounters: JourneyEncounter[];
  mode: "live" | "final";
};

export default function EndingVisualisation({ encounters, mode }: JourneyVisualisationProps) {
  // Strip every character that is not safe in an SVG id.
  const uid = `poi${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [stage, setStage] = useState<"journey" | "complete">("journey");
  const [journeyProgress, setJourneyProgress] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [front, setFront] = useState(0);
  const [openProgress, setOpenProgress] = useState(0);
  const [expandedArtwork, setExpandedArtwork] = useState<{ path: string; width: number; height: number } | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [themeFilter, setThemeFilter] = useState<Group | null>(null);
  const [keyHidden, setKeyHidden] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const openTween = useRef<gsap.core.Tween | null>(null);
  const openValue = useRef({ value: 0 });

  const items = useMemo(() => {
    const uniqueArtworks = new Map<string, JourneyItem>();
    let encounterIndex = 0;
    for (const encounter of encounters) {
      if (encounter.x == null || encounter.y == null) continue;
      const existing = uniqueArtworks.get(encounter.artworkId);
      if (existing) {
        existing.encounterIndexes.push(encounterIndex);
      } else {
        const group = encounter.group?.trim().toLowerCase();
        uniqueArtworks.set(encounter.artworkId, {
          ...encounter,
          group: group === "green" ? "green" : group === "purple" || group === "blue" ? "purple" : "red",
          floorX: Number(encounter.x),
          floorY: Number(encounter.y),
          x: Number(encounter.x),
          y: Number(encounter.y),
          encounterIndexes: [encounterIndex],
        });
      }
      encounterIndex += 1;
    }
    return [...uniqueArtworks.values()];
  }, [encounters]);

  const encounterCount = items.reduce((count, item) => count + item.encounterIndexes.length, 0);
  const visibleJourneyProgress = mode === "live" ? encounterCount : journeyProgress;
  const interactive = mode === "final" && stage === "complete";

  // Spread marks that sit too close together on the floor (unchanged logic).
  const modelPositions = useMemo(() => {
    const modelItems = items.map((item) => ({ ...item, modelFloorX: item.floorX, modelFloorY: item.floorY }));
    const minHorizontalDistance = 140;
    for (let pass = 0; pass < 60; pass += 1) {
      let moved = false;
      for (let firstIndex = 0; firstIndex < modelItems.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < modelItems.length; secondIndex += 1) {
          const first = modelItems[firstIndex];
          const second = modelItems[secondIndex];
          const dx = second.modelFloorX - first.modelFloorX;
          if (Math.abs(dx) >= minHorizontalDistance) continue;
          const direction = dx === 0 ? (firstIndex % 2 === 0 ? 1 : -1) : Math.sign(dx);
          const push = (minHorizontalDistance - Math.abs(dx)) / 2;
          first.modelFloorX = Math.max(12, Math.min(682, first.modelFloorX - direction * push));
          second.modelFloorX = Math.max(12, Math.min(682, second.modelFloorX + direction * push));
          moved = true;
        }
      }
      if (!moved) break;
    }
    return new Map(modelItems.map((item) => [item.scanId, getModelPosition(item.modelFloorX, item.modelFloorY)] as const));
  }, [items]);

  // Every mark stays where its artwork is in the building.
  const dots = useMemo(() => items.map((item, index) => {
    const position = modelPositions.get(item.scanId)!;
    return { ...item, x: position.x, y: position.y, order: String(index + 1).padStart(2, "0"), visits: item.encounterIndexes.length };
  }), [items, modelPositions]);

  const labels = useMemo(
    () => placeLabels(dots.map((dot) => ({ id: dot.scanId, x: dot.x, y: dot.y, visits: dot.visits, text: `${dot.order} ${surname(dot.artist)}` }))),
    [dots],
  );

  const themeStats = useMemo(() => GROUP_ORDER.map((group) => {
    const inGroup = dots.filter((dot) => dot.group === group);
    return {
      group,
      artists: new Set(inGroup.map((dot) => dot.artist)).size,
      encounters: inGroup.reduce((count, dot) => count + dot.visits, 0),
    };
  }).filter((stat) => stat.artists > 0), [dots]);
  const topGroup = themeStats.reduce<(typeof themeStats)[number] | null>(
    (best, stat) => (!best || stat.encounters > best.encounters ? stat : best), null)?.group ?? null;
  const artistCount = new Set(items.map((item) => item.artist)).size;

  const pathSegments = useMemo(() => {
    const encounterSequence = dots
      .flatMap((item) => item.encounterIndexes.map((encounterIndex) => ({ item, encounterIndex })))
      .sort((first, second) => first.encounterIndex - second.encounterIndex);
    const entranceSegment = encounterSequence[0]
      ? d3.line<[number, number]>().x((point) => point[0]).y((point) => point[1])
        .curve(d3.curveLinear)([[MODEL_ENTRANCE_POSITION.x, MODEL_ENTRANCE_POSITION.y], [encounterSequence[0].item.x, encounterSequence[0].item.y]])
      : null;
    return [
      ...(entranceSegment ? [{ d: entranceSegment, index: 0 }] : []),
      ...encounterSequence.slice(0, -1).flatMap((visit, index) => {
        const next = encounterSequence[index + 1];
        if (!next) return [];
        const segment = d3.line<[number, number]>().x((point) => point[0]).y((point) => point[1])
          .curve(d3.curveLinear)([[visit.item.x, visit.item.y], [next.item.x, next.item.y]]);
        return segment ? [{ d: segment, index: index + 1 }] : [];
      }),
    ];
  }, [dots]);

  // Replay: draw the path through the building, one encounter at a time.
  useEffect(() => {
    if (mode === "live" || !items.length) return;
    let timeline: gsap.core.Timeline | undefined;
    const frame = requestAnimationFrame(() => {
      setStage("journey");
      setJourneyProgress(0);
      setSelected(null);
      setExpandedArtwork(null);
      setHovered(null);
      setOpenProgress(0);
      openValue.current.value = 0;
      openTween.current?.kill();
      const values = { journey: 0 };
      timeline = gsap.timeline({ onComplete: () => setStage("complete") });
      timeline.to(values, {
        journey: encounterCount,
        duration: Math.max(1.2, encounterCount * 0.6),
        ease: "none",
        onUpdate: () => setJourneyProgress(values.journey),
      });
      timelineRef.current = timeline;
    });
    return () => {
      cancelAnimationFrame(frame);
      timeline?.kill();
    };
  }, [items, encounterCount, replayKey, mode]);

  useEffect(() => () => { openTween.current?.kill(); }, []);

  function skipReplay() {
    timelineRef.current?.progress(1);
  }

  function showArtwork(path: string) {
    const image = new window.Image();
    image.onload = () => setExpandedArtwork({ path, width: image.naturalWidth, height: image.naturalHeight });
    image.src = path;
  }

  function openCollection(scanId: string) {
    if (!interactive) return;
    openTween.current?.kill();
    setExpandedArtwork(null);
    setFront(0);
    setSelected(scanId);
    openValue.current.value = 0;
    openTween.current = gsap.to(openValue.current, {
      value: 1, duration: 0.6, ease: "power3.out",
      onUpdate: () => setOpenProgress(openValue.current.value),
    });
  }

  function closeCollection() {
    if (!selected) return;
    openTween.current?.kill();
    setExpandedArtwork(null);
    openTween.current = gsap.to(openValue.current, {
      value: 0, duration: 0.4, ease: "power2.in",
      onUpdate: () => setOpenProgress(openValue.current.value),
      onComplete: () => setSelected(null),
    });
  }

  if (!items.length) return <p>No artwork scans with positions found for this session.</p>;

  /* ---------- Collection fan ---------- */
  const selectedDot = selected ? dots.find((dot) => dot.scanId === selected) ?? null : null;
  const collection = selectedDot ? getArtistArtworkFiles(selectedDot.artist) : [];
  const fanWidth = (collection.length - 1) * CARD_SPREAD + CARD_WIDTH;
  const fanCenterX = selectedDot ? clamp(selectedDot.x, fanWidth / 2 + 12, WIDTH - fanWidth / 2 - 12) : 0;
  const fanCenterY = selectedDot
    ? clamp(
      selectedDot.y < CANVAS_HEIGHT * 0.45 ? selectedDot.y + 150 : selectedDot.y - 150,
      CARD_HEIGHT / 2 + 24,
      CANVAS_HEIGHT - BAR_HEIGHT - 20 - CARD_HEIGHT / 2 - 16,
    )
    : 0;
  const frontPath = collection[Math.min(front, collection.length - 1)] ?? null;
  const barY = CANVAS_HEIGHT - BAR_HEIGHT - 10;

  const expandedScale = expandedArtwork
    ? Math.min((WIDTH * 0.84) / expandedArtwork.width, (CANVAS_HEIGHT * 0.7) / expandedArtwork.height)
    : 0;
  const expandedWidth = expandedArtwork ? expandedArtwork.width * expandedScale : 0;
  const expandedHeight = expandedArtwork ? expandedArtwork.height * expandedScale : 0;
  const expandedX = (WIDTH - expandedWidth) / 2;
  const expandedY = Math.max(28, (CANVAS_HEIGHT - expandedHeight - 80) / 2);

  return (
    <div style={{ width: "100%", maxWidth: 520, margin: "0 auto", background: GROUND, color: INK, fontFamily: BODY_FONT }}>
      {mode === "final" && (
        <header style={{ padding: "20px 16px 4px" }}>
          <p style={{ ...MONO, margin: 0, fontSize: 12, letterSpacing: "0.03em", color: INK_MUTED }}>
            YOUR VISIT · {artistCount} {artistCount === 1 ? "ARTIST" : "ARTISTS"} · {encounterCount} {encounterCount === 1 ? "ENCOUNTER" : "ENCOUNTERS"}
          </p>
          {topGroup && (
            <h2 style={{ ...DISPLAY, margin: "6px 0 0", fontSize: 24, lineHeight: 1.15 }}>
              Most of your encounters were with <span style={{ color: ACCENT_TEXT }}>{THEMES[topGroup].short}</span>.
            </h2>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button type="button" onClick={() => (stage === "complete" ? setReplayKey((value) => value + 1) : skipReplay())}
              style={{ ...GLASS, height: 44, padding: "0 14px", border: 0, borderRadius: 8, color: INK, fontFamily: BODY_FONT, fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
              {stage === "complete" ? "↻ Replay your path" : "Skip »"}
            </button>
          </div>
        </header>
      )}

      <svg viewBox={`0 0 ${WIDTH} ${CANVAS_HEIGHT}`} width="100%" preserveAspectRatio="xMidYMid meet"
        style={{ display: "block", width: "100%", height: "auto", aspectRatio: `${WIDTH} / ${CANVAS_HEIGHT}`, background: GROUND, overflow: "hidden" }}
        onClick={() => { if (expandedArtwork) setExpandedArtwork(null); else closeCollection(); }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          if (expandedArtwork) setExpandedArtwork(null); else closeCollection();
        }}
        aria-label={mode === "live" ? "Visitor journey" : "Your path through the exhibition. Select an artist to see their works."}>
        <style>{`
          .${uid}-focus:focus { outline: none; }
          .${uid}-focus:focus-visible .${uid}-ring { stroke: ${ACCENT}; stroke-width: 3; }
        `}</style>

        {/* Isometric floor plan of the space, always visible */}
        <g pointerEvents="none" fill="none" stroke={INK} strokeOpacity={0.3} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round">
          <polygon points={PLAN.floor} />
          <path d={PLAN.columns} />
          {PLAN.stringers.map((stringer, index) => <polyline key={index} points={stringer} strokeWidth={1.2} />)}
          <path d={PLAN.treads} strokeWidth={1.2} />
          <polygon points={PLAN.slabTop} fill={GROUND} />
          <polygon points={PLAN.slabFront} fill={GROUND} />
          <polygon points={PLAN.slabSide} fill={GROUND} />
        </g>
        <g pointerEvents="none" fill={INK} fillOpacity={0.45} fontSize={14} letterSpacing={1.5} style={MONO}>
          <text x={PLAN.upperLabel.x} y={PLAN.upperLabel.y}>LEVEL 2</text>
          <text x={PLAN.groundLabel.x} y={PLAN.groundLabel.y}>LEVEL 1</text>
        </g>
        <g pointerEvents="none">
          <circle cx={MODEL_ENTRANCE_POSITION.x} cy={MODEL_ENTRANCE_POSITION.y} r={4} fill="none" stroke={INK} strokeWidth={1.4} />
          <text x={MODEL_ENTRANCE_POSITION.x} y={MODEL_ENTRANCE_POSITION.y + ENTRANCE_LABEL_OFFSET} textAnchor="middle" fill={INK} fillOpacity={0.5}
            fontSize={12} letterSpacing={1.5} style={MONO}>ENTRANCE</text>
        </g>

        {/* Path */}
        <g pointerEvents="none" opacity={themeFilter || selected ? 0.3 : 0.75}>
          {pathSegments.map(({ d, index }) => <path key={index} d={d} fill="none" stroke={INK} strokeOpacity={index === 0 ? 0.5 : 1}
            strokeWidth={1.6} strokeLinecap="round" pathLength={1} strokeDasharray="1"
            strokeDashoffset={1 - Math.max(0, Math.min(1, visibleJourneyProgress - index))} />)}
        </g>

        {/* Names: number + surname, always visible once the visitor has reached that artist */}
        <g pointerEvents="none">
          {dots.map((dot) => {
            const reached = dot.encounterIndexes.some((encounterIndex) => visibleJourneyProgress >= encounterIndex + 1);
            const lit = selected === dot.scanId || hovered === dot.scanId || themeFilter === dot.group;
            const faded = themeFilter !== null && themeFilter !== dot.group;
            const label = labels.get(dot.scanId)!;
            return <text key={dot.scanId} x={label.x} y={label.y} textAnchor={label.anchor} fontSize={LABEL_SIZE}
              fill={lit ? ACCENT_TEXT : INK} stroke={GROUND} strokeWidth={5} strokeLinejoin="round" paintOrder="stroke"
              opacity={reached ? (faded ? 0.25 : 1) : 0} style={MONO}>
              <tspan fill={INK_MUTED}>{dot.order}</tspan> {surname(dot.artist)}
            </text>;
          })}
        </g>

        {/* Dims the space while a collection is open; tap it to close */}
        {selected && <rect x={0} y={0} width={WIDTH} height={CANVAS_HEIGHT} fill={GROUND} opacity={0.82 * openProgress}
          onClick={(event) => { event.stopPropagation(); closeCollection(); }} />}

        {/* Dots: one per artwork, a ring for every return visit */}
        {dots.map((dot) => {
          const completedVisits = dot.encounterIndexes.filter((encounterIndex) => visibleJourneyProgress >= encounterIndex + 1).length;
          const active = selected === dot.scanId;
          const lit = active || hovered === dot.scanId || (!selected && themeFilter === dot.group);
          let opacity = completedVisits > 0 ? 1 : 0;
          if (selected && !active) opacity *= 0.45;
          else if (!selected && themeFilter && themeFilter !== dot.group) opacity *= 0.25;
          return <g key={dot.scanId} className={`${uid}-focus`} opacity={opacity}
            role={interactive ? "button" : undefined}
            tabIndex={interactive ? 0 : -1}
            aria-label={`${dot.order}, ${dot.artist}, ${dot.name}, ${THEMES[dot.group].short}${dot.visits > 1 ? `, visited ${dot.visits} times` : ""}. Open their works.`}
            style={{ cursor: interactive ? "pointer" : "default" }}
            onMouseEnter={() => { if (interactive) setHovered(dot.scanId); }}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => { if (interactive) setHovered(dot.scanId); }}
            onBlur={() => setHovered(null)}
            onClick={(event) => { event.stopPropagation(); if (active) closeCollection(); else openCollection(dot.scanId); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                if (active) closeCollection(); else openCollection(dot.scanId);
              }
            }}>
            <title>{`${dot.artist} — ${dot.name}`}</title>
            <circle cx={dot.x} cy={dot.y} r={30} fill="transparent" />
            {Array.from({ length: Math.max(0, completedVisits - 1) }, (_, ringIndex) => (
              <circle key={ringIndex} className={`${uid}-ring`} cx={dot.x} cy={dot.y} r={FIRST_RING + RING_GAP * ringIndex}
                fill="none" stroke={lit ? ACCENT : INK} strokeOpacity={lit ? 0.9 : 0.5} strokeWidth={1.4} />
            ))}
            <circle className={`${uid}-ring`} cx={dot.x} cy={dot.y} r={DOT_RADIUS} fill={lit ? ACCENT : INK}
              style={{ filter: lit ? `drop-shadow(0 0 4px ${ACCENT}) drop-shadow(0 0 14px ${ACCENT})` : `drop-shadow(0 0 4px rgba(239,239,232,0.35))` }} />
          </g>;
        })}

        {/* Collection: the artist's works fan out of the dot like a small stack of photos */}
        {selectedDot && collection.map((path, index) => {
          const middle = index - (collection.length - 1) / 2;
          const isFront = index === front;
          const targetX = fanCenterX + middle * CARD_SPREAD;
          const x = d3.interpolateNumber(selectedDot.x, targetX)(openProgress);
          const y = d3.interpolateNumber(selectedDot.y, fanCenterY)(openProgress) + (isFront ? -16 * openProgress : 0);
          const rotation = isFront ? 0 : middle * CARD_TILT * openProgress;
          const scale = (0.2 + 0.8 * openProgress) * (isFront ? 1 + 0.14 * openProgress : 1);
          const title = getArtworkTitle(path);
          return <g key={path} role="button" tabIndex={0} className={`${uid}-focus`}
            aria-label={isFront ? `Enlarge ${title}` : `Bring ${title} to the front`}
            opacity={Math.min(1, openProgress * 1.5)}
            transform={`translate(${x} ${y}) rotate(${rotation}) scale(${scale})`}
            style={{ cursor: isFront ? "zoom-in" : "pointer" }}
            onClick={(event) => { event.stopPropagation(); if (isFront) showArtwork(path); else setFront(index); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                if (isFront) showArtwork(path); else setFront(index);
              }
            }}>
            <rect x={-CARD_WIDTH / 2} y={-CARD_HEIGHT / 2} width={CARD_WIDTH} height={CARD_HEIGHT} rx={3} fill={INK}
              stroke={isFront ? ACCENT : "none"} strokeWidth={isFront ? 4 : 0}
              style={{ filter: isFront ? `drop-shadow(0 0 16px rgba(180,167,255,0.6)) drop-shadow(0 10px 20px rgba(0,0,0,0.5))` : "drop-shadow(0 6px 14px rgba(0,0,0,0.5))" }} />
            <image href={path} x={-CARD_WIDTH / 2 + CARD_PADDING} y={-CARD_HEIGHT / 2 + CARD_PADDING}
              width={CARD_WIDTH - CARD_PADDING * 2} height={CARD_HEIGHT - CARD_PADDING - CARD_PADDING_BOTTOM}
              preserveAspectRatio="xMidYMid slice" />
          </g>;
        })}

        {/* Info bar for the card in front */}
        {selectedDot && <g opacity={openProgress} onClick={(event) => event.stopPropagation()}>
          <rect x={10} y={barY} width={WIDTH - 20} height={BAR_HEIGHT} rx={8} fill="#1E1E1E" fillOpacity={0.95}
            stroke={ACCENT} strokeOpacity={0.7} strokeWidth={1.5} />
          <text x={30} y={barY + 28} fontSize={14} fill={ACCENT_TEXT} style={MONO}>
            {`${selectedDot.order} · ${surname(selectedDot.artist).toUpperCase()} · ${THEMES[selectedDot.group].short.toUpperCase()}${selectedDot.visits > 1 ? ` · ${selectedDot.visits} VISITS` : ""}`}
          </text>
          <text x={30} y={barY + 56} fontSize={22} fill={INK} style={{ fontFamily: BODY_FONT, fontWeight: 700 }}>
            {frontPath ? truncate(getArtworkTitle(frontPath), 36) : "No images for this artist yet"}
          </text>
          <text x={30} y={barY + 78} fontSize={13} fill={INK_MUTED} style={MONO}>
            {collection.length ? `IMAGE ${front + 1} OF ${collection.length} · TAP A CARD TO BRING IT FORWARD` : ""}
          </text>
          {frontPath && <g role="button" tabIndex={0} className={`${uid}-focus`} aria-label={`Enlarge ${getArtworkTitle(frontPath)}`} style={{ cursor: "zoom-in" }}
            onClick={(event) => { event.stopPropagation(); showArtwork(frontPath); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); showArtwork(frontPath); }
            }}>
            <rect x={WIDTH - 20 - 166} y={barY + 18} width={156} height={56} rx={8} fill={INK} />
            <text x={WIDTH - 20 - 88} y={barY + 52} textAnchor="middle" fontSize={18} fill={GROUND} style={{ fontFamily: BODY_FONT, fontWeight: 700 }}>
              Look closer
            </text>
          </g>}
        </g>}

        {/* Enlarged artwork */}
        {expandedArtwork && <g role="dialog" tabIndex={0} aria-label={getArtworkTitle(expandedArtwork.path)}
          onClick={(event) => { event.stopPropagation(); setExpandedArtwork(null); }}>
          <rect x={0} y={0} width={WIDTH} height={CANVAS_HEIGHT} fill={GROUND} opacity={0.96} />
          <image href={expandedArtwork.path} x={expandedX} y={expandedY} width={expandedWidth} height={expandedHeight} preserveAspectRatio="xMidYMid meet" />
          <rect x={expandedX} y={expandedY} width={expandedWidth} height={expandedHeight} fill="none" stroke={INK} strokeOpacity={0.2} strokeWidth={1.5} />
          <text x={WIDTH / 2} y={expandedY + expandedHeight + 40} textAnchor="middle" fontSize={26} fill={INK} style={DISPLAY}>
            {truncate(getArtworkTitle(expandedArtwork.path), 44)}
          </text>
          <text x={WIDTH / 2} y={expandedY + expandedHeight + 66} textAnchor="middle" fontSize={13} letterSpacing={1} fill={INK_MUTED} style={MONO}>
            {`${(selectedDot?.artist ?? "").toUpperCase()} · TAP TO GO BACK`}
          </text>
        </g>}
      </svg>

      {mode === "final" && (
        <div style={{ padding: "4px 16px 20px" }}>
          {!keyHidden && (
            <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12, color: "rgba(239,239,232,0.75)", minHeight: 44 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: INK }} />artist
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span aria-hidden="true" style={{ width: 18, height: 1, background: "rgba(239,239,232,0.75)" }} />your path
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span aria-hidden="true" style={{ position: "relative", width: 14, height: 14, boxSizing: "border-box", border: "1px solid rgba(239,239,232,0.6)", borderRadius: "50%" }}>
                  <span style={{ position: "absolute", left: 3, top: 3, width: 6, height: 6, borderRadius: "50%", background: INK }} />
                </span>you came back
              </span>
              <span style={{ flex: 1 }} />
              <button type="button" aria-label="Hide key" onClick={() => setKeyHidden(true)}
                style={{ width: 44, height: 44, border: 0, background: "transparent", color: INK_MUTED, cursor: "pointer", fontSize: 16 }}>
                {"×"}
              </button>
            </div>
          )}

          <div style={{ ...GLASS, borderRadius: 8, padding: 10, marginTop: 6 }}>
            <p style={{ ...MONO, margin: "0 6px 6px", fontSize: 11, color: INK_MUTED }}>THEMES · TAP ONE TO SEE IT IN THE SPACE</p>
            <div role="group" aria-label="Themes" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {themeStats.map(({ group, artists, encounters: groupEncounters }) => {
                const on = themeFilter === group;
                return <button key={group} type="button" aria-pressed={on}
                  onClick={() => { closeCollection(); setThemeFilter(on ? null : group); }}
                  style={{
                    minHeight: 46, padding: "6px 8px", display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "left",
                    border: 0, borderRadius: 6, cursor: "pointer", color: INK, fontFamily: BODY_FONT,
                    background: on ? "rgba(180,167,255,0.10)" : "transparent", boxShadow: on ? `inset 0 0 0 1px ${ACCENT}` : "none",
                  }}>
                  <span style={{ width: "100%", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ ...DISPLAY, fontSize: 15, color: on || group === topGroup ? ACCENT_TEXT : INK }}>{THEMES[group].short}</span>
                    <span style={{ ...MONO, flexShrink: 0, fontSize: 11, color: INK_MUTED }}>
                      {artists} {artists === 1 ? "artist" : "artists"} · {groupEncounters} {groupEncounters === 1 ? "encounter" : "encounters"}
                    </span>
                  </span>
                  <span style={{ width: "100%", fontSize: 11, color: INK_MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {THEMES[group].full}
                  </span>
                </button>;
              })}
            </div>
          </div>

          <p style={{ ...MONO, margin: "12px 2px 0", fontSize: 12, color: INK_MUTED }}>
            {stage === "complete" ? "TAP A DOT TO SEE THE ARTIST’S WORKS" : "RECONSTRUCTING YOUR ENCOUNTERS…"}
          </p>
        </div>
      )}
    </div>
  );
}
