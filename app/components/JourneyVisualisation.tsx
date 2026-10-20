"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import gsap from "gsap";

const WIDTH = 694;
const HEIGHT = 900;

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

export type JourneyEncounter = {
  scanId: string;
  artworkId: string;
  name: string;
  artist: string;
  group: string | null | undefined;
  x: number | null;
  y: number | null;
};

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
  red: "Sichtbarkeit des Ungesehenen, \u00bbNicht-Pr\u00e4senz\u00ab",
  green: "Erinnerungskultur, Trauma und verdr\u00e4ngteGeschichte(n)",
  purple: "Realit\u00e4t oder Simulation \u2013das Spiel mit der Wahrnehmung, Passagen M\u00f6glichen",
};

function getGroupedLayout(items: JourneyItem[], markSize: number) {
  const targets = new Map<string, { x: number; y: number; size: number }>();
  let nextTop = 64;
  for (const group of ["green", "red", "purple"] as const) {
    const section = items.filter((item) => item.group === group);
    if (!section.length) continue;
    const minY = Math.min(...section.map((item) => item.y)) - markSize / 2;
    const maxY = Math.max(...section.map((item) => item.y)) + markSize / 2;
    const offsetY = Math.max(0, nextTop - minY);
    for (const item of section) {
      targets.set(item.scanId, {
        x: item.x,
        y: item.y + offsetY,
        size: markSize,
      });
    }
    nextTop = maxY + offsetY + 80;
  }
  return targets;
}

