import React from "react";
import { createRoot } from "react-dom/client";
import CaptionSidebar from "./CaptionSidebar";
import "./content.styles.css";

function getMeetingIdFromUrl(url) {
  const match = url.match(/wc\/(\d+)/);
  return match ? match[1] : null;
}

function normalizeTerms(rawTerms) {
  if (!Array.isArray(rawTerms)) {
    return [];
  }

  const cleaned = rawTerms
    .map((term) => String(term || "").trim())
    .filter((term) => term.length > 0);

  return [...new Set(cleaned)];
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildHighlightedCaption(text, terms) {
  let highlighted = escapeHtml(text);
  const sortedTerms = [...terms].sort((a, b) => b.length - a.length);

  sortedTerms.forEach((term) => {
    const escapedTerm = escapeRegExp(term);
    if (!escapedTerm) {
      return;
    }

    const regex = new RegExp(`(${escapedTerm})`, "gi");
    highlighted = highlighted.replace(regex, "<strong><em>$1</em></strong>");
  });

  return highlighted;
}

if (window.top === window.self) {
  const meetingId = getMeetingIdFromUrl(window.location.href);
  if (meetingId) {
    localStorage.setItem("zoom_meeting_id", meetingId);
  }

  const broadcastHighlightTerms = (terms) => {
    for (let i = 0; i < window.frames.length; i += 1) {
      try {
        window.frames[i].postMessage(
          {
            type: "PARSEJARGON_HIGHLIGHT_TERMS",
            terms,
          },
          "*"
        );
      } catch (error) {
        console.debug("Unable to post highlight terms to frame", error);
      }
    }
  };

  window.addEventListener("message", (event) => {
    if (!event?.data || event.data.type !== "PARSEJARGON_HIGHLIGHT_TERMS") {
      return;
    }

    const terms = normalizeTerms(event.data.terms);
    broadcastHighlightTerms(terms);
  });

  if (!document.getElementById("zoom-sidebar-extension")) {
    const html = document.documentElement;
    html.style.width = "calc(100% - 300px)";
    html.style.overflowX = "hidden";

    const body = document.body;
    body.style.width = "100%";
    body.style.overflowX = "hidden";

    const sidebar = document.createElement("div");
    sidebar.id = "zoom-sidebar-extension";
    Object.assign(sidebar.style, {
      position: "fixed",
      top: 0,
      right: 0,
      width: "300px",
      height: "100%",
      backgroundColor: "#000000",
      zIndex: 999999,
      borderLeft: "1px solid #1c1c1c",
      boxShadow: "0 0 10px rgba(0,0,0,0.35)",
      overflowY: "auto",
    });
    document.body.appendChild(sidebar);

    const root = createRoot(sidebar);
    root.render(<CaptionSidebar />);
  }
} else {
  const observedContainers = new WeakSet();
  const containerUpdaters = new Set();
  const THROTTLE_MS = 1200;

  let lastCaption = "";
  let lastSentAt = 0;
  let highlightTerms = [];

  const applyCaptionHighlight = (captionSpan, rawText) => {
    const highlightedHtml = buildHighlightedCaption(rawText, highlightTerms);
    if (captionSpan.innerHTML !== highlightedHtml) {
      captionSpan.innerHTML = highlightedHtml;
    }
  };

  const maybeSendCaption = (text) => {
    const transcript = (text || "").trim();
    if (!transcript || transcript === lastCaption) {
      return;
    }

    const now = Date.now();
    if (now - lastSentAt < THROTTLE_MS) {
      return;
    }

    lastCaption = transcript;
    lastSentAt = now;

    window.top.postMessage(
      {
        type: "TRANSCRIPTION_UPDATE",
        text: transcript,
      },
      "*"
    );
  };

  const handleTermUpdates = (event) => {
    if (!event?.data || event.data.type !== "PARSEJARGON_HIGHLIGHT_TERMS") {
      return;
    }

    highlightTerms = normalizeTerms(event.data.terms);
    containerUpdaters.forEach((updateFn) => updateFn());
  };

  window.addEventListener("message", handleTermUpdates);

  const attachObserverTo = (container) => {
    if (observedContainers.has(container)) {
      return;
    }
    observedContainers.add(container);

    const updateTranscription = () => {
      const captionSpan = container.querySelector("span.live-transcription-subtitle__item");
      if (!captionSpan) {
        return;
      }

      const rawText = captionSpan.innerText || "";
      maybeSendCaption(rawText);
      applyCaptionHighlight(captionSpan, rawText);
    };

    containerUpdaters.add(updateTranscription);
    updateTranscription();

    const observer = new MutationObserver(updateTranscription);
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    const checkInterval = setInterval(() => {
      if (!document.contains(container)) {
        observer.disconnect();
        containerUpdaters.delete(updateTranscription);
        clearInterval(checkInterval);
      }
    }, 1000);
  };

  const scanAllContainers = () => {
    const containers = document.querySelectorAll("#live-transcription-subtitle");
    containers.forEach((container) => attachObserverTo(container));
  };

  scanAllContainers();
  setInterval(scanAllContainers, 1500);
}
