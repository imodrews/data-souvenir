
"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";

import type { Artist } from "../../types/artist";
import type { Artwork } from "../../types/artwork";
import FloorPlan from "../components/FloorPlan";
import { getSessionId } from "../../lib/session";

export default function SouvenirPage() {
  const [artists, setArtists] = useState<Artist[]>([]);
    //This state collects all the selected artists. It's an array of artist IDs.
      const [scannedArtworks, setScannedArtworks] = useState<Artwork[]>([]);

    useEffect(() => {
  async function getArtists() {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("artists")
       .select(`
    *,
    artworks (*)
  `);

    if (error) {
      console.error(error);
      return;
    }
console.log("Supabase data:", data);
    setArtists(data);
  }

  getArtists();
}, []);

useEffect(() => {
   const supabase = createClient();
  const sessionId = getSessionId();

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

    console.log("My scans:", data);
   const artworksFromScans = data
  .map((scan) => scan.artwork)
  .filter(Boolean)
  .flat() as Artwork[];
  console.log("Artworks from scans:", artworksFromScans);

setScannedArtworks(artworksFromScans);
  }

  getScans();
    // Listen for new scans
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
        console.log("New scan detected!");
        getScans();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, []);




const selectedArtworkData = scannedArtworks;
  console.log("Selected artwork data:", selectedArtworkData);
  return (
    <main>
      <h1>Your Souvenir</h1>
  

<h2>Your path</h2>


{/* <svg width="400" height="400">
  {selectedArtworkData.map((artwork, index) => (
    <circle
      key={artwork.id}
      cx={artwork.x ?? 0}
      cy={artwork.y ?? 0}
      r="8"
      fill="red"
    />
  ))}
</svg> */}
<svg
  viewBox="0 0 694 231"
  width="100%"
  preserveAspectRatio="xMidYMid meet"
>
   <FloorPlan />
  <defs>
    <radialGradient id="fuzzyDot">
      <stop offset="0%" stopColor="#25365c" stopOpacity="0.9" />
      <stop offset="40%" stopColor="#354568" stopOpacity="0.7" />
      <stop offset="75%" stopColor="#59647a" stopOpacity="0.25" />
      <stop offset="100%" stopColor="#59647a" stopOpacity="0" />
    </radialGradient>
      <filter id="blur">
    <feGaussianBlur stdDeviation="12" />
  </filter>
    <filter id="slight_blur">
    <feGaussianBlur stdDeviation="3" />
  </filter>
  </defs>
 

{selectedArtworkData.slice(1).map((artwork, index) => {
  const previousArtwork = selectedArtworkData[index];

  // Get the coordinates of the two artworks
  const x1 = previousArtwork.x ?? 0;
  const y1 = previousArtwork.y ?? 0;
  const x2 = artwork.x ?? 0;
  const y2 = artwork.y ?? 0;

  // Calculate the horizontal and vertical distance
  const dx = x2 - x1;
  const dy = y2 - y1;

  // Calculate the total distance between the two points
  const distance = Math.sqrt(dx * dx + dy * dy);

  // If both artworks are at the same position,
  // there is no path to draw
  if (distance === 0) {
    return null;
  }

  // Find the midpoint between the two artworks
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  // Longer distances create larger curves
  const curveAmount = distance * 0.15;

  // Move the control point perpendicular to the
  // straight line between the two artworks
  const controlX = midX - (dy / distance) * curveAmount;
  const controlY = midY + (dx / distance) * curveAmount;

  return (
   <g key={`${previousArtwork.id}-${artwork.id}-${index}`}>

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

  {selectedArtworkData.map((artwork, index) => (
     <g key={`${artwork.id}-${index}`}>
    <circle
      key={artwork.id}
      cx={artwork.x ?? 0}
      cy={artwork.y ?? 0}
      r="60"
      fill="url(#fuzzyDot)"
       filter="url(#blur)"
       className="artwork-dot"
    />
     {/* <text
      x={artwork.x ?? 0}
      y={artwork.y ?? 0}
      textAnchor="middle"
      dominantBaseline="middle"
      fill="#060606"
    >
      {artwork.title}
    </text> */}
      </g>
  ))}
    
</svg>
    </main>
  );
}