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
// Every colour in the visualisation is BLUE mixed with white: no other hues. Change BLUE to recolour everything.
const BLUE = "#3e0ad9";
// Mixes in RGB, so the lighter tints keep BLUE's hue instead of drifting towards purple.
const tint = (white: number) => d3.rgb(d3.interpolateRgb(BLUE, "#ffffff")(clamp(white, 0, 1))).formatHex();
const ACCENT = tint(0.55); // only on what the visitor is focused on
const ACCENT_TEXT = tint(0.72);
const DISPLAY_FONT = "var(--font-recursive, 'Recursive'), 'Neue Haas Grotesk Text', sans-serif";
const MONO_FONT = "var(--font-recursive, 'Recursive'), 'Neue Haas Grotesk Text Mono', monospace";
const BODY_FONT = "var(--font-atkinson, 'Atkinson Hyperlegible Next'), 'Neue Haas Grotesk Text', sans-serif";
const DISPLAY: CSSProperties = { fontFamily: DISPLAY_FONT, fontVariationSettings: '"CASL" 1', fontWeight: 700 };
const MONO: CSSProperties = { fontFamily: MONO_FONT, fontVariationSettings: '"MONO" 1, "CASL" 1' };
const GLASS: CSSProperties = { backgroundColor: "rgba(239, 239, 232, 0.05)", boxShadow: "inset 1px 1px 5px rgba(239, 239, 232, 0.4)" };


/* ---------- Marks ---------- */
const DOT_RADIUS = 24; // outer ring of the touchpoint dot
const DOT_GROWTH = 5; // a return visit makes the dot a little bigger (up to three times)
const LABEL_SIZE = 18;
const POOL_RADIUS = 62; // hazy glow on the floor under each artist
// How solid the glow is (0-1). Higher is brighter and bluer: a thin, see-through glow mixes with the dark ground and reads purple.
const HAZE_STRENGTH = 1;
const HAZE_BLUR = 18; // softness of the glow's edge; lower keeps more of it bright blue
const HAZE_FILTER_MARGIN = Math.ceil(HAZE_BLUR * 3.5);
const AURA_BLUR = 44;
const AURA_FILTER_MARGIN = Math.ceil(AURA_BLUR * 3.5);
const CARD_WIDTH = 148;
const CARD_HEIGHT = 184;
const PHOTO_GAP = 12;
const PHOTO_SPREAD = CARD_WIDTH + PHOTO_GAP;
const BAR_HEIGHT = 176;


