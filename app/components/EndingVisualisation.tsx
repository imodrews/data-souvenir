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

// The same mapping in plan units (x across, y deep, z height), so dots can be nudged apart inside their level.
type PlanSpot = { x: number; y: number; z: number; yMin: number; yMax: number };
function getPlanSpot(floorX: number, floorY: number): PlanSpot {
  const x = 0.6 + clamp(floorX / FLOOR_X_MAX, 0, 1) * 8.8;
  const y = clamp(floorY, 0, FLOOR_Y_MAX);
  if (y <= FLOOR_Y_MEZZANINE_EDGE) return { x, y: 0.6 + (y / FLOOR_Y_MEZZANINE_EDGE) * 6.8, z: SLAB_TOP, yMin: 0.6, yMax: 7.4 };
  return { x, y: 8.6 + ((y - FLOOR_Y_MEZZANINE_EDGE) / (FLOOR_Y_MAX - FLOOR_Y_MEZZANINE_EDGE)) * 14.8, z: 0, yMin: 8.6, yMax: 23.4 };
}

// Empty space kept between two dots on screen (on top of their own size), so they never stack.
const DOT_GAP = 40;
// Moves a spot by a distance on screen, converted back to plan units and kept inside its level.
function nudge(spot: PlanSpot, screenDx: number, screenDy: number) {
  const u = screenDx / PLAN_SCALE;
  const v = screenDy / PLAN_SCALE;
  const determinant = 14.4 * 9.92 + 8 * 4.8; // inverse of the isometric mapping in iso()
  spot.x = clamp(spot.x + (9.92 * u + 8 * v) / determinant, 0.6, 9.4);
  spot.y = clamp(spot.y + (-4.8 * u + 14.4 * v) / determinant, spot.yMin, spot.yMax);
}
// Pushes dots that are too close apart, a little at a time, so each stays as near as possible to its real place.
function spreadDots(marks: { id: string; floorX: number; floorY: number; visits: number }[]) {
  const spots = marks.map((mark) => ({ ...mark, spot: getPlanSpot(mark.floorX, mark.floorY), size: outerRadius(mark.visits) }));
  for (let pass = 0; pass < 200; pass += 1) {
    let moved = false;
    for (let first = 0; first < spots.length; first += 1) {
      for (let second = first + 1; second < spots.length; second += 1) {
        const a = spots[first];
        const b = spots[second];
        const pa = iso(a.spot.x, a.spot.y, a.spot.z);
        const pb = iso(b.spot.x, b.spot.y, b.spot.z);
        const distance = Math.hypot(pb.x - pa.x, pb.y - pa.y);
        const needed = a.size + b.size + DOT_GAP;
        if (distance >= needed) continue;
        const angle = (first * 2.4 + second) % (Math.PI * 2); // a fixed direction for dots exactly on top of each other
        const ux = distance > 0.01 ? (pb.x - pa.x) / distance : Math.cos(angle);
        const uy = distance > 0.01 ? (pb.y - pa.y) / distance : Math.sin(angle);
        const push = Math.min(12, (needed - distance) / 2 + 0.5);
        nudge(a.spot, -ux * push, -uy * push);
        nudge(b.spot, ux * push, uy * push);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return new Map(spots.map(({ id, spot }) => [id, iso(spot.x, spot.y, spot.z)] as const));
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
const DISPLAY_FONT = '"Neue Haas Grotesk Display", sans-serif';
const MONO_FONT = '"Neue Haas Grotesk Text Mono", monospace';
const BODY_FONT = MONO_FONT;
const DISPLAY: CSSProperties = { fontFamily: DISPLAY_FONT, fontWeight: 700 };
const MONO: CSSProperties = { fontFamily: MONO_FONT };
const GLASS: CSSProperties = { backgroundColor: "rgba(239, 239, 232, 0.05)", boxShadow: "inset 1px 1px 5px rgba(239, 239, 232, 0.4)" };


/* ---------- Marks ---------- */
const DOT_RADIUS = 19; // outer ring of the touchpoint dot
const DOT_GROWTH = 4; // a return visit makes the dot a little bigger (up to three times)
const LABEL_SIZE = 18;
const POOL_RADIUS = 52; // hazy glow on the floor under each artist
// How solid the glow is (0-1). Higher is brighter and bluer: a thin, see-through glow mixes with the dark ground and reads purple.
const HAZE_STRENGTH = 1;
const HAZE_BLUR = 18; // softness of the glow's edge; lower keeps more of it bright blue
const CARD_WIDTH = 148;
const CARD_HEIGHT = 184;
const PHOTO_GAP = 12;
const PHOTO_SPREAD = CARD_WIDTH + PHOTO_GAP;


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
  scannedAt?: string | null;
  x: number | null;
  y: number | null;
};

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

function formatVisitDate(scannedAt: string | null | undefined) {
  if (!scannedAt) return "VISIT DATE UNAVAILABLE";
  const date = new Date(scannedAt);
  if (Number.isNaN(date.getTime())) return "VISIT DATE UNAVAILABLE";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(date);
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

/* ---------- Filtered layers, drawn once as bitmaps ---------- */
// SVG filters (grain, blur, wobble) are recalculated by the browser whenever anything near them changes, which on a
// phone means on every frame of an animation. So each filtered layer is drawn once into a plain bitmap and shown as an
// <image>: it looks the same, but the phone only has to copy pixels. Change the filters below to change the look.

const svgDocument = (box: Box, defs: string, body: string) => {
  const [x0, y0, x1, y1] = box;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${x1 - x0}" height="${y1 - y0}" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}"><defs>${defs}</defs>${body}</svg>`;
};
const boxAround = (x0: number, y0: number, x1: number, y1: number, pad: number): Box =>
  [Math.floor(x0 - pad), Math.floor(y0 - pad), Math.ceil(x1 + pad), Math.ceil(y1 + pad)];

// Smooth value noise (0-1), so the outline can wobble like it was drawn by hand without an expensive SVG filter.
function smoothNoise(seed: number) {
  const size = 64;
  const random = seededRandom(seed);
  const grid = Float32Array.from({ length: size * size }, () => random());
  const at = (i: number, j: number) => grid[(((j % size) + size) % size) * size + (((i % size) + size) % size)];
  const ease = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = ease(x - i);
    const fy = ease(y - j);
    const top = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
    const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
    return top + (bottom - top) * fy;
  };
}

// The outline's hand-drawn wobble: each point is nudged by up to ±WOBBLE/2 following low-frequency noise.
const WOBBLE = 6;
const WOBBLE_FREQUENCY = 0.018;
const wobbleX = smoothNoise(8);
const wobbleY = smoothNoise(9);
function wobbleLine(points: Point[], closed: boolean) {
  const all = closed ? [...points, points[0]] : points;
  const out: Point[] = [];
  all.forEach((point, index) => {
    if (index === 0) { out.push(point); return; }
    const previous = all[index - 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(point.x - previous.x, point.y - previous.y) / 6));
    for (let step = 1; step <= steps; step += 1) {
      out.push({ x: previous.x + ((point.x - previous.x) * step) / steps, y: previous.y + ((point.y - previous.y) * step) / steps });
    }
  });
  const nudged = out.map(({ x, y }) => ({
    x: x + WOBBLE * (wobbleX(x * WOBBLE_FREQUENCY, y * WOBBLE_FREQUENCY) - 0.5),
    y: y + WOBBLE * (wobbleY(x * WOBBLE_FREQUENCY, y * WOBBLE_FREQUENCY) - 0.5),
  }));
  return `M${nudged.map(({ x, y }) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}${closed ? "Z" : ""}`;
}
const parsePoints = (list: string) => list.trim().split(/\s+/).map((pair) => {
  const [x, y] = pair.split(",").map(Number);
  return { x, y };
});
const parseLines = (d: string) => [...d.matchAll(/M\s*([-\d.]+)[ ,]([-\d.]+)\s*L\s*([-\d.]+)[ ,]([-\d.]+)/g)]
  .map((match) => [{ x: +match[1], y: +match[2] }, { x: +match[3], y: +match[4] }]);
// The outline in drawing order: the mezzanine slab is filled so it hides what is behind it.
const PLAN_OUTLINE = [
  { d: wobbleLine(parsePoints(PLAN.floor), true) },
  ...parseLines(PLAN.columns).map((points) => ({ d: wobbleLine(points, false) })),
  ...PLAN.stringers.map((stringer) => ({ d: wobbleLine(parsePoints(stringer), false) })),
  ...parseLines(PLAN.treads).map((points) => ({ d: wobbleLine(points, false) })),
  { d: wobbleLine(parsePoints(PLAN.slabTop), true), filled: true },
  { d: wobbleLine(parsePoints(PLAN.slabFront), true) },
  { d: wobbleLine(parsePoints(PLAN.slabSide), true) },
];
// The faint glow under the outline (a blur, so it is drawn once as a bitmap).
const PLAN_FADE = { x1: 250 * PLAN_SCALE, y1: PLAN_TOP + 10 * PLAN_SCALE, x2: 120 * PLAN_SCALE, y2: PLAN_TOP + 370 * PLAN_SCALE };
const PLAN_GLOW_SVG = svgDocument([0, 0, WIDTH, CANVAS_HEIGHT],
  `<linearGradient id="fade" gradientUnits="userSpaceOnUse" x1="${PLAN_FADE.x1}" y1="${PLAN_FADE.y1}" x2="${PLAN_FADE.x2}" y2="${PLAN_FADE.y2}"><stop offset="0" stop-color="${INK}" stop-opacity="0.55"/><stop offset="1" stop-color="${INK}" stop-opacity="0.12"/></linearGradient>`
  + `<filter id="glow" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="4"/></filter>`,
  `<g fill="none" stroke="url(#fade)" stroke-linejoin="round" stroke-linecap="round" stroke-width="6" opacity="0.35" filter="url(#glow)"><polygon points="${PLAN.floor}"/><polygon points="${PLAN.slabTop}"/><path d="${PLAN.columns}"/></g>`);

// The glow under the path: warped, blurred strokes that blend from one artist's colour to the next.
// Drawn for the whole path, and for each stretch on its own (box), so the replay can fade each stretch in as it is drawn.
type GlowSegment = { d: string; index: number; from: string | null; to: string; x1: number; y1: number; x2: number; y2: number };
const GLOW_PAD = 44; // room around a stretch for its blur and wobble
const segmentBox = (segment: GlowSegment) => boxAround(
  Math.min(segment.x1, segment.x2), Math.min(segment.y1, segment.y2), Math.max(segment.x1, segment.x2), Math.max(segment.y1, segment.y2), GLOW_PAD);
function pathGlowSvg(segments: GlowSegment[], colorFor: (scanId: string | null) => string, box: Box = [0, 0, WIDTH, CANVAS_HEIGHT]) {
  const [bx, by, bx1, by1] = box;
  const region = `x="${bx}" y="${by}" width="${bx1 - bx}" height="${by1 - by}"`;
  const gradients = segments.map((segment) => `<linearGradient id="g${segment.index}" gradientUnits="userSpaceOnUse" x1="${segment.x1}" y1="${segment.y1}" x2="${segment.x2}" y2="${segment.y2}"><stop offset="0" stop-color="${colorFor(segment.from)}"/><stop offset="1" stop-color="${colorFor(segment.to)}"/></linearGradient>`).join("");
  const strokes = (width: number) => segments.map((segment) => `<path d="${segment.d}" fill="none" stroke="url(#g${segment.index})" stroke-width="${width}" stroke-linecap="round"/>`).join("");
  return svgDocument(box, gradients
    + `<filter id="halo" ${region} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="8" result="grain"/><feDisplacementMap in="SourceGraphic" in2="grain" scale="8" xChannelSelector="R" yChannelSelector="G" result="organic"/><feGaussianBlur in="organic" stdDeviation="9"/></filter>`
    + `<filter id="soft" ${region} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse"><feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="13" result="grain"/><feDisplacementMap in="SourceGraphic" in2="grain" scale="4" xChannelSelector="R" yChannelSelector="G" result="organic"/><feGaussianBlur in="organic" stdDeviation="3"/></filter>`,
    `<g filter="url(#halo)" opacity="0.45">${strokes(11)}</g><g filter="url(#soft)" opacity="0.35">${strokes(4)}</g>`);
}

// The haze behind one dot: a wide soft glow with fine film grain, no hard patches.
const HAZE_FILTER = `<filter id="haze" x="-80%" y="-80%" width="260%" height="260%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="${HAZE_BLUR}" result="blurred"/><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise"/><feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.7 0 0 0 0.55" result="grainMask"/><feComposite in="blurred" in2="grainMask" operator="in" result="grainy"/><feTurbulence type="fractalNoise" baseFrequency="1.05" numOctaves="1" seed="3" result="fine"/><feColorMatrix in="fine" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 -2.2 1.1" result="specks"/><feComposite in="specks" in2="grainy" operator="in" result="specksInside"/><feMerge><feMergeNode in="grainy"/><feMergeNode in="specksInside"/></feMerge></filter>`;
function hazeSprite(blobs: { x: number; y: number; r: number; color: string }[]) {
  const box = boxAround(
    Math.min(...blobs.map((blob) => blob.x - blob.r)), Math.min(...blobs.map((blob) => blob.y - blob.r)),
    Math.max(...blobs.map((blob) => blob.x + blob.r)), Math.max(...blobs.map((blob) => blob.y + blob.r)), HAZE_BLUR * 3 + 4);
  const circles = blobs.map((blob) => `<circle cx="${blob.x}" cy="${blob.y}" r="${blob.r}" fill="${blob.color}"/>`).join("");
  return { box, svg: svgDocument(box, HAZE_FILTER, `<g filter="url(#haze)">${circles}</g>`) };
}

// The cloud behind an open collection: heavy blur whose edges break up into grain like a spray-painted print,
// with a few loose lines and fuzzy dark dots, fading out softly in a circle and towards the top and bottom.
const AURA_DEFS = `<filter id="aura" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="44" result="blurred"/><feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="7" result="noise"/><feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="noiseAlpha"/><feComposite in="blurred" in2="noiseAlpha" operator="arithmetic" k1="0" k2="1" k3="0.55" k4="-0.27" result="mixed"/><feComponentTransfer in="mixed" result="mask"><feFuncA type="discrete" tableValues="0 0.25 0.55 0.8 0.95"/></feComponentTransfer><feComposite in="blurred" in2="mask" operator="in" result="speckled"/><feTurbulence type="fractalNoise" baseFrequency="1.05" numOctaves="1" seed="3" result="fine"/><feColorMatrix in="fine" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 -2.2 1.25" result="specks"/><feComposite in="specks" in2="speckled" operator="in" result="specksInside"/><feMerge><feMergeNode in="speckled"/><feMergeNode in="specksInside"/></feMerge></filter>`
  + `<filter id="fuzz" x="-80%" y="-80%" width="260%" height="260%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="3.6" result="blurred"/><feTurbulence type="fractalNoise" baseFrequency="1.2" numOctaves="1" seed="9" result="noise"/><feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="noiseAlpha"/><feComposite in="blurred" in2="noiseAlpha" operator="arithmetic" k1="0" k2="1" k3="0.8" k4="-0.4" result="mixed"/><feComponentTransfer in="mixed" result="mask"><feFuncA type="discrete" tableValues="0 0.5 1"/></feComponentTransfer><feComposite in="blurred" in2="mask" operator="in"/></filter>`;
const auraFalloff = (centerX: number, centerY: number) => `<radialGradient id="falloff" gradientUnits="userSpaceOnUse" cx="${centerX}" cy="${centerY}" r="${AURA_REACH}"><stop offset="0.35" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`
  + `<mask id="fade" maskUnits="userSpaceOnUse" x="${centerX - AURA_REACH}" y="${centerY - AURA_REACH}" width="${AURA_REACH * 2}" height="${AURA_REACH * 2}"><rect x="${centerX - AURA_REACH}" y="${centerY - AURA_REACH}" width="${AURA_REACH * 2}" height="${AURA_REACH * 2}" fill="url(#falloff)"/></mask>`;
// The grainy cloud is the same for every artist, so it is drawn once and placed behind whichever artist is open.
// It is drawn around (AURA_REACH, AURA_REACH); place its top-left corner at (centre - AURA_REACH).
const AURA_CLOUD_SVG = svgDocument([0, 0, AURA_REACH * 2, AURA_REACH * 2], AURA_DEFS + auraFalloff(AURA_REACH, AURA_REACH),
  `<g mask="url(#fade)"><g filter="url(#aura)" opacity="${HAZE_STRENGTH}">${AURA_BLOBS.map(([dx, dy, r], index) => `<circle cx="${AURA_REACH + dx}" cy="${AURA_REACH + dy}" r="${r}" fill="${AURA_COLORS[index % AURA_COLORS.length]}"/>`).join("")}</g></g>`);
// Each artist's own loose lines and fuzzy dark dots on top of the cloud.
function auraDetailsSprite(artist: string, centerX: number, centerY: number, keepClear?: Box) {
  const random = seededRandom(hashString(artist));
  const around = (reach: number) => [centerX + (random() * 2 - 1) * reach, centerY + (random() * 2 - 1) * reach] as const;
  const lines = Array.from({ length: AURA_LINES }, (_, index) => {
    const [x1, y1] = around(AURA_REACH * 0.9);
    const [c1x, c1y] = around(AURA_REACH);
    const [c2x, c2y] = around(AURA_REACH);
    const [x2, y2] = around(AURA_REACH * 0.9);
    return `<path d="M${x1} ${y1}C${c1x} ${c1y} ${c2x} ${c2y} ${x2} ${y2}" stroke="${AURA_LINE_COLORS[index % AURA_LINE_COLORS.length]}" stroke-opacity="0.55" stroke-width="${1 + random() * 0.6}"/>`;
  }).join("");
  const fuzzyDots = Array.from({ length: AURA_FUZZY_DOTS }, () => {
    // A few tries to land outside the name, photos and text, so no dark dot sits on them.
    let [x, y] = around(AURA_REACH * 0.65);
    for (let attempt = 0; keepClear && attempt < 12 && x > keepClear[0] && x < keepClear[2] && y > keepClear[1] && y < keepClear[3]; attempt += 1) {
      [x, y] = around(AURA_REACH * 0.65);
    }
    return `<circle cx="${x}" cy="${y}" r="${7 + random() * 5}" fill="${GROUND}" opacity="0.85" filter="url(#fuzz)"/>`;
  }).join("");
  const box: Box = [Math.floor(centerX - AURA_REACH), Math.floor(centerY - AURA_REACH), Math.ceil(centerX + AURA_REACH), Math.ceil(centerY + AURA_REACH)];
  return { box, svg: svgDocument(box, AURA_DEFS + auraFalloff(centerX, centerY), `<g mask="url(#fade)"><g fill="none" stroke-linecap="round">${lines}</g>${fuzzyDots}</g>`) };
}
/* ---------- Open collection: name on top, photos in the middle, title and description below ---------- */
const NAME_SIZE = 30;
const BIO_LINE = 20;
function collectionLayout(artist: string, description: string | null) {
  const count = getArtistArtworkFiles(artist).length;
  const rowWidth = count * CARD_WIDTH + Math.max(0, count - 1) * PHOTO_GAP;
  const cardScale = Math.min(1, (WIDTH - 32) / Math.max(1, rowWidth)); // many photos: shrink them to fit
  const cardHeight = CARD_HEIGHT * cardScale;
  const bioLines = wrapDescription(description?.trim() || "Artist description unavailable.", 58, 4);
  const blockHeight = 154 + cardHeight + (bioLines.length - 1) * BIO_LINE;
  const nameY = Math.max(24, (CANVAS_HEIGHT - blockHeight) / 2) + 24;
  const metaY = nameY + 22;
  const photosTop = metaY + 20;
  const titleY = photosTop + cardHeight + 32;
  const hintY = titleY + 20;
  return { cardScale, bioLines, centerX: WIDTH / 2, centerY: photosTop + cardHeight / 2, nameY, metaY, titleY, hintY, bioY: hintY + 30 };
}

// The cloud fades out towards the top of the drawing instead of being cut off by its edge.
const AURA_TOP_FADE = 110;

// Draws an SVG into a canvas once and hands back a bitmap URL. Cached for the whole visit, so a replay or
// reopening an artist costs nothing.
const bitmapCache = new Map<string, Promise<string>>();
function rasterise(svg: string, scale: number) {
  const key = `${scale}|${svg}`;
  let pending = bitmapCache.get(key);
  if (!pending) {
    pending = new Promise<string>((resolve, reject) => {
      const image = new window.Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, image.width);
        canvas.height = Math.max(1, image.height);
        const context = canvas.getContext("2d");
        if (!context) { reject(new Error("Canvas unavailable")); return; }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error("Could not draw layer"))));
      };
      image.onerror = reject;
      // Give the SVG the final pixel size itself, so its filters (and the grain) are drawn at full resolution
      // rather than drawn small and stretched.
      const sized = svg.replace(/^<svg([^>]*?) width="([\d.]+)" height="([\d.]+)"/,
        (_match, attributes, width, height) => `<svg${attributes} width="${Math.round(+width * scale)}" height="${Math.round(+height * scale)}"`);
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
    });
    bitmapCache.set(key, pending);
  }
  return pending;
}

