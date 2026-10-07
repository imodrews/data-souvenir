"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { useParams } from "next/navigation";

import * as d3 from "d3";

import {
  createClient,
} from "../../../lib/supabase/client";

import type {
  Artwork,
} from "../../../types/artwork";

import AnimatedMark from "../../components/AnimatedMark";


// =====================================================
// TYPES
// =====================================================

type PackedArtwork = {
  name: string;
  artwork?: JourneyArtwork;
  children?: PackedArtwork[];
};

type Stage =
  | "journey"
  | "pause"
  | "packing"
  | "packed";

type JourneyArtwork = Artwork & {
  artist?: {
    id: string;
    name: string;
    curatorial_group: string | null;
  } | null;
};


// =====================================================
// SETTINGS
// =====================================================

function getGroupColor(
  group: string | null | undefined
) {

  switch (group) {

    case "green":
      return "#5f8f68";

    case "red":
      return "#b85c5c";

    case "purple":
      return "#8064a2";

    default:
      return "#222";
  }
}

const WIDTH = 694;
const HEIGHT = 400;

// Time to travel from one artwork to the next.
const SEGMENT_DURATION = 1200;

// Pause after the whole journey.
const JOURNEY_PAUSE = 1500;

// Time for floor-plan dots to transform into packing.
const PACK_DURATION = 2500;


// =====================================================
// COMPONENT
// =====================================================

