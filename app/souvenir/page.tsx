"use client";

import { useEffect, useState } from "react";
import { getSessionId } from "../../lib/session";
import Souvenir from "./Souvenir";

export default function PhoneJourneyPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    const id = getSessionId();
    setSessionId(id);
  }, []);

  if (!sessionId) {
    return <p>Loading your souvenir...</p>;
  }

  return <Souvenir sessionId={sessionId} />;
}