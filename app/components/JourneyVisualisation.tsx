"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import gsap from "gsap";
import AnimatedMark from "./AnimatedMark";

const WIDTH = 694;
const HEIGHT = 231;
const VIEW_WIDTH = HEIGHT;
const VIEW_HEIGHT = WIDTH;
const PANEL_LAYOUT = [
  { x: 28, y: 0, width: 184, height: 26, fill: "#f5f3ef", opacity: 0.1 },
  { x: 29, y: 28, width: 32, height: 154, fill: "#777777", opacity: 0.1 },
  { x: 64, y: 28, width: 109, height: 72, fill: "#faf8f2", opacity: 0.12 },
  { x: 176, y: 28, width: 35, height: 72, fill: "#5e5e5e", opacity: 0.11 },
  { x: 64, y: 104, width: 136, height: 77, fill: "#efede8", opacity: 0.1 },
  { x: 29, y: 186, width: 32, height: 88, fill: "#5e5e5e", opacity: 0.11 },
  { x: 64, y: 186, width: 136, height: 87, fill: "#777777", opacity: 0.1 },
  { x: 29, y: 278, width: 32, height: 124, fill: "#faf8f2", opacity: 0.1 },
  { x: 64, y: 278, width: 109, height: 124, fill: "#f5f3ef", opacity: 0.1 },
  { x: 176, y: 186, width: 35, height: 216, fill: "#5e5e5e", opacity: 0.09 },
  { x: 30, y: 408, width: 192, height: 28, fill: "#efede8", opacity: 0.11 },
  { x: 38, y: 440, width: 39, height: 176, fill: "#777777", opacity: 0.1 },
  { x: 80, y: 440, width: 67, height: 176, fill: "#faf8f2", opacity: 0.12 },
  { x: 150, y: 440, width: 64, height: 176, fill: "#5e5e5e", opacity: 0.1 },
  { x: 30, y: 620, width: 192, height: 26, fill: "#f5f3ef", opacity: 0.1 },
];
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

type JourneyVisualisationProps = {
  encounters: JourneyEncounter[];
  mode: "live" | "final";
};

