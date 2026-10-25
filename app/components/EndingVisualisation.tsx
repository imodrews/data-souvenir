"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import gsap from "gsap";

const WIDTH = 694;
const HEIGHT = 900;
const MODEL_WIDTH = 540.47;
const MODEL_HEIGHT = 486.16;
const MODEL_SCALE = WIDTH / MODEL_WIDTH;
const MODEL_RENDER_WIDTH = MODEL_WIDTH * MODEL_SCALE;
const MODEL_LEFT = (WIDTH - MODEL_RENDER_WIDTH) / 2;
const MODEL_RENDER_HEIGHT = MODEL_HEIGHT * MODEL_SCALE;
const MODEL_TOP = Math.min(110, HEIGHT - MODEL_RENDER_HEIGHT);
const MODEL_FADE_START = 0.65;

type Coordinate = readonly [number, number];
type FloorProjectionRow = readonly [floorY: number, left: Coordinate, right: Coordinate];

const MODEL_FLOOR_ROWS: readonly FloorProjectionRow[] = [
  [0, [131.91, 39.63], [438.31, 53.79]],
  [48, [105.38, 99.23], [449.62, 115.71]],
  [184, [128.14, 167.13], [444.29, 181.13]],
  [231, [0.23, 456.55], [509.28, 485.91]],
];

function getModelPosition(floorX: number, floorY: number) {
  const horizontal = Math.max(0, Math.min(1, floorX / 694));
  const clampedFloorY = Math.max(0, Math.min(231, floorY));
  let endRowIndex = MODEL_FLOOR_ROWS.findIndex(([rowY]) => clampedFloorY <= rowY);
  if (endRowIndex < 1) endRowIndex = MODEL_FLOOR_ROWS.length - 1;
  const [startY, startLeft, startRight] = MODEL_FLOOR_ROWS[endRowIndex - 1];
  const [endY, endLeft, endRight] = MODEL_FLOOR_ROWS[endRowIndex];
  const vertical = (clampedFloorY - startY) / (endY - startY);
  const interpolateRow = (left: Coordinate, right: Coordinate): Coordinate => [
    left[0] + (right[0] - left[0]) * horizontal,
    left[1] + (right[1] - left[1]) * horizontal,
  ];
  const top = interpolateRow(startLeft, startRight);
  const bottom = interpolateRow(endLeft, endRight);
  return {
    x: MODEL_LEFT + (top[0] + (bottom[0] - top[0]) * vertical) * MODEL_SCALE,
    y: MODEL_TOP + (top[1] + (bottom[1] - top[1]) * vertical) * MODEL_SCALE,
  };
}

const MODEL_ENTRANCE_FLOOR: Coordinate = [694 * 0.46, 231];
const MODEL_ENTRANCE_POSITION = getModelPosition(...MODEL_ENTRANCE_FLOOR);

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

const LABEL_FONT_SIZE = 20;
const LABEL_LINE_HEIGHT = 28;
const COLORS: Record<Group, string> = {
  red: "#b85c5c",
  green: "#5f8f68",
  purple: "#8064a2",
};
const GROUP_LABELS: Record<Group, string> = {
  red: "Sichtbarkeit des Ungesehenen, \u00bbNicht-Pr\u00e4senz\u00ab",
  green: "Erinnerungskultur, Trauma und verdr\u00e4ngteGeschichte(n)",
  purple: "Realit\u00e4t oder Simulation \u2013das Spiel mit der Wahrnehmung, Passagen M\u00f6glichen",
};

