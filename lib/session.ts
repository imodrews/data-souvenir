export type FinishedVisit = {
  sessionId: string;
  finishedAt: string | null;
};

function isFinishedVisit(value: unknown): value is FinishedVisit {
  if (typeof value !== "object" || value === null) return false;
  return "sessionId" in value && typeof value.sessionId === "string" &&
    "finishedAt" in value && (typeof value.finishedAt === "string" || value.finishedAt === null);
}

export function getSessionId() {
  let sessionId = localStorage.getItem("session_id");

  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem("session_id", sessionId);
  }

  return sessionId;
}

export function isVisitFinished(sessionId: string) {
  return localStorage.getItem("finished_session_id") === sessionId;
}

export function getFinishedVisits() {
  let visits: FinishedVisit[] = [];
  const storedVisits = localStorage.getItem("finished_visits");

  if (storedVisits) {
    try {
      const parsed: unknown = JSON.parse(storedVisits);
      if (Array.isArray(parsed)) visits = parsed.filter(isFinishedVisit);
    } catch {
      visits = [];
    }
  }

  const latestFinishedSession = localStorage.getItem("finished_session_id");
  if (latestFinishedSession && !visits.some((visit) => visit.sessionId === latestFinishedSession)) {
    visits.unshift({ sessionId: latestFinishedSession, finishedAt: null });
  }

  return visits;
}

export function startFreshVisitIfFinished(sessionId: string) {
  if (!isVisitFinished(sessionId)) return sessionId;

  localStorage.removeItem("visitor_name");
  localStorage.removeItem("session_id");
  return getSessionId();
}

export function finishVisit(sessionId: string) {
  const visits = getFinishedVisits();
  if (!visits.some((visit) => visit.sessionId === sessionId)) {
    visits.unshift({ sessionId, finishedAt: new Date().toISOString() });
  }
  localStorage.setItem("finished_visits", JSON.stringify(visits.slice(0, 20)));
  localStorage.setItem("finished_session_id", sessionId);
}

export function getFinalVisitPath(sessionId: string) {
  return `/souvenir/${encodeURIComponent(sessionId)}`;
}