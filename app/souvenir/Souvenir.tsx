"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";

import type { Artwork } from "../../types/artwork";
import FloorPlan from "../components/FloorPlan";

type SouvenirProps = {
  sessionId: string;
};

export default function Souvenir({ sessionId }: SouvenirProps) {
  const [scannedArtworks, setScannedArtworks] = useState<Artwork[]>([]);

  useEffect(() => {
    const supabase = createClient();

    async function getScans() {
      const { data, error } = await supabase
        .from("scans")
        .select(`
          id,
          scanned_at,
          artwork_id,
          artwork:artworks (
            *
          )
        `)
        .eq("session_id", sessionId)
        .order("scanned_at", { ascending: true });

      if (error) {
        console.error("Error loading scans:", error);
        return;
      }

      console.log("Scans for session:", sessionId, data);

      const artworksFromScans = data
        .map((scan) => scan.artwork)
        .filter(Boolean)
        .flat() as Artwork[];

      console.log("Artworks from scans:", artworksFromScans);

      setScannedArtworks(artworksFromScans);
    }

    getScans();

    // Listen for new scans belonging to THIS session
    const channel = supabase
      .channel(`scans-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "scans",
          filter: `session_id=eq.${sessionId}`,
        },
        () => {
          console.log("New scan detected for:", sessionId);
          getScans();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId]);

  const selectedArtworkData = scannedArtworks;

  return (
    <main>
      <h1>Your Souvenir</h1>

      <h2>Your path</h2>

      <svg
        viewBox="0 0 694 231"
        width="100%"
        preserveAspectRatio="xMidYMid meet"
      >
        <FloorPlan />

        <defs>
          <filter id="slight_blur">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>

        {/* PATHS */}
        {selectedArtworkData.slice(1).map((artwork, index) => {
          const previousArtwork = selectedArtworkData[index];

          const x1 = previousArtwork.x ?? 0;
          const y1 = previousArtwork.y ?? 0;
          const x2 = artwork.x ?? 0;
          const y2 = artwork.y ?? 0;

          const dx = x2 - x1;
          const dy = y2 - y1;

          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance === 0) {
            return null;
          }

          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;

          const curveAmount = distance * 0.15;

          const controlX =
            midX - (dy / distance) * curveAmount;

          const controlY =
            midY + (dx / distance) * curveAmount;

          return (
            <g
              key={`${previousArtwork.id}-${artwork.id}-${index}`}
            >
              {/* Soft haze moves first */}
              <path
                d={`M ${x1} ${y1} Q ${controlX} ${controlY} ${x2} ${y2}`}
                fill="none"
                stroke="#59647a"
                strokeWidth="12"
                strokeOpacity="0.12"
                filter="url(#slight_blur)"
                pathLength="1"
                className="path-haze"
              />

              {/* Fine trace follows */}
              <path
                d={`M ${x1} ${y1} Q ${controlX} ${controlY} ${x2} ${y2}`}
                fill="none"
                stroke="#59647a"
                strokeWidth="1.5"
                strokeOpacity="0.3"
                pathLength="1"
                className="path-trace"
              />
            </g>
          );
        })}

        {/* ARTWORK DOTS */}
        {selectedArtworkData.map((artwork, index) => (
          <g key={`${artwork.id}-${index}`}>
            <image
              href="/svg-dot-3.svg"
              x={(artwork.x ?? 0) - 60}
              y={(artwork.y ?? 0) - 60}
              width="120"
              height="120"
              preserveAspectRatio="xMidYMid meet"
              className="artwork-dot"
            />
          </g>
        ))}
      </svg>
    </main>
  );
}