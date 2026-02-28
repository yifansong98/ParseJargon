const BACKEND_BASE_URL = "http://127.0.0.1:8000";
const API_TIMEOUT_MS = 90000;

function apiUrl(path) {
  return `${BACKEND_BASE_URL}${path}`;
}

async function postJson(path, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(apiUrl(path), {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        data = { raw: text };
      }
    }

    if (!response.ok) {
      const detail = data.detail || data.error || text || response.statusText;
      throw new Error(`HTTP ${response.status}: ${detail}`);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === "GENERATE_GLOSSARY") {
    const { sessionId, meetingId, transcript, model } = request.payload;
    postJson("/api/generate", {
      session_id: sessionId,
      meeting_id: meetingId,
      transcript,
      model,
    })
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.toString() }));
    return true;
  }

  if (request.type === "SET_USERINFO") {
    const { sessionId, meetingId, userName, background } = request.payload;
    postJson("/api/set_userinfo", {
      session_id: sessionId,
      meeting_id: meetingId,
      user_name: userName,
      background,
    })
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.toString() }));
    return true;
  }

  if (request.type === "TERM_FEEDBACK") {
    const { sessionId, meetingId, term, feedback } = request.payload;
    postJson("/api/feedback", {
      session_id: sessionId,
      meeting_id: meetingId,
      term,
      feedback,
    })
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.toString() }));
    return true;
  }

  return false;
});
