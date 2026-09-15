
"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import ArtistSelector from "../components/ArtistSelector";
import type { Artist } from "../../types/artist";

export default function SouvenirPage() {
  const [artists, setArtists] = useState<Artist[]>([]);
    //This state collects all the selected artists. It's an array of artist IDs.
      const [selectedArtists, setSelectedArtists] = useState<string[]>([]);

    useEffect(() => {
  async function getArtists() {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("artists")
      .select("*");

    if (error) {
      console.error(error);
      return;
    }
console.log(data)
    setArtists(data);
  }

  getArtists();
}, []);
// This function toggles an artist's selection. If the artist is already selected, it removes them from the array. If not, it adds them.
       function toggleArtist(id: string) {
    if (selectedArtists.includes(id)) {
      setSelectedArtists(
        selectedArtists.filter((artistId) => artistId !== id)
      );
    } else {
      setSelectedArtists([...selectedArtists, id]);
    }
  }
  return (
    <main>
      <h1>Your Souvenir</h1>
      <p>Your collected exhibition data will eventually appear here.</p>
     {artists.map((artist) => (
         <div key={artist.id}>

  <p>Artists loaded: {artists.length}</p>
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
    </main>
  );
}