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

export function finishVisit(sessionId: string) {
  localStorage.setItem("finished_session_id", sessionId);
}

export function getFinalVisitPath(sessionId: string) {
  return `/floor-test/${encodeURIComponent(sessionId)}`;
}