export default function JourneyVisualisation({ encounters }: { encounters: JourneyEncounter[] }) {
  const filterId = useId().replaceAll(":", "");
  const [stage, setStage] = useState<"journey" | "grouping" | "labels" | "complete">("journey");
  const [journeyProgress, setJourneyProgress] = useState(0);
  const [groupingProgress, setGroupingProgress] = useState(0);
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
    const journeyItems = items.map((item) => ({
      ...item,
      x: fitCoordinate(item.x, dataMinX, dataMaxX, WIDTH) + (item.group === "purple" ? purpleOffsetX : 0),
      y: fitCoordinate(item.y, dataMinY, dataMaxY, HEIGHT) + (item.group === "purple" ? 55 : 0),
    }));
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
  }, [items, journeyMarkSize]);

  const groupedLayout = useMemo(() => getGroupedLayout(positioned, journeyMarkSize), [positioned, journeyMarkSize]);
  const finalHeight = Math.max(HEIGHT, ...[...groupedLayout.values()].map((item) => item.y + item.size / 2 + 40));
  const canvasHeight = d3.interpolateNumber(HEIGHT, finalHeight)(groupingProgress);

  useEffect(() => {
    if (!positioned.length) return;
    let timeline: gsap.core.Timeline | undefined;
    const frame = requestAnimationFrame(() => {
      setStage("journey");
      setJourneyProgress(0);
      setGroupingProgress(0);
      setLabelsProgress(0);
      setSelected(null);
      setHovered(null);
      setZoomProgress(0);
      zoomValue.current.value = 0;
      zoomTween.current?.kill();
      const values = { journey: 0, grouping: 0, labels: 0 };
      timeline = gsap.timeline();
      timeline.to(values, {
        journey: encounterCount,
        duration: Math.max(1.2, encounterCount * 1.0),
        ease: "none",
        onUpdate: () => setJourneyProgress(values.journey),
      });
      timeline.to({}, { duration: 0.6 });
      timeline.call(() => setStage("grouping"));
      timeline.to(values, {
        grouping: 1,
        duration: 1.2,
        ease: "power2.inOut",
        onUpdate: () => setGroupingProgress(values.grouping),
      });
      timeline.call(() => setStage("labels"));
      timeline.to(values, {
        labels: 1,
        duration: 0.8,
        ease: "back.out(1.4)",
        onUpdate: () => setLabelsProgress(values.labels),
      });
      timeline.call(() => setStage("complete"));
    });
    return () => {
      cancelAnimationFrame(frame);
      timeline?.kill();
    };
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

  const displayedItems = positioned.map((item) => {
    const target = groupedLayout.get(item.scanId)!;
    return {
      ...item,
      x: d3.interpolateNumber(item.x, target.x)(groupingProgress),
      y: d3.interpolateNumber(item.y, target.y)(groupingProgress),
      size: d3.interpolateNumber(journeyMarkSize, target.size)(groupingProgress),
    };
  });
  const encounterSequence = displayedItems
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

  if (!positioned.length) return <p>No artwork scans with positions found for this session.</p>;

  return (
    <div style={{ width: "100%", maxWidth: 520, margin: "0 auto" }}>
      <svg viewBox={`0 0 ${WIDTH} ${canvasHeight}`} width="100%" preserveAspectRatio="xMidYMid meet"
        style={{ display: "block", width: "100%", height: `calc(min(742px, calc(100dvh - 220px)) * ${canvasHeight / HEIGHT})`, background: "#f3f2e6", overflow: "hidden" }}
        onClick={() => { if (selected) enterOrExit(selected); }}
        aria-label="Visitor journey and interactive constellation">
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
        <text x={WIDTH / 2} y={16} textAnchor="middle" fill="#555" fontSize="12" pointerEvents="none">entrance</text>
        {pathSegments.map(({ d, index }) => {
          const strokeDashoffset = 1 - Math.max(0, Math.min(1, journeyProgress - index));
          return <g key={index} opacity={0.65} pointerEvents="none">
            <path d={d} fill="none" stroke="#873c70" strokeWidth={10} strokeLinecap="round" opacity={0.2}
              pathLength={1} strokeDasharray="1" strokeDashoffset={strokeDashoffset} filter={`url(#${filterId}-halo)`} />
            <path d={d} fill="none" stroke="#873c70" strokeWidth={5} strokeLinecap="round" opacity={0.22}
              pathLength={1} strokeDasharray="1" strokeDashoffset={strokeDashoffset} filter={`url(#${filterId}-soft)`} />
          </g>;
        })}
        {(["purple", "red", "green"] as const).map((group) => {
          const anchor = ANCHORS[group];
          const section = displayedItems.filter((item) => item.group === group);
          const labelY = Math.max(...section.map((item) => item.y + item.size / 2)) + 24;
          const labelProgress = Math.max(0, Math.min(1, labelsProgress));
          const labelScale = 0.9 + labelProgress * 0.1;
          return section.length ? <g key={group} opacity={labelProgress * (selected ? 1 - zoomProgress : 1)}
            transform={`translate(${anchor.x} ${labelY}) scale(${labelScale}) translate(${-anchor.x} ${-labelY})`} pointerEvents="none">
            <text x={anchor.x} y={labelY} textAnchor="middle" fill={COLORS[group]} fontSize="8">{GROUP_LABELS[group]}</text>
          </g> : null;
        })}
        {displayedItems.map((item) => {
          if (stage === "journey" && journeyProgress < item.encounterIndexes[0] + 1) return null;
          const completedEncounters = item.encounterIndexes.filter((encounterIndex) => journeyProgress >= encounterIndex + 1).length;
          const brightness = Math.max(0.45, 1 - Math.max(0, completedEncounters - 1) * 0.18);
          const active = selected === item.scanId;
          const displayX = active ? d3.interpolateNumber(item.x, WIDTH / 2)(zoomProgress) : item.x;
          const displayY = active ? d3.interpolateNumber(item.y, canvasHeight / 2)(zoomProgress) : item.y;
          const displaySize = active ? d3.interpolateNumber(item.size, WIDTH * 0.9)(zoomProgress) : item.size;
          const artistFontSize = Math.max(6, Math.min(10, displaySize * 0.105));
          const artistTextWidth = Math.min(displaySize * 0.72, item.artist.length * artistFontSize * 0.6);
          return <g key={item.scanId} opacity={!selected || active ? 1 : 1 - zoomProgress}
            style={{ cursor: stage === "complete" ? "pointer" : "default" }}
            pointerEvents={selected && !active ? "none" : "auto"}
            onMouseEnter={() => { if (stage === "complete") setHovered(item.scanId); }}
            onMouseLeave={() => setHovered(null)}
            onClick={(event) => { event.stopPropagation(); enterOrExit(item.scanId); }}>
            <title>{`${item.artist} \u2014 ${item.name}`}</title>
            <image href="/marks/blue-dot.png" x={displayX - displaySize / 2} y={displayY - displaySize / 2}
              width={displaySize} height={displaySize} preserveAspectRatio="xMidYMid meet" style={{ filter: `brightness(${brightness})` }} />
            <circle cx={displayX} cy={displayY} r={displaySize * 0.38} fill="transparent" />
            {(active || hovered === item.scanId) && <text x={displayX} y={displayY} textAnchor="middle" dominantBaseline="central"
              fill="#f3f2e6" fontSize={artistFontSize} fontWeight="400" textLength={artistTextWidth} lengthAdjust="spacingAndGlyphs" pointerEvents="none">
              {item.artist}
            </text>}
          </g>;
        })}
      </svg>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
        <button onClick={() => setReplayKey((value) => value + 1)}
          style={{ padding: "9px 16px", border: "1px solid #777", borderRadius: 3, background: "transparent", cursor: "pointer" }}>
          {"\u21bb Replay"}
        </button>
        <span style={{ fontSize: 12, opacity: 0.6 }}>
          {stage === "complete" ? "Tap a mark to zoom; tap again to return" : "Reconstructing your encounters\u2026"}
        </span>
      </div>
    </div>
  );
}