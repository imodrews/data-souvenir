const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const visualisationUrl = new URL(`/souvenir/${sessionId}`, request.url).toString();
  return new Response(visualisationUrl, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}