export default function D3TestPage() {

   const params = useParams();

  const sessionId =
    params.id as string;

  const [artworks, setArtworks] =
  useState<JourneyArtwork[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [stage, setStage] =
    useState<Stage>("journey");


  // Which connection are we currently drawing?
  //
  // 0 means:
  // artwork 0 → artwork 1

  const [currentSegment, setCurrentSegment] =
    useState(0);


  // Progress through ONLY the current connection.
  //
  // 0 = beginning
  // 1 = arrived

  const [segmentProgress, setSegmentProgress] =
    useState(0);


  const [packProgress, setPackProgress] =
    useState(0);


  // Used to briefly pulse the artwork
  // we have just arrived at.

  const [pulseIndex, setPulseIndex] =
    useState<number | null>(0);


// ===================================================
// LOAD THIS VISITOR'S JOURNEY
// ===================================================

useEffect(() => {

  if (!sessionId) {
    return;
  }


  async function getJourney() {

    const supabase =
      createClient();


   const { data, error } =
  await supabase
    .from("scans")
    .select(`
      id,
      scanned_at,
      artwork_id,
      artwork:artworks (
        *,
        artist:artists (
          id,
          name,
          curatorial_group
        )
      )
    `)
    .eq(
      "session_id",
      sessionId
    )
    .order(
      "scanned_at",
      { ascending: true }
    );


    if (error) {

      console.error(
        "Could not load journey:",
        error
      );

      setLoading(false);

      return;
    }
    console.log(
  "Journey data:",
  data
);


    // Extract the artwork belonging
    // to each scan.

    const artworksFromScans =
      (data ?? [])
        .map(
          (scan) =>
            scan.artwork
        )
        .filter(Boolean)
       .flat() as JourneyArtwork[];


    setArtworks(
      artworksFromScans
    );

    // Start the visualization from
// a completely clean state.

setCurrentSegment(0);
setSegmentProgress(0);
setPackProgress(0);
setPulseIndex(0);
setStage("journey");

    setLoading(false);
  }


  getJourney();

}, [sessionId]);


  // ===================================================
  // ARTWORKS WITH FLOOR-PLAN POSITIONS
  // ===================================================

  const journeyArtworks =
    useMemo(() => {

      return artworks.filter(
        (artwork) =>
          artwork.x !== null &&
          artwork.y !== null
      );

    }, [artworks]);


  // ===================================================
  // D3 PACKING
  // ===================================================

  const root =
    useMemo(() => {

      if (journeyArtworks.length === 0) {
        return null;
      }

      const hierarchyData: PackedArtwork = {

        name: "Exhibition",

        children:
          journeyArtworks.map(
            (artwork) => ({

              name:
                artwork.title ??
                "Untitled",

              artwork,
            })
          ),
      };


      const hierarchy =
        d3
          .hierarchy(hierarchyData)
          .sum((d) =>
            d.artwork ? 1 : 0
          );


      const pack =
        d3
          .pack<PackedArtwork>()
          .size([360, 360])
          .padding(10);


      return pack(hierarchy);

    }, [journeyArtworks]);


  // ===================================================
  // LOOK UP PACKED POSITION BY ARTWORK ID
  // ===================================================

  const packedPositions =
    useMemo(() => {

      const positions =
        new Map<
          string,
          {
            x: number;
            y: number;
            r: number;
          }
        >();


      if (!root) {
        return positions;
      }


      root
        .descendants()
        .filter(
          (node) =>
            node.data.artwork
        )
        .forEach(
          (node) => {

            const artwork =
              node.data.artwork!;

            positions.set(
              artwork.id,
              {
                x:
                  node.x +
                  (WIDTH - 360) / 2,

                y:
                  node.y + 20,

                r:
                  node.r,
              }
            );
          }
        );


      return positions;

    }, [root]);


  // ===================================================
  // MAKE ONE D3 CURVE BETWEEN TWO ARTWORKS
  // ===================================================

 function makeSegmentPath(
  start: JourneyArtwork,
  end: JourneyArtwork
) {

    const points: [number, number][] = [

      [
        start.x ?? 0,
        start.y ?? 0,
      ],

      [
        end.x ?? 0,
        end.y ?? 0,
      ],
    ];


    const line =
      d3
        .line<[number, number]>()
        .x((point) => point[0])
        .y((point) => point[1])
        .curve(d3.curveBumpX);


    return line(points) ?? "";
  }


  // ===================================================
  // ANIMATE CURRENT SEGMENT
  // ===================================================

  useEffect(() => {

    if (loading) {
    return;
    }
      

    if (stage !== "journey") {
      return;
    }


    // Nothing to connect.

    if (journeyArtworks.length < 2) {

      setStage("pause");
      return;
    }


    const startTime =
      performance.now();

    let frameId: number;


    function animate(
      currentTime: number
    ) {

      const elapsed =
        currentTime - startTime;


      const progress =
        Math.min(
          elapsed / SEGMENT_DURATION,
          1
        );


      // Gives the movement a slightly
      // softer acceleration/deceleration.

      const eased =
        d3.easeCubicInOut(
          progress
        );


      setSegmentProgress(
        eased
      );


      if (progress < 1) {

        frameId =
          requestAnimationFrame(
            animate
          );

        return;
      }


      // -----------------------------------
      // WE HAVE ARRIVED
      // -----------------------------------

      const arrivedIndex =
        currentSegment + 1;


      setPulseIndex(
        arrivedIndex
      );


      // Is this the final artwork?

      if (
        arrivedIndex >=
        journeyArtworks.length - 1
      ) {

        setSegmentProgress(1);

        window.setTimeout(
          () => {
            setStage("pause");
          },
          400
        );

        return;
      }


      // Wait briefly on the artwork,
      // then start the next connection.

      window.setTimeout(
        () => {

          setCurrentSegment(
            arrivedIndex
          );

          setSegmentProgress(0);

        },
        350
      );
    }


    frameId =
      requestAnimationFrame(
        animate
      );


    return () => {

      cancelAnimationFrame(
        frameId
      );
    };

  }, [
      loading,
    stage,
    currentSegment,
    journeyArtworks,
  ]);


  // ===================================================
  // PAUSE BEFORE TRANSFORMATION
  // ===================================================

  useEffect(() => {

    if (stage !== "pause") {
      return;
    }


    const timer =
      window.setTimeout(
        () => {

          setPulseIndex(null);

          setStage("packing");

        },
        JOURNEY_PAUSE
      );


    return () =>
      window.clearTimeout(timer);

  }, [stage]);


  // ===================================================
  // PACKING TRANSITION
  // ===================================================

  useEffect(() => {

    if (stage !== "packing") {
      return;
    }


    const startTime =
      performance.now();

    let frameId: number;


    function animate(
      currentTime: number
    ) {

      const elapsed =
        currentTime - startTime;


      const rawProgress =
        Math.min(
          elapsed / PACK_DURATION,
          1
        );


      const eased =
        d3.easeCubicInOut(
          rawProgress
        );


      setPackProgress(
        eased
      );


      if (rawProgress < 1) {

        frameId =
          requestAnimationFrame(
            animate
          );

      } else {

        setPackProgress(1);
        setStage("packed");
      }
    }


    frameId =
      requestAnimationFrame(
        animate
      );


    return () => {

      cancelAnimationFrame(
        frameId
      );
    };

  }, [stage]);


  // ===================================================
  // REPLAY
  // ===================================================

  function replay() {

    setCurrentSegment(0);

    setSegmentProgress(0);

    setPackProgress(0);

    setPulseIndex(0);

    setStage("journey");
  }


  // ===================================================
  // PAGE STATES
  // ===================================================

  if (loading) {

    return (
      <main>
        <p>
          Loading artworks...
        </p>
      </main>
    );
  }


  if (!root) {

    return (
      <main>
        <p>
          No artworks found.
        </p>
      </main>
    );
  }


  // ===================================================
  // HOW MUCH SHOULD JOURNEY LINES FADE?
  // ===================================================

  const journeyOpacity =
    stage === "packing"
      ? 1 - packProgress
      : stage === "packed"
        ? 0
        : 1;


  // ===================================================
  // RENDER
  // ===================================================

  return (

    <main
      style={{
        padding: "40px",
      }}
    >

      <h1>
        Exhibition Journey
      </h1>


      <p>

        {stage === "journey"
          ? "Reconstructing journey..."

          : stage === "pause"
            ? "Journey complete"

            : stage === "packing"
              ? "Forming constellation..."

              : "Personal constellation"}

      </p>


      <button
        onClick={replay}
        style={{
          marginBottom: "20px",
        }}
      >
        Replay
      </button>


      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        style={{
          maxWidth: "900px",
          background: "#f7f6f2",
        }}
      >
        <defs>
    <filter
      id="organicBlob"
      x="-100%"
      y="-100%"
      width="300%"
      height="300%"
    >
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.025"
        numOctaves={3}
        seed={4}
        result="noise"
      />

      <feDisplacementMap
        in="SourceGraphic"
        in2="noise"
        scale={18}
        xChannelSelector="R"
        yChannelSelector="G"
      />
    </filter>
  </defs>
<AnimatedMark
  x={350}
  y={200}
  size={120}
/>

        {/* =================================
            COMPLETED JOURNEY SEGMENTS
        ================================= */}

        {journeyArtworks
          .slice(0, currentSegment)
          .map(
            (artwork, index) => {

              const next =
                journeyArtworks[
                  index + 1
                ];


              if (!next) {
                return null;
              }


              return (

                <path
                  key={
                    `complete-${artwork.id}-${next.id}`
                  }

                  d={
                    makeSegmentPath(
                      artwork,
                      next
                    )
                  }

                  fill="none"

                  stroke="#222"

                  strokeWidth={1.5}

                  strokeLinecap="round"

                  opacity={
                    journeyOpacity
                  }
                />

              );
            }
          )}


        {/* =================================
            CURRENT GROWING SEGMENT
        ================================= */}

        {stage === "journey" &&
          currentSegment <
            journeyArtworks.length - 1 && (

          <path
            d={
              makeSegmentPath(
                journeyArtworks[
                  currentSegment
                ],

                journeyArtworks[
                  currentSegment + 1
                ]
              )
            }

            fill="none"

            stroke="#222"

            strokeWidth={1.5}

            strokeLinecap="round"

            pathLength={1}

            strokeDasharray="1"

            strokeDashoffset={
              1 - segmentProgress
            }
          />

        )}


        {/* =================================
            ARTWORKS
        ================================= */}

        {journeyArtworks.map(
          (artwork, index) => {

            const packed =
              packedPositions.get(
                artwork.id
              );


            if (!packed) {
              return null;
            }

            const artworkColor =
  getGroupColor(
    artwork.artist?.curatorial_group
  );


            // ---------------------------------
            // FLOOR PLAN POSITION
            // ---------------------------------

            const startX =
              artwork.x ?? 0;

            const startY =
              artwork.y ?? 0;


            // ---------------------------------
            // PACKED POSITION
            // ---------------------------------

            const endX =
              packed.x;

            const endY =
              packed.y;


            // ---------------------------------
            // MOVE BETWEEN BOTH
            // ---------------------------------

            const x =
              d3.interpolateNumber(
                startX,
                endX
              )(packProgress);


            const y =
              d3.interpolateNumber(
                startY,
                endY
              )(packProgress);


            const radius =
              d3.interpolateNumber(
                7,
                packed.r
              )(packProgress);


            // ---------------------------------
            // HAS VISITOR REACHED THIS?
            // ---------------------------------

            const activated =
              stage !== "journey" ||
              index <= currentSegment;


            const pulsing =
              stage === "journey" &&
              index === pulseIndex;


            return (

              <g
                key={artwork.id}
              >

                {/* PULSE */}

                {pulsing && (

                  <circle
                    cx={x}
                    cy={y}
                    r={18}
                      fill={artworkColor}

    stroke={artworkColor}
                    strokeWidth={1}
                    opacity={0.25}
                  />

                )}


                {/* MAIN DOT */}

               {activated && (

  <circle
    cx={x}
    cy={y}
    r={radius}

       fill={artworkColor}

  filter="url(#organicBlob)"
  />

)}


                {/* NUMBER APPEARS DURING PACKING */}

                {packProgress > 0.4 && (

                  <text
                    x={x}
                    y={y}

                    textAnchor="middle"

                    dominantBaseline="middle"

                    fontSize={10}

                    fill="#222"

                    opacity={
                      packProgress
                    }
                  >

                    {
                      artwork
                        .exhibition_number
                    }

                  </text>

                )}

              </g>
            );
          }
        )}


        {/* =================================
            OUTER PACKED CIRCLE
        ================================= */}

        {packProgress > 0 && (

          <circle
            cx={
              root.x +
              (WIDTH - 360) / 2
            }

            cy={
              root.y + 20
            }

            r={
              root.r *
              packProgress
            }

            fill="none"

            stroke="#aaa"

            opacity={
              packProgress
            }
          />

        )}

      </svg>

    </main>
  );
}