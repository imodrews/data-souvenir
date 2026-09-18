
"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import ArtistSelector from "../components/ArtistSelector";
import type { Artist } from "../../types/artist";
import FloorPlan from "../components/FloorPlan";

export default function SouvenirPage() {
  const [artists, setArtists] = useState<Artist[]>([]);
    //This state collects all the selected artists. It's an array of artist IDs.
      const [selectedArtists, setSelectedArtists] = useState<string[]>([]);
      const [selectedArtworks, setSelectedArtworks] = useState<string[]>([]);

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
// This function toggles an artist's selection. If the artist is already selected, it removes them from the array. If not, it adds them.
       function toggleArtist(id: string) {
    if (selectedArtists.includes(id)) {
      setSelectedArtists(
        selectedArtists.filter((artistId) =>  artistId !== id)
      );
    } else {
      
      setSelectedArtists([...selectedArtists, id]);
    }
  }
  function toggleArtwork(id: string) {
  if (selectedArtworks.includes(id)) {
    setSelectedArtworks(
      selectedArtworks.filter((artworkId) => artworkId !== id)
    );
  } else {
    setSelectedArtworks([...selectedArtworks, id]);
  }
}

const selectedArtworkData = selectedArtworks
  .map((id) =>
    artists
      .flatMap((artist) => artist.artworks)
      .find((artwork) => artwork.id === id)
  )
  .filter((artwork) => artwork !== undefined);
  console.log("Selected artwork data:", selectedArtworkData);
  return (
    <main>
      <h1>Your Souvenir</h1>
      <p>Your collected exhibition data will eventually appear here.</p>
        <p>Artists loaded: {artists.length}</p>
     {artists.map((artist) => (
         <div key={artist.id}>


          <ArtistSelector
            name={artist.name}
            selected={selectedArtists.includes(artist.id)}
            //this passes this toggle on to the child (ArtistSelector) component, so it can call it when the user clicks the button.
            onToggle={() => toggleArtist(artist.id)}
          />
        </div>
      ))}
      {artists
        .filter((artist) => selectedArtists.includes(artist.id))
        .map((artist) => (
          <div key={artist.id}>
            <p>{artist.name}</p>
          </div>
        ))}
        {artists
          .filter((artist) => selectedArtists.includes(artist.id))
          .flatMap((artist) => artist.artworks)
          .map((artwork) => (
  <button
    key={artwork.id}
    onClick={() => toggleArtwork(artwork.id)}
  >
    {artwork.title}
    {selectedArtworks.includes(artwork.id) ? " ✓" : ""}
  </button>
))}
<h2>Your path</h2>

// I will use this later when testing how well things work:

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
  viewBox="0 0 1015 476"
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
    <feGaussianBlur stdDeviation="5" />
  </filter>
  </defs>
 

    {selectedArtworkData.slice(1).map((artwork, index) => {
    const previousArtwork = selectedArtworkData[index];

    return (
      <line
        key={`${previousArtwork.id}-${artwork.id}`}
        x1={previousArtwork.x ?? 0}
        y1={previousArtwork.y ?? 0}
        x2={artwork.x ?? 0}
        y2={artwork.y ?? 0}
        stroke="black"
        strokeWidth="2"
         filter="url(#slight_blur)"
      />
    );
  })}

  {selectedArtworkData.map((artwork) => (
     <g key={artwork.id}>
    <circle
      key={artwork.id}
      cx={artwork.x ?? 0}
      cy={artwork.y ?? 0}
      r="60"
      fill="url(#fuzzyDot)"
       filter="url(#blur)"
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