// How sharp each baked layer is, relative to the screen. Soft, blurred layers look the same at lower resolution
// and are much quicker to draw; the grainy haze keeps full resolution so its grain stays fine.
const LAYER_DETAIL = { planGlow: 0.5, glow: 0.5, haze: 1, aura: 1 } as const;
type Layer = { svg: string; detail: number };

// Waits for a quiet moment, so drawing layers never holds up the animation for long.
const idle = () => new Promise<void>((resolve) => {
  if ("requestIdleCallback" in window) window.requestIdleCallback(() => resolve(), { timeout: 300 });
  else setTimeout(resolve, 60);
});

// Draws the given layers one after another, in order, and returns each bitmap URL once it is ready.
function useBitmaps(layers: Record<string, Layer>, scale: number | null) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (scale === null) return;
    let cancelled = false;
    (async () => {
      for (const [key, layer] of Object.entries(layers)) {
        const layerScale = Math.max(0.5, Math.round(scale * layer.detail * 100) / 100);
        const cached = bitmapCache.has(`${layerScale}|${layer.svg}`);
        if (!cached) await idle();
        if (cancelled) return;
        try {
          const url = await rasterise(layer.svg, layerScale);
          if (cancelled) return;
          setUrls((current) => (current[key] === url ? current : { ...current, [key]: url }));
        } catch {
          // A layer that fails to draw is simply left out.
        }
      }
    })();
    return () => { cancelled = true; };
  }, [layers, scale]);
  return urls;
}

