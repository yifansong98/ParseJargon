import React from "react";
import { createRoot } from "react-dom/client";
import CaptionSidebar from "./CaptionSidebar";
import "./content.styles.css";

function getMeetingIdFromUrl(url) {
  const match = url.match(/wc\/(\d+)/);
  return match ? match[1] : null;
}

if (window.top === window.self) {
  const meetingId = getMeetingIdFromUrl(window.location.href);
  if (meetingId) {
    localStorage.setItem("zoom_meeting_id", meetingId);
  }

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
      backgroundColor: "#ffffff",
      zIndex: 999999,
      borderLeft: "1px solid #ccc",
      boxShadow: "0 0 5px rgba(0,0,0,0.3)",
      overflowY: "auto",
    });
    document.body.appendChild(sidebar);

    const root = createRoot(sidebar);
    root.render(<CaptionSidebar />);
  }
} else {
  const observedContainers = new WeakSet();
  const THROTTLE_MS = 1200;

  let lastCaption = "";
  let lastSentAt = 0;

  function maybeSendCaption(text) {
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
  }

  function attachObserverTo(container) {
    if (observedContainers.has(container)) {
      return;
    }
    observedContainers.add(container);

    const updateTranscription = () => {
      const captionSpan = container.querySelector("span.live-transcription-subtitle__item");
      if (!captionSpan) {
        return;
      }
      maybeSendCaption(captionSpan.innerText);
    };

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
        clearInterval(checkInterval);
      }
    }, 1000);
  }

  function scanAllContainers() {
    const containers = document.querySelectorAll("#live-transcription-subtitle");
    containers.forEach((container) => attachObserverTo(container));
  }

  scanAllContainers();
  setInterval(scanAllContainers, 1500);
}