export default function JourneyVisualisation({ encounters, mode }: JourneyVisualisationProps) {
  const filterId = useId().replaceAll(":", "");
  const [stage, setStage] = useState<"journey" | "complete">("complete");
  const [journeyProgress, setJourneyProgress] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
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
  const journeyMarkSize = Math.max(14, Math.min(30, 90 / Math.sqrt(items.length || 1)));
  const positioned = useMemo(() => items, [items]);
  const canvasHeight = VIEW_HEIGHT;

  useEffect(() => {
    if (mode === "live" || !positioned.length) return;
    let timeline: gsap.core.Timeline | undefined;
    const frame = requestAnimationFrame(() => {
      setJourneyProgress(0);
      setSelected(null);
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
      timeline.call(() => setStage("complete"));
    });
    return () => {
      cancelAnimationFrame(frame);
      timeline?.kill();
    };
  }, [positioned, encounterCount, replayKey, mode]);

  useEffect(() => () => { zoomTween.current?.kill(); }, []);

  function enterOrExit(scanId: string) {
    if (mode === "live") return;
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

  const displayedItems = useMemo(() => positioned.map((item) => ({ ...item, size: journeyMarkSize })), [positioned, journeyMarkSize]);
  const pathSegments = useMemo(() => {
    const encounterSequence = displayedItems
    .flatMap((item) => item.encounterIndexes.map((encounterIndex) => ({ item, encounterIndex })))
    .sort((first, second) => first.encounterIndex - second.encounterIndex);
  const entranceSegment = encounterSequence[0]
    ? d3.line<[number, number]>().x((point) => point[0]).y((point) => point[1])
      .curve(d3.curveBumpY)([[VIEW_WIDTH / 2, 0], [encounterSequence[0].item.x, encounterSequence[0].item.y]])
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
      <svg viewBox={`0 0 ${VIEW_WIDTH} ${canvasHeight}`} width="100%" preserveAspectRatio="xMidYMid meet"
        style={{ display: "block", width: "100%", height: "min(900px, max(520px, calc(100dvh - 120px)))", background: "#000", overflow: "hidden" }}
        onClick={() => { if (selected) enterOrExit(selected); }}
        aria-label={mode === "live" ? "Visitor journey" : "Visitor journey and interactive constellation"}>
        <defs>
          <filter id={`${filterId}-halo`} x="0" y="0" width={WIDTH} height={HEIGHT} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse">
            <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="8" result="grain" />
            <feDisplacementMap in="SourceGraphic" in2="grain" scale="8" xChannelSelector="R" yChannelSelector="G" result="organic" />
            <feGaussianBlur in="organic" stdDeviation="9" />
          </filter>
          <filter id={`${filterId}-soft`} x="0" y="0" width={WIDTH} height={HEIGHT} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse">
            <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="13" result="grain" />
            <feDisplacementMap in="SourceGraphic" in2="grain" scale="4" xChannelSelector="R" yChannelSelector="G" result="organic" />
            <feGaussianBlur in="organic" stdDeviation="3" />
          </filter>
          <filter id={`${filterId}-layer`} x="-5%" y="-5%" width="110%" height="115%">
            <feTurbulence type="fractalNoise" baseFrequency="0.32" numOctaves="2" seed="18" result="texture" />
            <feColorMatrix in="texture" type="saturate" values="0" result="monoTexture" />
            <feComposite in="monoTexture" in2="SourceAlpha" operator="in" result="maskedTexture" />
            <feBlend in="SourceGraphic" in2="maskedTexture" mode="soft-light" result="texturedLayer" />
            <feGaussianBlur in="SourceAlpha" stdDeviation="5" result="shadowBlur" />
            <feOffset in="shadowBlur" dy="8" result="shadowOffset" />
            <feFlood floodColor="#000000" floodOpacity="0.38" result="shadowColor" />
            <feComposite in="shadowColor" in2="shadowOffset" operator="in" result="shadow" />
            <feMerge>
              <feMergeNode in="shadow" />
              <feMergeNode in="texturedLayer" />
            </feMerge>
          </filter>
          <filter id={`${filterId}-panel`} x="-20%" y="-20%" width="140%" height="150%">
            <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#000000" floodOpacity="0.55" />
          </filter>
        </defs>
        <image href="/bottom_layer.png" x="0" y="0" width={VIEW_WIDTH} height={VIEW_HEIGHT}
          preserveAspectRatio="none" opacity="0.28" filter={`url(#${filterId}-layer)`} />
        <image href="/top_layer.png" x="0" y="405" width={VIEW_WIDTH} height="289"
          opacity="0.32" filter={`url(#${filterId}-layer)`} />
        <g pointerEvents="none">
          {PANEL_LAYOUT.map((panel, index) => <rect key={index}
            x={panel.x}
            y={panel.y}
            width={panel.width}
            height={panel.height}
            fill={panel.fill}
            opacity={panel.opacity}
            stroke="#d8d5cf"
            strokeOpacity="0.12"
            strokeWidth="1"
            filter={`url(#${filterId}-panel)`} />)}
        </g>
        <g opacity={0.65} pointerEvents="none">
          <g filter={`url(#${filterId}-halo)`} opacity={0.2}>
            {pathSegments.map(({ d, index }) => <path key={index} d={d} fill="none" stroke="#873c70" strokeWidth={8} strokeLinecap="round"
              pathLength={1} strokeDasharray="1" strokeDashoffset={1 - Math.max(0, Math.min(1, visibleJourneyProgress - index))} />)}
          </g>
          <g filter={`url(#${filterId}-soft)`} opacity={0.22}>
            {pathSegments.map(({ d, index }) => <path key={index} d={d} fill="none" stroke="#873c70" strokeWidth={4} strokeLinecap="round"
              pathLength={1} strokeDasharray="1" strokeDashoffset={1 - Math.max(0, Math.min(1, visibleJourneyProgress - index))} />)}
          </g>
        </g>
        {displayedItems.map((item) => {
          const active = selected === item.scanId;
          const displayX = active ? d3.interpolateNumber(item.x, VIEW_WIDTH / 2)(zoomProgress) : item.x;
          const displayY = active ? d3.interpolateNumber(item.y, VIEW_HEIGHT / 2)(zoomProgress) : item.y;
          const displaySize = active ? d3.interpolateNumber(item.size, VIEW_WIDTH * 0.8)(zoomProgress) : item.size;
          return <g key={item.scanId} style={{ cursor: mode === "final" ? "pointer" : "default" }}
            pointerEvents={selected && !active ? "none" : "auto"}
            onClick={(event) => { event.stopPropagation(); enterOrExit(item.scanId); }}>
            <title>{`${item.artist} \u2014 ${item.name}`}</title>
            <AnimatedMark x={displayX} y={displayY} size={displaySize} />
          </g>;
        })}
        <text x={VIEW_WIDTH / 2} y={14} textAnchor="middle" fill="#e1dfd2" fontSize="8" pointerEvents="none">entrance</text>
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