//This component needs to run interactively in the browser.
// That's why we don't put "use client" everywhere. We use it where client-side interactivity is actually required.
"use client";

import { useState } from "react";

//Props let a parent component give information to a child component.
type ArtistSelectorProps = {
  name: string;
    selected: boolean;
  onToggle: () => void;
};

export default function ArtistSelector({ name, selected, onToggle }: ArtistSelectorProps) {
  return (
    <button onClick={onToggle}>
      {name}: {selected ? "Selected" : "Select artist"}
    </button>
  );
}