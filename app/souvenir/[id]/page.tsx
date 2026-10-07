"use client";

import { useParams } from "next/navigation";
import Souvenir from "../Souvenir";

export default function SharedSouvenirPage() {
  const params = useParams();

  const sessionId = params.id as string;

  if (!sessionId) {
    return <p>Loading souvenir...</p>;
  }

  return <Souvenir sessionId={sessionId} />;
}