function getGroupLabelLayout(section: { x: number; y: number; size: number }[], group: Group) {
  const minX = Math.min(...section.map((item) => item.x - item.size / 2));
  const maxX = Math.max(...section.map((item) => item.x + item.size / 2));
  const minY = Math.min(...section.map((item) => item.y - item.size / 2));
  const maxY = Math.max(...section.map((item) => item.y + item.size / 2));
  const x = group === "green" ? maxX + 32 : 24;
  const width = group === "green" ? WIDTH - 24 - x : minX - 32 - x;
  const maxCharacters = Math.max(1, Math.floor(width / (LABEL_FONT_SIZE * 0.6)));
  const lines: string[] = [];
  let line = "";
  for (const word of GROUP_LABELS[group].split(/\s+/)) {
    if (line && line.length + word.length + 1 > maxCharacters) {
      lines.push(line);
      line = "";
    }
    let remaining = word;
    while (remaining.length > maxCharacters) {
      lines.push(remaining.slice(0, maxCharacters));
      remaining = remaining.slice(maxCharacters);
    }
    line = line ? `${line} ${remaining}` : remaining;
  }
  if (line) lines.push(line);
  const y = (minY + maxY) / 2 - (lines.length - 1) * LABEL_LINE_HEIGHT / 2 + 6;
  return {
    x, y, lines,
    top: Math.min(minY, y - LABEL_FONT_SIZE),
    bottom: Math.max(maxY, y + (lines.length - 1) * LABEL_LINE_HEIGHT + 8),
  };
}

type JourneyVisualisationProps = {
  encounters: JourneyEncounter[];
  mode: "live" | "final";
};

