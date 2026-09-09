
"use client";

import { useState } from "react";
import { artists } from "../data/artists";
import ArtistSelector from "../components/ArtistSelector";

export default function SouvenirPage() {
    //This state collects all the selected artists. It's an array of artist IDs.
      const [selectedArtists, setSelectedArtists] = useState<number[]>([]);
// This function toggles an artist's selection. If the artist is already selected, it removes them from the array. If not, it adds them.
       function toggleArtist(id: number) {
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
          <ArtistSelector
            name={artist.name}
            selected={selectedArtists.includes(artist.id)}
            //this passes this toggle on to the child (ArtistSelector) component, so it can call it when the user clicks the button.
            onToggle={() => toggleArtist(artist.id)}
          />
        </div>
      ))}
            <p>Selected artists: {selectedArtists.length}</p>
    </main>
  );
}