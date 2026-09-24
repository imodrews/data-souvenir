"use client";

import { useEffect, useRef } from "react";
import { createClient } from "../../lib/supabase/client";
import { getSessionId } from "../../lib/session";

type RecordScanProps = {
  artworkId: string;
};

export default function RecordScan({ artworkId }: RecordScanProps) {
  const hasRecorded = useRef(false);
  useEffect(() => {
      if (hasRecorded.current) return;

    hasRecorded.current = true;
    async function recordScan() {
      const sessionId = getSessionId();
      const supabase = createClient();

    const { error } = await supabase
  .from("scans")
  .insert({
    session_id: sessionId,
    artwork_id: artworkId,
  });

if (error) {
  console.error("Error recording scan:", error);
  return;
}

console.log("Scan recorded!");
    }

    recordScan();
  }, [artworkId]);

  return null;
}