export default function EndingVisualisation({ encounters, mode }: JourneyVisualisationProps) {
  const filterId = useId().replaceAll(":", "");
  const [stage, setStage] = useState<"model" | "journey" | "complete">("model");
  const [modelProgress, setModelProgress] = useState(0);
  const [journeyProgress, setJourneyProgress] = useState(0);
  const [labelsProgress, setLabelsProgress] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [zoomProgress, setZoomProgress] = useState(0);
  const [replayKey, setReplayKey] = useState(0);
  const zoomTween = useRef<gsap.core.Tween | null>(null);
  const zoomValue = useRef({ value: 0 });

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
          y: 65 + (Number(encounter.y) / 231) * (HEIGHT - 130),
          encounterIndexes: [encounterIndex],
        });
      }
      encounterIndex += 1;
    }
    return [...uniqueArtworks.values()];
  }, [encounters]);

  const encounterCount = items.reduce((count, item) => count + item.encounterIndexes.length, 0);
  const visibleJourneyProgress = mode === "live" ? encounterCount : journeyProgress;
  const modelFadeProgress = Math.max(0, Math.min(1, (modelProgress - MODEL_FADE_START) / (1 - MODEL_FADE_START)));
  const modelFadeOpacity = 1 - modelFadeProgress;
  const journeyMarkSize = Math.max(110, Math.min(280, 420 / Math.sqrt(items.length || 1)));

  const positioned = useMemo(() => {
    const dataMinX = Math.min(...items.map((item) => item.x));
    const dataMaxX = Math.max(...items.map((item) => item.x));
    const dataMinY = Math.min(...items.map((item) => item.y));
    const dataMaxY = Math.max(...items.map((item) => item.y));
    const margin = Math.max(30, journeyMarkSize / 2 + 12);
    const fitCoordinate = (value: number, min: number, max: number, extent: number) => {
      if (max <= min) return extent / 2;
      const fittedSpan = (extent - margin * 2) * 0.9;
      return (extent - fittedSpan) / 2 + ((value - min) / (max - min)) * fittedSpan;
    };
    const purpleXCoordinates = items
      .filter((item) => item.group === "purple")
      .map((item) => fitCoordinate(item.x, dataMinX, dataMaxX, WIDTH));
    const purpleOffsetX = purpleXCoordinates.length
      ? WIDTH / 2 - (Math.min(...purpleXCoordinates) + Math.max(...purpleXCoordinates)) / 2
      : 0;
    const journeyItems = items.map((item) => {
      const liftBackLeftRedDot = mode === "final" && item.group === "red"
        && item.floorX >= 45 && item.floorX <= 70 && item.floorY >= 190 && item.floorY <= 205;
      return {
        ...item,
        x: fitCoordinate(item.x, dataMinX, dataMaxX, WIDTH) + (mode === "final" && item.group === "purple" ? purpleOffsetX : 0),
        y: fitCoordinate(item.y, dataMinY, dataMaxY, HEIGHT)
          + (mode === "final" && item.group === "purple" ? 55 : 0)
          - (liftBackLeftRedDot ? 35 : 0),
      };
    });
    const minCenterDistance = journeyMarkSize * 0.82 + 8;
    const visibleHalfSize = journeyMarkSize * 0.82 / 2;
    const minX = visibleHalfSize + 8;
    const maxX = WIDTH - minX;
    const minY = visibleHalfSize + 8;
    const maxY = HEIGHT - minY;
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
  }, [items, journeyMarkSize, mode]);

  const modelPositions = useMemo(() => {
    const modelItems = items.map((item) => ({
      ...item,
      modelFloorX: item.floorX,
      modelFloorY: item.floorY,
    }));
    const minHorizontalDistance = journeyMarkSize;
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
    return new Map(modelItems.map((item) => [
      item.scanId,
      { ...getModelPosition(item.modelFloorX, item.modelFloorY), floorX: item.modelFloorX, floorY: item.modelFloorY },
    ] as const));
  }, [items, journeyMarkSize]);
  const canvasHeight = useMemo(() => {
    if (mode === "live") return HEIGHT;
    const labelItems = positioned.map((item) => ({ ...item, size: journeyMarkSize * 0.4 }));
    const labelBottoms = (["green", "red", "purple"] as const).flatMap((group) => {
      const section = labelItems.filter((item) => item.group === group);
      return section.length ? [getGroupLabelLayout(section, group).bottom + 24] : [];
    });
    return Math.max(HEIGHT, ...labelBottoms);
  }, [positioned, journeyMarkSize, mode]);

  useEffect(() => {
    if (mode === "live" || !positioned.length) return;
    let timeline: gsap.core.Timeline | undefined;
    const frame = requestAnimationFrame(() => {
      setStage("model");
      setModelProgress(0);
      setJourneyProgress(0);
      setLabelsProgress(0);
      setSelected(null);
      setHovered(null);
      setZoomProgress(0);
      zoomValue.current.value = 0;
      zoomTween.current?.kill();
      const values = { model: 0, journey: 0 };
      timeline = gsap.timeline();
      timeline.to(values, {
        journey: encounterCount,
        duration: Math.max(1.2, encounterCount * 1.0),
        ease: "none",
        onUpdate: () => setJourneyProgress(values.journey),
      });
      timeline.call(() => setStage("journey"));
      timeline.to(values, {
        model: 1,
        duration: 2.2,
        ease: "power2.inOut",
        onUpdate: () => {
          setModelProgress(values.model);
          setLabelsProgress(values.model);
        },
      });
      timeline.call(() => setStage("complete"));
    });
    return () => {
      cancelAnimationFrame(frame);
      timeline?.kill();
    };
  }, [positioned, encounterCount, replayKey, mode]);

  useEffect(() => () => { zoomTween.current?.kill(); }, []);

  function enterOrExit(scanId: string) {
    if (mode === "live" || stage !== "complete") return;
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

  const displayedItems = useMemo(() => positioned.map((item) => {
    const modelPosition = modelPositions.get(item.scanId)!;
    if (mode === "live") {
      return { ...item, x: modelPosition.x, y: modelPosition.y, size: journeyMarkSize * 0.4 };
    }
    const itemIndex = positioned.findIndex((positionedItem) => positionedItem.scanId === item.scanId);
    const stagger = positioned.length > 1 ? 0.38 * itemIndex / (positioned.length - 1) : 0;
    const liftProgress = Math.max(0, Math.min(1, (modelProgress - stagger) / (1 - stagger)));
    const journeyX = d3.interpolateNumber(modelPosition.x, item.x)(liftProgress);
    const journeyY = d3.interpolateNumber(modelPosition.y, item.y)(liftProgress);
    return {
      ...item,
      x: journeyX,
      y: journeyY,
      size: journeyMarkSize * 0.4,
    };
  }), [positioned, modelPositions, journeyMarkSize, modelProgress, mode]);
  const pathSegments = useMemo(() => {
    const encounterSequence = displayedItems
      .flatMap((item) => item.encounterIndexes.map((encounterIndex) => ({ item, encounterIndex })))
      .sort((first, second) => first.encounterIndex - second.encounterIndex);
    const entranceSegment = encounterSequence[0]
      ? d3.line<[number, number]>().x((point) => point[0]).y((point) => point[1])
        .curve(d3.curveBumpY)([[MODEL_ENTRANCE_POSITION.x, MODEL_ENTRANCE_POSITION.y], [encounterSequence[0].item.x, encounterSequence[0].item.y]])
      : null;
    return [
      ...(entranceSegment ? [{ d: entranceSegment, index: 0 }] : []),
      ...encounterSequence.slice(0, -1).flatMap((visit, index) => {
        const next = encounterSequence[index + 1];
        if (!next) return [];
        const segment = d3.line<[number, number]>().x((point) => point[0]).y((point) => point[1])
          .curve(d3.curveBumpX)([[visit.item.x, visit.item.y], [next.item.x, next.item.y]]);
        return segment ? [{ d: segment, index: index + 1 }] : [];
      }),
    ];
  }, [displayedItems]);

  if (!positioned.length) return <p>No artwork scans with positions found for this session.</p>;

  return (
    <div style={{ width: "100%", maxWidth: 520, margin: "0 auto" }}>
      <svg viewBox={`0 0 ${WIDTH} ${canvasHeight}`} width="100%" preserveAspectRatio="xMidYMid meet"
        style={{ display: "block", width: "100%", height: "auto", aspectRatio: `${WIDTH} / ${canvasHeight}`, background: "#000", overflow: "hidden" }}
        onClick={() => { if (selected) enterOrExit(selected); }}
        aria-label={mode === "live" ? "Visitor journey" : "Visitor journey and interactive constellation"}>
        <defs>
          <filter id={`${filterId}-halo`} x="0" y="0" width={WIDTH} height={canvasHeight} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse">
            <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="8" result="grain" />
            <feDisplacementMap in="SourceGraphic" in2="grain" scale="8" xChannelSelector="R" yChannelSelector="G" result="organic" />
            <feGaussianBlur in="organic" stdDeviation="9" />
          </filter>
          <filter id={`${filterId}-soft`} x="0" y="0" width={WIDTH} height={canvasHeight} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse">
            <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="13" result="grain" />
            <feDisplacementMap in="SourceGraphic" in2="grain" scale="4" xChannelSelector="R" yChannelSelector="G" result="organic" />
            <feGaussianBlur in="organic" stdDeviation="3" />
          </filter>
        </defs>
        <image href="/3-D-14.svg" x={MODEL_LEFT} y={MODEL_TOP} width={MODEL_RENDER_WIDTH} height={MODEL_RENDER_HEIGHT}
          preserveAspectRatio="none" opacity={mode === "final" ? modelFadeOpacity : 1} pointerEvents="none" />
        <text x={MODEL_ENTRANCE_POSITION.x} y={MODEL_ENTRANCE_POSITION.y - 12} textAnchor="middle" fill="#e1dfd2" fontSize="12"
          pointerEvents="none">entrance</text>
        <g opacity={0.85} pointerEvents="none">
          <g filter={`url(#${filterId}-halo)`} opacity={0.38}>
            {pathSegments.map(({ d, index }) => <path key={index} d={d} fill="none" stroke="#c45b9c" strokeWidth={8} strokeLinecap="round"
              pathLength={1} strokeDasharray="1" strokeDashoffset={1 - Math.max(0, Math.min(1, visibleJourneyProgress - index))} />)}
          </g>
          <g filter={`url(#${filterId}-soft)`} opacity={0.45}>
            {pathSegments.map(({ d, index }) => <path key={index} d={d} fill="none" stroke="#c45b9c" strokeWidth={4} strokeLinecap="round"
              pathLength={1} strokeDasharray="1" strokeDashoffset={1 - Math.max(0, Math.min(1, visibleJourneyProgress - index))} />)}
          </g>
        </g>
        {mode === "final" && (["purple", "red", "green"] as const).map((group) => {
          const section = displayedItems.filter((item) => item.group === group);
          if (!section.length) return null;
          const label = getGroupLabelLayout(section, group);
          const labelProgress = Math.max(0, Math.min(1, labelsProgress));
          const labelScale = 0.9 + labelProgress * 0.1;
          return <g key={group} opacity={labelProgress * (selected ? 1 - zoomProgress : 1)}
            transform={`translate(${label.x} ${label.y}) scale(${labelScale}) translate(${-label.x} ${-label.y})`} pointerEvents="none">
            <text x={label.x} y={label.y} textAnchor="start" fill={COLORS[group]} fontSize={LABEL_FONT_SIZE}>
              {label.lines.map((line, index) => <tspan key={index} x={label.x} dy={index === 0 ? 0 : LABEL_LINE_HEIGHT}>{line}</tspan>)}
            </text>
          </g>;
        })}
        {displayedItems.map((item) => {
          const completedEncounters = item.encounterIndexes.filter((encounterIndex) => visibleJourneyProgress >= encounterIndex + 1).length;
          const brightness = Math.max(0.45, 1 - Math.max(0, completedEncounters - 1) * 0.18);
          const active = selected === item.scanId;
          const displayX = active ? d3.interpolateNumber(item.x, WIDTH / 2)(zoomProgress) : item.x;
          const displayY = active ? d3.interpolateNumber(item.y, canvasHeight / 2)(zoomProgress) : item.y;
          const displaySize = active ? d3.interpolateNumber(item.size, WIDTH * 0.9)(zoomProgress) : item.size;
          const artistFontSize = Math.max(6, Math.min(10, displaySize * 0.105));
          const artistTextWidth = Math.min(displaySize * 0.72, item.artist.length * artistFontSize * 0.6);
          return <g key={item.scanId} opacity={!selected || active ? 1 : 1 - zoomProgress}
            style={{ cursor: mode === "final" && stage === "complete" ? "pointer" : "default" }}
            pointerEvents={selected && !active ? "none" : "auto"}
            onMouseEnter={() => { if (mode === "final" && stage === "complete") setHovered(item.scanId); }}
            onMouseLeave={() => setHovered(null)}
            onClick={(event) => { event.stopPropagation(); enterOrExit(item.scanId); }}>
            <title>{`${item.artist} \u2014 ${item.name}`}</title>
            <image href="/svg-dot.svg" x={displayX - displaySize * 0.825} y={displayY - displaySize * 0.825}
              width={displaySize * 1.65} height={displaySize * 1.65} preserveAspectRatio="xMidYMid meet"
              style={{ filter: `brightness(${brightness})` }} />
            <circle cx={displayX} cy={displayY} r={displaySize * 0.38} fill="transparent" />
            {(active || hovered === item.scanId) && <text x={displayX} y={displayY} textAnchor="middle" dominantBaseline="central"
              fill="#e1dfd2" fontSize={artistFontSize} fontWeight="400" textLength={artistTextWidth} lengthAdjust="spacingAndGlyphs" pointerEvents="none">
              {item.artist}
            </text>}
          </g>;
        })}
      </svg>
      {mode === "final" && <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
        <button onClick={() => setReplayKey((value) => value + 1)}
          style={{ padding: "9px 16px", border: "1px solid #777", borderRadius: 3, background: "transparent", cursor: "pointer" }}>
          {"\u21bb Replay"}
        </button>
        <span style={{ fontSize: 12, opacity: 0.6 }}>
          {stage === "complete" ? "Tap a mark to zoom; tap again to return" : "Reconstructing your encounters\u2026"}
        </span>
      </div>}
    </div>
  );
}