// Soft edge for a disc of radius r, like a Gaussian blur of width sigma: [offset, opacity] stops for a radial gradient
// drawn on a circle of radius r + 3 sigma. Replaces blur filters on the dots.
const GAUSS_EDGE = [[-3, 0.9987], [-2, 0.977], [-1, 0.841], [0, 0.5], [1, 0.159], [2, 0.023], [3, 0]] as const;
function softEdgeStops(r: number, sigma: number) {
  const outer = r + 3 * sigma;
  return [[0, 1] as const, ...GAUSS_EDGE.map(([k, opacity]) => [Math.max(0, (r + k * sigma) / outer), opacity] as const)];
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
    const shared = (a: Box, b: Box) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const overlapArea = (box: Box) => {
      const offCanvas = (box[2] - box[0]) * (box[3] - box[1]) - shared(box, [4, 4, WIDTH - 4, CANVAS_HEIGHT - 4]);
      return offCanvas * 100 + [...placedBoxes, ...[...dotBoxes].filter(([id]) => id !== dot.id).map(([, other]) => other)]
        .reduce((sum, other) => sum + shared(box, other), 0);
    };
    // No free spot: take the one that covers the least of the other names and dots, and never runs off the edge.
    const chosen = free ?? candidates.reduce((best, candidate) => (overlapArea(candidate.box) < overlapArea(best.box) ? candidate : best));
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
  // The artist picked in the list below the map: their dot lights up.
  const [focusArtist, setFocusArtist] = useState<string | null>(null);
  const [replayKey, setReplayKey] = useState(0);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [pixelScale, setPixelScale] = useState<number | null>(null);
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
  const visitDate = formatVisitDate(encounters.find((encounter) => encounter.scannedAt)?.scannedAt);
  const visibleJourneyProgress = mode === "live" ? encounterCount : journeyProgress;
  const interactive = mode === "final" && stage === "complete";

  // Every dot near its artwork's place in the building, with some space between dots so they never stack.
  const modelPositions = useMemo(
    () => spreadDots(items.map((item) => ({ id: item.scanId, floorX: item.floorX, floorY: item.floorY, visits: item.encounterIndexes.length }))),
    [items],
  );

  // Every mark stays where its artwork is in the building.
  const dots = useMemo(() => items.map((item, index) => {
    const position = modelPositions.get(item.scanId)!;
    return { ...item, x: position.x, y: position.y, order: String(index + 1).padStart(2, "0"), visits: item.encounterIndexes.length };
  }), [items, modelPositions]);

  const labels = useMemo(
    () => placeLabels(dots.map((dot) => ({ id: dot.scanId, x: dot.x, y: dot.y, visits: dot.visits, text: `${dot.order} ${surname(dot.artist)}` }))),
    [dots],
  );


  // One row per artist for the list under the map, in the order they were first visited.
  const artistRows = useMemo(() => {
    const rows = new Map<string, { artist: string; orders: string[] }>();
    for (const dot of dots) {
      const row = rows.get(dot.artist) ?? { artist: dot.artist, orders: [] };
      row.orders.push(dot.order);
      rows.set(dot.artist, row);
    }
    return [...rows.values()];
  }, [dots]);

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

  const blues = useMemo(() => new Map(dots.map((dot) => [dot.scanId, bluesFor(hashString(dot.artist))] as const)), [dots]);

  // Bitmaps are drawn at the resolution the phone actually shows them at.
  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const measure = () => {
      const ratio = (element.getBoundingClientRect().width / WIDTH) * (window.devicePixelRatio || 1);
      setPixelScale(clamp(Math.round(ratio * 100) / 100, 1, 3));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [items.length]);

  // Hazy glow behind each dot: three soft blobs of BLUE and its white tints, drawn once per dot.
  const hazeSprites = useMemo(() => new Map(dots.map((dot) => {
    const random = seededRandom(hashString(`${dot.artist}-haze`));
    const blobs = blues.get(dot.scanId)!.haze.map((color, colorIndex) => {
      const angle = colorIndex * 2.1 + random();
      return { x: dot.x + Math.cos(angle) * 12, y: dot.y + Math.sin(angle) * 8, r: (POOL_RADIUS - colorIndex * 9) * (dot.visits > 1 ? 1.15 : 1), color };
    });
    return [dot.scanId, hazeSprite(blobs)] as const;
  })), [dots, blues]);

  // Where each artist's photos open (always in the middle), and the cloud behind them.
  const fanFor = useMemo(() => new Map(dots.map((dot) => {
    const layout = collectionLayout(dot.artist, dot.artistDescription);
    const textBlock: Box = [layout.centerX - 300, layout.nameY - 40, layout.centerX + 300, layout.bioY + (layout.bioLines.length - 1) * BIO_LINE + 20];
    return [dot.scanId, { ...layout, aura: auraDetailsSprite(dot.artist, layout.centerX, layout.centerY, textBlock) }] as const;
  })), [dots]);

  const layers = useMemo(() => {
    const pathColor = (scanId: string | null) => (scanId ? blues.get(scanId)!.path : INK);
    // In order of when they are needed: the space, the dots' haze, the path, then each artist's cloud.
    const result: Record<string, Layer> = { planGlow: { svg: PLAN_GLOW_SVG, detail: LAYER_DETAIL.planGlow } };
    for (const segment of pathSegments) {
      result[`glow-${segment.index}`] = { svg: pathGlowSvg([segment], pathColor, segmentBox(segment)), detail: LAYER_DETAIL.glow };
      const haze = hazeSprites.get(segment.to);
      if (haze) result[`haze-${segment.to}`] ??= { svg: haze.svg, detail: LAYER_DETAIL.haze };
    }
    for (const [scanId, sprite] of hazeSprites) result[`haze-${scanId}`] ??= { svg: sprite.svg, detail: LAYER_DETAIL.haze };
    result.glow = { svg: pathGlowSvg(pathSegments, pathColor), detail: LAYER_DETAIL.glow };
    // The shared cloud and the selected artist's details first, then the others in the background, so opening is instant.
    if (selected || (mode === "final" && stage === "complete")) result.auraCloud = { svg: AURA_CLOUD_SVG, detail: LAYER_DETAIL.aura };
    if (selected && fanFor.has(selected)) result[`aura-${selected}`] = { svg: fanFor.get(selected)!.aura.svg, detail: LAYER_DETAIL.aura };
    if (mode === "final" && stage === "complete") {
      for (const [scanId, fan] of fanFor) result[`aura-${scanId}`] ??= { svg: fan.aura.svg, detail: LAYER_DETAIL.aura };
    }
    return result;
  }, [blues, pathSegments, hazeSprites, fanFor, selected, mode, stage]);
  const bitmaps = useBitmaps(layers, pixelScale);
  const pathDrawn = visibleJourneyProgress >= pathSegments.length;

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

  /* ---------- Collection fan ---------- */
  const selectedDot = selected ? dots.find((dot) => dot.scanId === selected) ?? null : null;
  const collection = selectedDot ? getArtistArtworkFiles(selectedDot.artist) : [];
  const selectedFan = selectedDot ? fanFor.get(selectedDot.scanId)! : null;
  const fanCenterX = selectedFan?.centerX ?? 0;
  const fanCenterY = selectedFan?.centerY ?? 0;
  const frontPath = collection[Math.min(front, collection.length - 1)] ?? null;
  const mainColor = new Map(dots.map((dot) => [dot.scanId, blues.get(dot.scanId)!.path] as const));

  const expandedScale = expandedArtwork
    ? Math.min((WIDTH * 0.84) / expandedArtwork.width, (CANVAS_HEIGHT * 0.7) / expandedArtwork.height)
    : 0;
  const expandedWidth = expandedArtwork ? expandedArtwork.width * expandedScale : 0;
  const expandedHeight = expandedArtwork ? expandedArtwork.height * expandedScale : 0;
  const expandedX = (WIDTH - expandedWidth) / 2;
  const expandedY = Math.max(28, (CANVAS_HEIGHT - expandedHeight - 80) / 2);

  if (!items.length) return <p>No artwork scans with positions found for this session.</p>;

  return (
    <div style={{ width: "calc(100% + 24px)", maxWidth: 544, margin: "0 -12px", background: "transparent", color: INK, fontFamily: BODY_FONT }}>
      {mode === "final" && (
        <header style={{ padding: "20px 16px 4px" }}>
          <p style={{ ...MONO, margin: 0, fontSize: 12, letterSpacing: "0.03em", color: INK_MUTED }}>
            {visitDate}
          </p>
        </header>
      )}

      {mode === "final" && (
        <div className="ending-legend" style={{ padding: "0 16px", display: "flex", alignItems: "center", gap: 14, fontSize: 12, color: "rgba(239,239,232,0.75)", minHeight: 44 }}>
          <span className="ending-legend__item" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: "50%", background: KEY_DOT }} />artist
          </span>
          <span className="ending-legend__item" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span aria-hidden="true" style={{ width: 18, height: 2, borderRadius: 1, background: KEY_PATH }} />your path
          </span>
        </div>
      )}

      {mode === "final" && (
        <p style={{ ...MONO, margin: "0 16px 8px", fontSize: 12, color: INK_MUTED }}>
          {stage === "complete" ? "TAP A DOT TO SEE THE ARTIST’S WORKS" : "RECONSTRUCTING YOUR ENCOUNTERS…"}
        </p>
      )}

      <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${CANVAS_HEIGHT}`} width="100%" preserveAspectRatio="xMidYMid meet"
        style={{ display: "block", width: "100%", height: "auto", aspectRatio: `${WIDTH} / ${CANVAS_HEIGHT}`, background: "transparent", overflow: "hidden" }}
        onClick={() => {
          if (expandedArtwork) setExpandedArtwork(null);
          else if (selected) closeCollection();
          else setFocusArtist(null); // tapping the empty map turns the lit dot off again
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          if (expandedArtwork) setExpandedArtwork(null); else closeCollection();
        }}
        aria-label={mode === "live" ? "Visitor journey" : "Your path through the exhibition. Select an artist to see their works."}>
        <style>{`
          .${uid}-focus:focus { outline: none; }
          .${uid}-focus:focus-visible .${uid}-ring { stroke: ${ACCENT}; stroke-width: 3; }
          .${uid}-layer { animation: ${uid}-in 0.5s ease-out both; }
          @keyframes ${uid}-in { from { opacity: 0; } }
        `}</style>
        {/* Isometric floor plan of the space, always visible: a soft glow under thin, fading, hand-drawn lines */}
        <defs>
          <linearGradient id={`${uid}-plan-fade`} gradientUnits="userSpaceOnUse" x1={PLAN_FADE.x1} y1={PLAN_FADE.y1} x2={PLAN_FADE.x2} y2={PLAN_FADE.y2}>
            <stop offset="0" stopColor={INK} stopOpacity={0.55} />
            <stop offset="1" stopColor={INK} stopOpacity={0.12} />
          </linearGradient>
        </defs>
        {bitmaps.planGlow && <image className={`${uid}-layer`} href={bitmaps.planGlow} x={0} y={0} width={WIDTH} height={CANVAS_HEIGHT} preserveAspectRatio="none" pointerEvents="none" />}
        <g pointerEvents="none" fill="none" stroke={`url(#${uid}-plan-fade)`} strokeWidth={1.5} opacity={0.6} strokeLinejoin="round" strokeLinecap="round">
          {PLAN_OUTLINE.map(({ d, filled }, index) => <path key={index} d={d} fill={filled ? GROUND : "none"} fillOpacity={filled ? 0.55 : undefined} />)}
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

        {/* Hazy blue glow behind each dot (drawn once per dot, see hazeSprite) */}
        <g pointerEvents="none">
          {dots.map((dot) => {
            const url = bitmaps[`haze-${dot.scanId}`];
            if (!url) return null;
            const [x0, y0, x1, y1] = hazeSprites.get(dot.scanId)!.box;
            const reached = dot.encounterIndexes.some((encounterIndex) => visibleJourneyProgress >= encounterIndex + 1);
            const faded = focusArtist !== null && focusArtist !== dot.artist;
            return <image key={dot.scanId} href={url} x={x0} y={y0} width={x1 - x0} height={y1 - y0} preserveAspectRatio="none"
              opacity={(reached ? (faded ? 0.25 : 1) : 0) * HAZE_STRENGTH} />;
          })}
        </g>

        {/* Path: each stretch blends from one artist's colour to the next */}
        <g pointerEvents="none" opacity={focusArtist || selected ? 0.3 : 0.9}>
          <defs>
            {pathSegments.map((segment) => (
              <linearGradient key={segment.index} id={`${uid}-segment-${segment.index}`} gradientUnits="userSpaceOnUse"
                x1={segment.x1} y1={segment.y1} x2={segment.x2} y2={segment.y2}>
                <stop offset="0" stopColor={segment.from ? mainColor.get(segment.from) : INK} />
                <stop offset="1" stopColor={mainColor.get(segment.to)} />
              </linearGradient>
            ))}
          </defs>
          {/* Glow under the path, drawn once as images: while the replay runs, each stretch's glow fades in as it is drawn;
              once the whole path is there, one image of the whole glow replaces them */}
          {pathDrawn && bitmaps.glow
            ? <image href={bitmaps.glow} x={0} y={0} width={WIDTH} height={CANVAS_HEIGHT} preserveAspectRatio="none" />
            : pathSegments.map((segment) => {
              const url = bitmaps[`glow-${segment.index}`];
              const drawn = Math.max(0, Math.min(1, visibleJourneyProgress - segment.index));
              if (!url || drawn === 0) return null;
              const [x0, y0, x1, y1] = segmentBox(segment);
              return <image key={segment.index} href={url} x={x0} y={y0} width={x1 - x0} height={y1 - y0} preserveAspectRatio="none"
                opacity={drawn ** 3} />;
            })}
          {pathSegments.map(({ d, index }) => {
            const drawn = Math.max(0, Math.min(1, visibleJourneyProgress - index));
            // Not drawn yet: hidden, so its round cap does not show as a dot at the start.
            return <path key={index} d={d} fill="none" stroke={`url(#${uid}-segment-${index})`} strokeOpacity={drawn === 0 ? 0 : index === 0 ? 0.5 : 0.9} strokeWidth={1.4} strokeLinecap="round"
              pathLength={1} strokeDasharray="1" strokeDashoffset={1 - drawn} />;
          })}
        </g>

        {/* Names: number + surname, always visible once the visitor has reached that artist */}
        <g pointerEvents="none">
          {dots.map((dot) => {
            const reached = dot.encounterIndexes.some((encounterIndex) => visibleJourneyProgress >= encounterIndex + 1);
            const lit = selected === dot.scanId || hovered === dot.scanId || focusArtist === dot.artist;
            const faded = focusArtist !== null && focusArtist !== dot.artist;
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

        {/* Blue cloud blooming out of the selected dot, behind the photos (see AURA_CLOUD_SVG and auraDetailsSprite) */}
        {selectedDot && selectedFan && (() => {
          const details = bitmaps[`aura-${selectedDot.scanId}`];
          const [x0, y0, x1, y1] = selectedFan.aura.box;
          const bloom = 0.6 + 0.4 * openProgress;
          return <g pointerEvents="none" opacity={openProgress}
            transform={`translate(${selectedDot.x} ${selectedDot.y}) scale(${bloom}) translate(${-selectedDot.x} ${-selectedDot.y})`}>
            {bitmaps.auraCloud && <image href={bitmaps.auraCloud} x={fanCenterX - AURA_REACH} y={fanCenterY - AURA_REACH}
              width={AURA_REACH * 2} height={AURA_REACH * 2} preserveAspectRatio="none" />}
            {details && <image href={details} x={x0} y={y0} width={x1 - x0} height={y1 - y0} preserveAspectRatio="none" />}
          </g>;
        })()}
        {selectedDot && <>
          <defs>
            <linearGradient id={`${uid}-aura-top`} x1={0} y1={0} x2={0} y2={1}>
              <stop offset="0" stopColor={GROUND} />
              <stop offset="1" stopColor={GROUND} stopOpacity={0} />
            </linearGradient>
          </defs>
          <rect x={0} y={0} width={WIDTH} height={AURA_TOP_FADE} fill={`url(#${uid}-aura-top)`} opacity={openProgress} pointerEvents="none" />
        </>}

        {/* Dots: one per artwork, a ring for every return visit */}
        {dots.map((dot, dotIndex) => {
          const completedVisits = dot.encounterIndexes.filter((encounterIndex) => visibleJourneyProgress >= encounterIndex + 1).length;
          const active = selected === dot.scanId;
          const lit = active || hovered === dot.scanId || (!selected && focusArtist === dot.artist);
          const tones = blues.get(dot.scanId)!;
          const radius = dotRadius(Math.max(1, completedVisits));
          let opacity = completedVisits > 0 ? 1 : 0;
          if (selected && !active) opacity *= 1 - 0.8 * openProgress;
          else if (active) opacity *= 1 - openProgress;
          else if (!selected && focusArtist && focusArtist !== dot.artist) opacity *= 0.3;
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
            {/* Soft glow and touchpoint rings (pale outside, deep BLUE in the centre), softened with gradients instead of blur filters */}
            <defs>
              <radialGradient id={`${uid}-dot-glow-${dotIndex}`}>
                {softEdgeStops(radius + 12, 8).map(([offset, stopOpacity], index) => <stop key={index} offset={offset} stopColor={tones.rings[1]} stopOpacity={stopOpacity} />)}
              </radialGradient>
              {TOUCHPOINT_RINGS.map((ring, ringIndex) => (
                <radialGradient key={ringIndex} id={`${uid}-ring-${dotIndex}-${ringIndex}`}>
                  {softEdgeStops(radius * ring.size, 0.7).map(([offset, stopOpacity], index) => <stop key={index} offset={offset} stopColor={tones.rings[ringIndex]} stopOpacity={stopOpacity} />)}
                </radialGradient>
              ))}
            </defs>
            <circle cx={dot.x} cy={dot.y} r={radius + 12 + 24} fill={`url(#${uid}-dot-glow-${dotIndex})`} opacity={lit ? 0.6 : 0.3} />
            {TOUCHPOINT_RINGS.map((ring, ringIndex) => (
              <circle key={ringIndex} cx={dot.x} cy={dot.y} r={radius * ring.size + 2.1} fill={`url(#${uid}-ring-${dotIndex}-${ringIndex})`} opacity={ring.opacity} />
            ))}
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
          const cardScale = selectedFan?.cardScale ?? 1;
          const targetX = fanCenterX + middle * PHOTO_SPREAD * cardScale;
          const x = d3.interpolateNumber(selectedDot.x, targetX)(openProgress);
          const y = d3.interpolateNumber(selectedDot.y, fanCenterY)(openProgress);
          const scale = (0.2 + 0.8 * openProgress) * cardScale;
          const title = getArtworkTitle(path);
          return <g key={path} role="button" tabIndex={0} className={`${uid}-focus`}
            aria-label={isFront ? `Enlarge ${title}` : `Select ${title}`}
            opacity={Math.min(1, openProgress * 1.5)}
            transform={`translate(${x} ${y}) scale(${scale})`}
            style={{ cursor: isFront ? "zoom-in" : "pointer" }}
            onClick={(event) => { event.stopPropagation(); if (isFront) showArtwork(path); else setFront(index); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                if (isFront) showArtwork(path); else setFront(index);
              }
            }}>
            <image href={path} x={-CARD_WIDTH / 2} y={-CARD_HEIGHT / 2}
              width={CARD_WIDTH} height={CARD_HEIGHT} preserveAspectRatio="xMidYMid slice"
              style={{ filter: isFront ? "drop-shadow(0 0 14px rgba(255,255,255,0.5))" : "drop-shadow(0 6px 14px rgba(0,0,0,0.35))" }} />
          </g>;
        })}

        {/* The artist's name on top of the photos; the front photo's title and the artist's description below */}
        {selectedDot && selectedFan && <g opacity={openProgress} pointerEvents="none" textAnchor="middle">
          <text x={WIDTH / 2} y={selectedFan.nameY} fontSize={NAME_SIZE} fill={INK} style={DISPLAY}>
            {truncate(selectedDot.artist, 32)}
          </text>
          <text x={WIDTH / 2} y={selectedFan.metaY} fontSize={12} letterSpacing={1} fill={INK} fillOpacity={0.72} style={MONO}>
            {`${selectedDot.order} · ${THEMES[selectedDot.group].short.toUpperCase()}${selectedDot.visits > 1 ? ` · ${selectedDot.visits} VISITS` : ""}`}
          </text>
          <text x={WIDTH / 2} y={selectedFan.titleY} fontSize={19} fill={INK} style={{ fontFamily: BODY_FONT, fontWeight: 700 }}>
            {frontPath ? truncate(getArtworkTitle(frontPath), 44) : "No images for this artist yet"}
          </text>
          <text x={WIDTH / 2} y={selectedFan.hintY} fontSize={12} letterSpacing={1} fill={INK} fillOpacity={0.72} style={MONO}>
            {collection.length ? `IMAGE ${front + 1} OF ${collection.length} · TAP THE PHOTO TO LOOK CLOSER` : ""}
          </text>
          <text x={WIDTH / 2} y={selectedFan.bioY} fontSize={15} fill={INK} fillOpacity={0.85} style={{ fontFamily: BODY_FONT }}>
            {selectedFan.bioLines.map((line, index) => <tspan key={index} x={WIDTH / 2} dy={index === 0 ? 0 : BIO_LINE}>{line}</tspan>)}
          </text>
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
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 16px 0" }}>
          <button type="button" onClick={() => (stage === "complete" ? setReplayKey((value) => value + 1) : skipReplay())}
            style={{ ...GLASS, height: 44, padding: "0 14px", border: 0, borderRadius: 8, color: INK, fontFamily: BODY_FONT, fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
            {stage === "complete" ? "\u21bb Replay your path" : "Skip \u00bb"}
          </button>
        </div>
      )}

      {mode === "final" && (
        <div style={{ padding: "4px 16px 20px" }}>
          {/* Artists, straight on the page: the same dot as on the map, then the name. Tap one to light up its dot. */}
          <p style={{ ...MONO, margin: "14px 2px 4px", fontSize: 11, letterSpacing: "0.03em", color: INK_MUTED }}>ARTISTS · TAP ONE TO FIND THEM IN THE SPACE</p>
          {/* Artists, straight on the page: the number from the map and the name. Tap one to light up its dot. */}
          <ul role="list" aria-label="Artists you met" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {artistRows.map(({ artist, orders }, rowIndex) => {
              const on = focusArtist === artist;
              return <li key={artist} style={{ borderTop: rowIndex === 0 ? "none" : "1px solid rgba(239,239,232,0.10)" }}>
                <button type="button" aria-pressed={on}
                  onClick={() => {
                    closeCollection();
                    setFocusArtist(on ? null : artist);
                    // On a phone the map may be scrolled away: bring it back so the lit dot can be seen.
                    if (!on) svgRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                  }}
                  style={{
                    width: "100%", minHeight: 48, padding: "8px 2px", display: "flex", alignItems: "center", gap: 14,
                    border: 0, background: "transparent", cursor: "pointer", textAlign: "left", color: INK, fontFamily: BODY_FONT,
                  }}>
                  <span style={{ ...MONO, flexShrink: 0, minWidth: 22, fontSize: 12, color: on ? ACCENT_TEXT : INK_MUTED, transition: "color 0.25s ease" }}>{orders.join(" · ")}</span>
                  <span style={{ ...DISPLAY, fontSize: 16, color: on ? ACCENT_TEXT : INK, transition: "color 0.25s ease" }}>{artist}</span>
                </button>
              </li>;
            })}
          </ul>

        </div>
      )}
    </div>
  );
}
