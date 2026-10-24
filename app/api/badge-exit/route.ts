import { createClient } from "@supabase/supabase-js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BADGE_EXIT_CHANNEL = "badge-exit-display";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "A JSON session_id is required." }, { status: 400 });
  }

  const sessionId = (body as { session_id?: unknown } | null)?.session_id;
  if (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId)) {
    return Response.json({ error: "A valid session_id is required." }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
  const channel = supabase.channel(BADGE_EXIT_CHANNEL);
  const broadcastStatus = await channel.send({
    type: "broadcast",
    event: "session-ended",
    payload: { session_id: sessionId },
  });
  await supabase.removeChannel(channel);

  if (broadcastStatus !== "ok") {
    return Response.json({ error: "The kiosk could not be notified." }, { status: 503 });
  }

  const visualisationUrl = new URL(`/ending-test/${sessionId}`, request.url).toString();
  return new Response(visualisationUrl, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}