type Group = "red" | "green" | "purple";
type JourneyItem = {
  scanId: string;
  artworkId: string;
  name: string;
  artist: string;
  artistDescription: string | null;
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
  artistDescription: string | null;
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

function getArtworkThumbnail(path: string) {
  return path.replace(/\.(?:jpe?g|png)$/i, ".thumb.jpg");
}

function truncate(text: string, maxCharacters: number) {
  return text.length > maxCharacters ? `${text.slice(0, maxCharacters - 1).trimEnd()}…` : text;
}

function wrapDescription(text: string, maxCharacters: number, maxLines: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  while (words.length && lines.length < maxLines) {
    let line = words.shift()!;
    while (words.length && `${line} ${words[0]}`.length <= maxCharacters) {
      line += ` ${words.shift()}`;
    }
    if (words.length && lines.length === maxLines - 1) {
      lines.push(truncate([line, ...words].join(" "), maxCharacters));
      break;
    }
    lines.push(line);
  }
  return lines;
}

function surname(artist: string) {
  return artist.trim().split(/\s+/).at(-1) ?? artist;
}

/* ---------- Colour cloud behind an open collection ---------- */
// When an artist opens, a grainy cloud blooms behind their photos, in BLUE and its white tints.
const AURA_COLORS = [BLUE, tint(0.2), BLUE, tint(0.4)];
const AURA_LINE_COLORS = [BLUE, tint(0.3), tint(0.55), "#1A1A1A", "#1A1A1A"];
// Key icons, drawn like the touchpoint.
const KEY_DOT = `radial-gradient(circle, ${BLUE} 0 33%, ${tint(0.25)} 33% 54%, ${tint(0.55)} 54% 76%, ${tint(0.86)}80 76%)`;
const KEY_PATH = `linear-gradient(90deg, ${tint(0.86)}, ${tint(0.45)})`;
// [x offset, y offset, radius] around the centre of the photos, in canvas units.
const AURA_BLOBS = [[-120, -85, 160], [110, -55, 150], [-70, 105, 140], [135, 115, 130], [6, 12, 120]] as const;
const AURA_REACH = 300; // how far the cloud and its lines reach before fading out into the dark
const AURA_LINES = 9;
const AURA_FUZZY_DOTS = 5;

function hashString(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// Small seeded random generator, so each artist always gets the same lines and dots.
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dotRadius(visits: number) {
  return DOT_RADIUS + DOT_GROWTH * Math.min(3, Math.max(0, visits - 1));
}

function outerRadius(visits: number) {
  return dotRadius(visits) + 6;
}

/* ---------- Colours: BLUE and white, like the printed touchpoint ---------- */
const TINT_RANGE = 0.06; // each artist gets a touch more or less white, so neighbouring dots stay distinct
// The touchpoint's rings from the outside in: size (of the dot radius), how much white is mixed in, and opacity.
const TOUCHPOINT_RINGS = [
  { size: 1, white: 0.86, opacity: 0.3 },
  { size: 0.76, white: 0.55, opacity: 0.7 },
  { size: 0.54, white: 0.25, opacity: 0.95 },
  { size: 0.33, white: 0, opacity: 1 },
] as const;

function bluesFor(seed: number) {
  const shift = (seededRandom(seed)() * 2 - 1) * TINT_RANGE;
  const mix = (white: number) => (white === 0 ? BLUE : tint(white + shift));
  return {
    rings: TOUCHPOINT_RINGS.map((ring) => mix(ring.white)),
    haze: [BLUE, mix(0.18), BLUE],
    path: mix(0.3),
  };
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
  const [expandedArtwork, setExpandedArtwork] = useState<{ path: string; width: number; height: number } | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [themeFilter, setThemeFilter] = useState<Group | null>(null);
  const [keyHidden, setKeyHidden] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const svgRef = useRef<SVGSVGElement | null>(null);
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
        .curve(d3.curveBumpY)([[MODEL_ENTRANCE_POSITION.x, MODEL_ENTRANCE_POSITION.y], [encounterSequence[0].item.x, encounterSequence[0].item.y]])
      : null;
    type Segment = { d: string; index: number; from: string | null; to: string; x1: number; y1: number; x2: number; y2: number };
    const first = encounterSequence[0]?.item;
    return [
      ...(entranceSegment && first ? [{
        d: entranceSegment, index: 0, from: null, to: first.scanId,
        x1: MODEL_ENTRANCE_POSITION.x, y1: MODEL_ENTRANCE_POSITION.y, x2: first.x, y2: first.y,
      } satisfies Segment] : []),
      ...encounterSequence.slice(0, -1).flatMap((visit, index) => {
        const next = encounterSequence[index + 1];
        if (!next) return [];
        const segment = d3.line<[number, number]>().x((point) => point[0]).y((point) => point[1])
          .curve(d3.curveBumpX)([[visit.item.x, visit.item.y], [next.item.x, next.item.y]]);
        return segment ? [{
          d: segment, index: index + 1, from: visit.item.scanId, to: next.item.scanId,
          x1: visit.item.x, y1: visit.item.y, x2: next.item.x, y2: next.item.y,
        } satisfies Segment] : [];
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
      openValue.current.value = 0;
      openTween.current?.kill();
      const pathElements = svgRef.current?.querySelectorAll<SVGPathElement>("[data-journey-segment]") ?? [];
      for (const path of pathElements) path.setAttribute("stroke-dashoffset", "1");
      const values = { journey: 0 };
      let renderedJourneyProgress = 0;
      timeline = gsap.timeline({
        onComplete: () => {
          setJourneyProgress(encounterCount);
          setStage("complete");
        },
      });
      timeline.to(values, {
        journey: encounterCount,
        duration: Math.max(1.2, encounterCount * 0.6),
        ease: "none",
        onUpdate: () => {
          for (const path of pathElements) {
            const index = Number(path.dataset.journeySegment);
            const progress = Math.max(0, Math.min(1, values.journey - index));
            path.setAttribute("stroke-dashoffset", String(1 - progress));
          }
          const completedEncounters = Math.floor(values.journey);
          if (completedEncounters !== renderedJourneyProgress) {
            renderedJourneyProgress = completedEncounters;
            setJourneyProgress(completedEncounters);
          }
        },
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

  function updateOpenProgress(progress: number) {
    const svg = svgRef.current;
    if (!svg) return;
    const value = clamp(progress, 0, 1);

    const dim = svg.querySelector<SVGRectElement>("[data-open-dim]");
    dim?.setAttribute("opacity", String(0.82 * value));

    const aura = svg.querySelector<SVGGElement>("[data-open-aura]");
    if (aura) {
      const centerX = Number(aura.dataset.centerX);
      const centerY = Number(aura.dataset.centerY);
      const bloom = 0.6 + 0.4 * value;
      aura.setAttribute("opacity", String(value));
      aura.setAttribute("transform", `translate(${centerX} ${centerY}) scale(${bloom}) translate(${-centerX} ${-centerY})`);
    }

    for (const card of svg.querySelectorAll<SVGGElement>("[data-open-card]")) {
      const startX = Number(card.dataset.startX);
      const startY = Number(card.dataset.startY);
      const targetX = Number(card.dataset.targetX);
      const targetY = Number(card.dataset.targetY);
      const x = d3.interpolateNumber(startX, targetX)(value);
      const y = d3.interpolateNumber(startY, targetY)(value);
      card.setAttribute("opacity", String(Math.min(1, value * 1.5)));
      card.setAttribute("transform", `translate(${x} ${y}) scale(${0.2 + 0.8 * value})`);
    }

    const info = svg.querySelector<SVGGElement>("[data-open-info]");
    info?.setAttribute("opacity", String(value));
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
      onUpdate: () => updateOpenProgress(openValue.current.value),
    });
  }

  function closeCollection() {
    if (!selected) return;
    openTween.current?.kill();
    setExpandedArtwork(null);
    openTween.current = gsap.to(openValue.current, {
      value: 0, duration: 0.4, ease: "power2.in",
      onUpdate: () => updateOpenProgress(openValue.current.value),
      onComplete: () => setSelected(null),
    });
  }

  if (!items.length) return <p>No artwork scans with positions found for this session.</p>;

  /* ---------- Collection fan ---------- */
  const selectedDot = selected ? dots.find((dot) => dot.scanId === selected) ?? null : null;
  const collection = selectedDot ? getArtistArtworkFiles(selectedDot.artist) : [];
  const artistBioLines = selectedDot
    ? wrapDescription(selectedDot.artistDescription?.trim() || "Artist description unavailable.", 48, 4)
    : [];
  const fanWidth = collection.length * CARD_WIDTH + Math.max(0, collection.length - 1) * PHOTO_GAP;
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
  const blues = new Map(dots.map((dot) => [dot.scanId, bluesFor(hashString(dot.artist))] as const));
  const mainColor = new Map(dots.map((dot) => [dot.scanId, blues.get(dot.scanId)!.path] as const));

  // Hazy glow behind each dot: three soft blobs of BLUE and its white tints.
  const pools = dots.flatMap((dot) => {
    const random = seededRandom(hashString(`${dot.artist}-haze`));
    const reached = dot.encounterIndexes.some((encounterIndex) => visibleJourneyProgress >= encounterIndex + 1);
    const faded = themeFilter !== null && themeFilter !== dot.group;
    return blues.get(dot.scanId)!.haze.map((color, colorIndex) => {
      const angle = colorIndex * 2.1 + random();
      return {
        key: `${dot.scanId}-${colorIndex}`,
        x: dot.x + Math.cos(angle) * 12,
        y: dot.y + Math.sin(angle) * 8,
        r: (POOL_RADIUS - colorIndex * 9) * (dot.visits > 1 ? 1.15 : 1),
        color,
        opacity: reached ? (faded ? 0.25 : 1) : 0,
      };
    });
  });

  const expandedScale = expandedArtwork
    ? Math.min((WIDTH * 0.84) / expandedArtwork.width, (CANVAS_HEIGHT * 0.7) / expandedArtwork.height)
    : 0;
  const expandedWidth = expandedArtwork ? expandedArtwork.width * expandedScale : 0;
  const expandedHeight = expandedArtwork ? expandedArtwork.height * expandedScale : 0;
  const expandedX = (WIDTH - expandedWidth) / 2;
  const expandedY = Math.max(28, (CANVAS_HEIGHT - expandedHeight - 80) / 2);

  return (
    <div style={{ width: "calc(100% + 24px)", maxWidth: 544, margin: "0 -12px", background: "transparent", color: INK, fontFamily: BODY_FONT }}>
      {mode === "final" && (
        <header style={{ padding: "20px 16px 4px" }}>
          <p className="ending-visit-meta" style={{ ...MONO, margin: 0, fontSize: 12, letterSpacing: "0.03em", color: INK_MUTED }}>
            YOUR VISIT · {artistCount} {artistCount === 1 ? "ARTIST" : "ARTISTS"} · {encounterCount} {encounterCount === 1 ? "ENCOUNTER" : "ENCOUNTERS"}
          </p>
          {topGroup && (
            <h2 className="ending-summary" style={{ ...DISPLAY, margin: "6px 0 0", fontSize: 24, lineHeight: 1.15 }}>
              Most of your encounters were with <span style={{ color: ACCENT_TEXT }}>{THEMES[topGroup].short}</span>.
            </h2>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button type="button" onClick={() => (stage === "complete" ? setReplayKey((value) => value + 1) : skipReplay())}
              style={{ ...GLASS, height: 44, padding: "0 14px", border: 0, borderRadius: 8, color: INK, fontFamily: BODY_FONT, fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
              {stage === "complete" ? "\u21bb Replay your path" : "Skip \u00bb"}
            </button>
          </div>
        </header>
      )}

      <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${CANVAS_HEIGHT}`} width="100%" preserveAspectRatio="xMidYMid meet"
        style={{ display: "block", width: "100%", height: "auto", aspectRatio: `${WIDTH} / ${CANVAS_HEIGHT}`, background: "transparent", overflow: "hidden" }}
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
        <defs>
          <filter id={`${uid}-halo`} x="0" y="0" width={WIDTH} height={CANVAS_HEIGHT} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse">
            <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="8" result="grain" />
            <feDisplacementMap in="SourceGraphic" in2="grain" scale="8" xChannelSelector="R" yChannelSelector="G" result="organic" />
            <feGaussianBlur in="organic" stdDeviation="9" />
          </filter>
          <filter id={`${uid}-soft`} x="0" y="0" width={WIDTH} height={CANVAS_HEIGHT} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse">
            <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="13" result="grain" />
            <feDisplacementMap in="SourceGraphic" in2="grain" scale="4" xChannelSelector="R" yChannelSelector="G" result="organic" />
            <feGaussianBlur in="organic" stdDeviation="3" />
          </filter>
          {/* Softened outline: lines glow faintly and fade from the back of the space towards the entrance */}
          <linearGradient id={`${uid}-plan-fade`} gradientUnits="userSpaceOnUse"
            x1={250 * PLAN_SCALE} y1={PLAN_TOP + 10 * PLAN_SCALE} x2={120 * PLAN_SCALE} y2={PLAN_TOP + 370 * PLAN_SCALE}>
            <stop offset="0" stopColor={INK} stopOpacity={0.55} />
            <stop offset="1" stopColor={INK} stopOpacity={0.12} />
          </linearGradient>
          <filter id={`${uid}-plan-glow`} x="-5%" y="-5%" width="110%" height="110%">
            <feGaussianBlur stdDeviation={4} />
          </filter>
          {/* Colour cloud: heavy blur, then the edges break up into grain like a spray-painted print */}
          <filter id={`${uid}-aura`} filterUnits="userSpaceOnUse"
            x={-AURA_FILTER_MARGIN} y={-AURA_FILTER_MARGIN}
            width={WIDTH + AURA_FILTER_MARGIN * 2} height={CANVAS_HEIGHT + AURA_FILTER_MARGIN * 2}
            colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation={AURA_BLUR} result="blurred" />
            <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves={2} seed={7} result="noise" />
            <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="noiseAlpha" />
            <feComposite in="blurred" in2="noiseAlpha" operator="arithmetic" k1={0} k2={1} k3={0.55} k4={-0.27} result="mixed" />
            <feComponentTransfer in="mixed" result="mask"><feFuncA type="discrete" tableValues="0 0.25 0.55 0.8 0.95" /></feComponentTransfer>
            <feComposite in="blurred" in2="mask" operator="in" result="speckled" />
            <feTurbulence type="fractalNoise" baseFrequency="1.05" numOctaves={1} seed={3} result="fine" />
            <feColorMatrix in="fine" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 -2.2 1.25" result="specks" />
            <feComposite in="specks" in2="speckled" operator="in" result="specksInside" />
            <feMerge><feMergeNode in="speckled" /><feMergeNode in="specksInside" /></feMerge>
          </filter>
          {/* Haze: a wide soft glow with fine film grain, no hard patches */}
          <filter id={`${uid}-haze`} filterUnits="userSpaceOnUse"
            x={-HAZE_FILTER_MARGIN} y={-HAZE_FILTER_MARGIN}
            width={WIDTH + HAZE_FILTER_MARGIN * 2} height={CANVAS_HEIGHT + HAZE_FILTER_MARGIN * 2}
            colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation={HAZE_BLUR} result="blurred" />
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={7} result="noise" />
            <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.7 0 0 0 0.55" result="grainMask" />
            <feComposite in="blurred" in2="grainMask" operator="in" result="grainy" />
            <feTurbulence type="fractalNoise" baseFrequency="1.05" numOctaves={1} seed={3} result="fine" />
            <feColorMatrix in="fine" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 -2.2 1.1" result="specks" />
            <feComposite in="specks" in2="grainy" operator="in" result="specksInside" />
            <feMerge><feMergeNode in="grainy" /><feMergeNode in="specksInside" /></feMerge>
          </filter>
          {/* Keeps the touchpoint rings clear but not razor-sharp */}
          <filter id={`${uid}-ring-soft`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation={0.7} />
          </filter>
          <filter id={`${uid}-dot-glow`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation={8} />
          </filter>
          {/* A slight hand-drawn wobble for the outline */}
          <filter id={`${uid}-wobble`} x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves={2} seed={8} result="wave" />
            <feDisplacementMap in="SourceGraphic" in2="wave" scale={6} xChannelSelector="R" yChannelSelector="G" result="moved" />
            <feGaussianBlur in="moved" stdDeviation={0.5} />
          </filter>
          {/* Fuzzy dots: the artists' dots and the dark dots inside the open-collection cloud */}
          <filter id={`${uid}-fuzz`} x="-80%" y="-80%" width="260%" height="260%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation={3.6} result="blurred" />
            <feTurbulence type="fractalNoise" baseFrequency="1.2" numOctaves={1} seed={9} result="noise" />
            <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="noiseAlpha" />
            <feComposite in="blurred" in2="noiseAlpha" operator="arithmetic" k1={0} k2={1} k3={0.8} k4={-0.4} result="mixed" />
            <feComponentTransfer in="mixed" result="mask"><feFuncA type="discrete" tableValues="0 0.5 1" /></feComponentTransfer>
            <feComposite in="blurred" in2="mask" operator="in" />
          </filter>
        </defs>

        {/* Isometric floor plan of the space, always visible: a soft glow under thin, fading lines */}
        <g pointerEvents="none" fill="none" stroke={`url(#${uid}-plan-fade)`} strokeLinejoin="round" strokeLinecap="round">
          <g strokeWidth={6} opacity={0.35} filter={`url(#${uid}-plan-glow)`}>
            <polygon points={PLAN.floor} />
            <polygon points={PLAN.slabTop} />
            <path d={PLAN.columns} />
          </g>
          <g strokeWidth={1.5} opacity={0.6} filter={`url(#${uid}-wobble)`}>
            <polygon points={PLAN.floor} />
            <path d={PLAN.columns} />
            {PLAN.stringers.map((stringer, index) => <polyline key={index} points={stringer} />)}
            <path d={PLAN.treads} />
            <polygon points={PLAN.slabTop} fill={GROUND} fillOpacity={0.55} />
            <polygon points={PLAN.slabFront} />
            <polygon points={PLAN.slabSide} />
          </g>
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

        {/* Hazy blue glow behind each dot */}
        {visibleJourneyProgress > 0 && (
          <g pointerEvents="none" filter={`url(#${uid}-haze)`} opacity={HAZE_STRENGTH}>
            {pools.map((pool) => <circle key={pool.key} cx={pool.x} cy={pool.y} r={pool.r} fill={pool.color} opacity={pool.opacity} />)}
          </g>
        )}

        {/* Path: each stretch blends from one artist's colour to the next */}
        <g pointerEvents="none" opacity={themeFilter || selected ? 0.3 : 0.9}>
          <defs>
            {pathSegments.map((segment) => (
              <linearGradient key={segment.index} id={`${uid}-segment-${segment.index}`} gradientUnits="userSpaceOnUse"
                x1={segment.x1} y1={segment.y1} x2={segment.x2} y2={segment.y2}>
                <stop offset="0" stopColor={segment.from ? mainColor.get(segment.from) : INK} />
                <stop offset="1" stopColor={mainColor.get(segment.to)} />
              </linearGradient>
            ))}
          </defs>
          <g filter={`url(#${uid}-halo)`} opacity={0.45}>
            {pathSegments.map(({ d, index }) => <path key={index} data-journey-segment={index} d={d} fill="none" stroke={`url(#${uid}-segment-${index})`} strokeWidth={11} strokeLinecap="round"
              pathLength={1} strokeDasharray="1" strokeDashoffset={mode === "live" ? 0 : 1} />)}
          </g>
          <g filter={`url(#${uid}-soft)`} opacity={0.35}>
            {pathSegments.map(({ d, index }) => <path key={index} data-journey-segment={index} d={d} fill="none" stroke={`url(#${uid}-segment-${index})`} strokeWidth={4} strokeLinecap="round"
              pathLength={1} strokeDasharray="1" strokeDashoffset={mode === "live" ? 0 : 1} />)}
          </g>
          {pathSegments.map(({ d, index }) => <path key={index} data-journey-segment={index} d={d} fill="none" stroke={`url(#${uid}-segment-${index})`} strokeOpacity={index === 0 ? 0.5 : 0.9} strokeWidth={1.4} strokeLinecap="round"
            pathLength={1} strokeDasharray="1" strokeDashoffset={mode === "live" ? 0 : 1} />)}
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
        {selected && <rect data-open-dim="" x={0} y={0} width={WIDTH} height={CANVAS_HEIGHT} fill={GROUND} opacity={0}
          onClick={(event) => { event.stopPropagation(); closeCollection(); }} />}

        {/* Blue cloud blooming out of the selected dot, behind the photos */}
        {selectedDot && (() => {
          const random = seededRandom(hashString(selectedDot.artist));
          const around = (reach: number) => [fanCenterX + (random() * 2 - 1) * reach, fanCenterY + (random() * 2 - 1) * reach] as const;
          const lines = Array.from({ length: AURA_LINES }, (_, index) => {
            const [x1, y1] = around(AURA_REACH * 0.9);
            const [c1x, c1y] = around(AURA_REACH);
            const [c2x, c2y] = around(AURA_REACH);
            const [x2, y2] = around(AURA_REACH * 0.9);
            return { d: `M${x1} ${y1}C${c1x} ${c1y} ${c2x} ${c2y} ${x2} ${y2}`, color: AURA_LINE_COLORS[index % AURA_LINE_COLORS.length], width: 1 + random() * 0.6 };
          });
          const fuzzyDots = Array.from({ length: AURA_FUZZY_DOTS }, () => {
            const [x, y] = around(AURA_REACH * 0.65);
            return { x, y, r: 7 + random() * 5 };
          });
          return <g data-open-aura="" data-center-x={selectedDot.x} data-center-y={selectedDot.y} pointerEvents="none" opacity={0}
            transform={`translate(${selectedDot.x} ${selectedDot.y}) scale(0.6) translate(${-selectedDot.x} ${-selectedDot.y})`}>
            <defs>
              <radialGradient id={`${uid}-aura-falloff`} gradientUnits="userSpaceOnUse" cx={fanCenterX} cy={fanCenterY} r={AURA_REACH}>
                <stop offset="0.35" stopColor="#fff" />
                <stop offset="1" stopColor="#fff" stopOpacity={0} />
              </radialGradient>
              <mask id={`${uid}-aura-fade`} maskUnits="userSpaceOnUse" x={0} y={0} width={WIDTH} height={CANVAS_HEIGHT}>
                <rect x={0} y={0} width={WIDTH} height={CANVAS_HEIGHT} fill={`url(#${uid}-aura-falloff)`} />
              </mask>
              <linearGradient id={`${uid}-aura-edges`} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={CANVAS_HEIGHT}>
                <stop offset="0" stopColor="#fff" stopOpacity={0} />
                <stop offset={110 / CANVAS_HEIGHT} stopColor="#fff" />
                <stop offset={1 - 60 / CANVAS_HEIGHT} stopColor="#fff" />
                <stop offset="1" stopColor="#fff" stopOpacity={0} />
              </linearGradient>
              <mask id={`${uid}-aura-edge-fade`} maskUnits="userSpaceOnUse" x={0} y={0} width={WIDTH} height={CANVAS_HEIGHT}>
                <rect x={0} y={0} width={WIDTH} height={CANVAS_HEIGHT} fill={`url(#${uid}-aura-edges)`} />
              </mask>
            </defs>
            {/* Two masks: a soft round falloff, and a fade towards the top and bottom of the drawing */}
            <g mask={`url(#${uid}-aura-edge-fade)`}>
              <g mask={`url(#${uid}-aura-fade)`}>
                <g filter={`url(#${uid}-aura)`} opacity={HAZE_STRENGTH}>
                  {AURA_BLOBS.map(([dx, dy, r], index) => (
                    <circle key={index} cx={fanCenterX + dx} cy={fanCenterY + dy} r={r} fill={AURA_COLORS[index % AURA_COLORS.length]} />
                  ))}
                </g>
                <g fill="none" strokeLinecap="round">
                  {lines.map((line, index) => <path key={index} d={line.d} stroke={line.color} strokeOpacity={0.55} strokeWidth={line.width} />)}
                </g>
                {fuzzyDots.map((dot, index) => (
                  <circle key={index} cx={dot.x} cy={dot.y} r={dot.r} fill={GROUND} opacity={0.85} filter={`url(#${uid}-fuzz)`} />
                ))}
              </g>
            </g>
          </g>;
        })()}

        {/* Dots: one per artwork, a ring for every return visit */}
        {dots.map((dot) => {
          const completedVisits = dot.encounterIndexes.filter((encounterIndex) => visibleJourneyProgress >= encounterIndex + 1).length;
          const active = selected === dot.scanId;
          const lit = active || hovered === dot.scanId || (!selected && themeFilter === dot.group);
          const tones = blues.get(dot.scanId)!;
          const radius = dotRadius(Math.max(1, completedVisits));
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
            <circle cx={dot.x} cy={dot.y} r={36} fill="transparent" />
            <circle cx={dot.x} cy={dot.y} r={radius + 12} fill={tones.rings[1]} opacity={lit ? 0.6 : 0.3} filter={`url(#${uid}-dot-glow)`} />
            {/* Concentric rings like the touchpoint in the exhibition: pale outside, deep BLUE in the centre */}
            <g filter={`url(#${uid}-ring-soft)`}>
              {TOUCHPOINT_RINGS.map((ring, ringIndex) => (
                <circle key={ringIndex} cx={dot.x} cy={dot.y} r={radius * ring.size} fill={tones.rings[ringIndex]} opacity={ring.opacity} />
              ))}
            </g>
            {/* Highlight when hovered, focused or selected */}
            <circle className={`${uid}-ring`} cx={dot.x} cy={dot.y} r={radius + 7} fill="none" pointerEvents="none"
              stroke={lit ? "#FFFFFF" : "transparent"} strokeOpacity={0.85} strokeWidth={1.6}
              style={lit ? { filter: `drop-shadow(0 0 6px ${tones.rings[1]})` } : undefined} />
          </g>;
        })}

        {/* Collection: show the artist's works as separate, unframed photos */}
        {selectedDot && collection.map((path, index) => {
          const middle = index - (collection.length - 1) / 2;
          const isFront = index === front;
          const targetX = fanCenterX + middle * PHOTO_SPREAD;
          const title = getArtworkTitle(path);
          return <g key={path} data-open-card="" data-start-x={selectedDot.x} data-start-y={selectedDot.y} data-target-x={targetX} data-target-y={fanCenterY}
            role="button" tabIndex={0} className={`${uid}-focus`}
            aria-label={isFront ? `Enlarge ${title}` : `Select ${title}`}
            opacity={0}
            transform={`translate(${selectedDot.x} ${selectedDot.y}) scale(0.2)`}
            style={{ cursor: isFront ? "zoom-in" : "pointer" }}
            onClick={(event) => { event.stopPropagation(); if (isFront) showArtwork(path); else setFront(index); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                if (isFront) showArtwork(path); else setFront(index);
              }
            }}>
            <image href={getArtworkThumbnail(path)} x={-CARD_WIDTH / 2} y={-CARD_HEIGHT / 2}
              width={CARD_WIDTH} height={CARD_HEIGHT} preserveAspectRatio="xMidYMid slice"
              style={{ filter: isFront ? "drop-shadow(0 0 14px rgba(255,255,255,0.5))" : "drop-shadow(0 6px 14px rgba(0,0,0,0.35))" }} />
          </g>;
        })}

        {/* Info bar for the card in front */}
        {selectedDot && <g data-open-info="" opacity={0} onClick={(event) => event.stopPropagation()}>
          <rect x={10} y={barY} width={WIDTH - 20} height={BAR_HEIGHT} rx={8} fill="#141414" fillOpacity={0.9}
            stroke={ACCENT} strokeOpacity={0.6} strokeWidth={1.5} />
          <text x={30} y={barY + 28} fontSize={21} fill={ACCENT_TEXT} style={DISPLAY}>
            {selectedDot.artist}
          </text>
          <text x={30} y={barY + 48} fontSize={12} fill={INK_MUTED} style={MONO}>
            {`${selectedDot.order} · ${THEMES[selectedDot.group].short.toUpperCase()}${selectedDot.visits > 1 ? ` · ${selectedDot.visits} VISITS` : ""}`}
          </text>
          <text x={30} y={barY + 72} fontSize={16} fill={INK} style={{ fontFamily: BODY_FONT }}>
            {artistBioLines.map((line, index) => <tspan key={index} x={30} dy={index === 0 ? 0 : 17}>{line}</tspan>)}
          </text>
          <text x={30} y={barY + 146} fontSize={20} fill={INK} style={{ fontFamily: BODY_FONT, fontWeight: 700 }}>
            {frontPath ? truncate(getArtworkTitle(frontPath), 36) : "No images for this artist yet"}
          </text>
          <text x={30} y={barY + 165} fontSize={12} fill={INK_MUTED} style={MONO}>
            {collection.length ? `IMAGE ${front + 1} OF ${collection.length} · TAP A CARD TO BRING IT FORWARD` : ""}
          </text>
          {frontPath && <g role="button" tabIndex={0} className={`${uid}-focus`} aria-label={`Enlarge ${getArtworkTitle(frontPath)}`} style={{ cursor: "zoom-in" }}
            onClick={(event) => { event.stopPropagation(); showArtwork(frontPath); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); showArtwork(frontPath); }
            }}>
            <rect x={WIDTH - 20 - 166} y={barY + 58} width={156} height={56} rx={8} fill={INK} />
            <text x={WIDTH - 20 - 88} y={barY + 92} textAnchor="middle" fontSize={18} fill={GROUND} style={{ fontFamily: BODY_FONT, fontWeight: 700 }}>
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
            <div className="ending-legend" style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12, color: "rgba(239,239,232,0.75)", minHeight: 44 }}>
              <span className="ending-legend__item" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", background: KEY_DOT }} />artist
              </span>
              <span className="ending-legend__item" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span aria-hidden="true" style={{ width: 18, height: 2, borderRadius: 1, background: KEY_PATH }} />your path
              </span>
              <span className="ending-legend__item" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: "50%", background: KEY_DOT }} />bigger: you came back
              </span>
              <span aria-hidden="true" className="ending-legend__spacer" style={{ flex: 1 }} />
              <button type="button" aria-label="Hide key" className="ending-legend__close" onClick={() => setKeyHidden(true)}
                style={{ width: 44, height: 44, border: 0, background: "transparent", color: INK_MUTED, cursor: "pointer", fontSize: 16 }}>
                {"×"}
              </button>
            </div>
          )}

          <div style={{ ...GLASS, borderRadius: 8, padding: 10, marginTop: 6 }}>
            <p style={{ ...MONO, margin: "0 6px 6px", fontSize: 11, color: INK_MUTED }}>THEMES</p>
            <div role="group" aria-label="Themes" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {themeStats.map(({ group, artists, encounters: groupEncounters }) => {
                const on = themeFilter === group;
                return <button key={group} type="button" aria-pressed={on}
                  onClick={() => { closeCollection(); setThemeFilter(on ? null : group); }}
                  style={{
                    minHeight: 46, padding: "6px 8px", display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "left",
                    border: 0, borderRadius: 6, cursor: "pointer", color: INK, fontFamily: BODY_FONT,
                    background: on ? `${ACCENT}1A` : "transparent", boxShadow: on ? `inset 0 0 0 1px ${ACCENT}` : "none",
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
