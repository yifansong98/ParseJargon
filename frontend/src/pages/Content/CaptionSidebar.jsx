import React, { useEffect, useRef, useState } from "react";

const MODEL_OPTIONS = [
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4o-mini", label: "GPT-4o-mini" },
  { value: "gpt-5.2", label: "GPT-5.2" },
];

const TERM_DISPLAY_MS = 7000;

function normalizeGlossaryItems(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => {
      const term = (item?.term || "").trim();
      const definition = (item?.definition || "").trim();
      if (!term) {
        return null;
      }
      return {
        term,
        definition,
        feedback: item?.feedback ?? null,
        timestamp: item?.timestamp ?? Date.now(),
      };
    })
    .filter(Boolean);
}

function mergeUniqueNewestFirst(prev, incoming) {
  const updated = [...prev];
  incoming.forEach((entry) => {
    const exists = updated.some((item) => item.term.toLowerCase() === entry.term.toLowerCase());
    if (!exists) {
      updated.unshift(entry);
    }
  });
  return updated;
}

function mergeUniqueQueue(prev, incoming, latestTerm) {
  const queue = [...prev];
  incoming.forEach((entry) => {
    const lower = entry.term.toLowerCase();
    const isCurrent = latestTerm && latestTerm.term.toLowerCase() === lower;
    const exists = queue.some((item) => item.term.toLowerCase() === lower);
    if (!isCurrent && !exists) {
      queue.push(entry);
    }
  });
  return queue;
}

function GlossaryItem({ item, onFeedback }) {
  const [open, setOpen] = useState(false);
  const { term, definition, feedback } = item;

  return (
    <div style={{ marginBottom: "12px" }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ cursor: "pointer", textAlign: "left", fontSize: "0.95rem" }}
      >
        <strong style={{ textTransform: "capitalize" }}>{term}</strong> {open ? "[-]" : "[+]"}
      </div>

      {open && <p style={{ margin: "6px 0 0 4px", fontSize: "0.88rem" }}>{definition}</p>}

      <div style={{ marginTop: "4px" }}>
        <button
          type="button"
          onClick={() => onFeedback(term, feedback === "up" ? null : "up")}
          style={{
            marginRight: "6px",
            fontSize: "0.75rem",
            border: "1px solid #666",
            backgroundColor: feedback === "up" ? "#0f5132" : "#222",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Like
        </button>
        <button
          type="button"
          onClick={() => onFeedback(term, feedback === "down" ? null : "down")}
          style={{
            fontSize: "0.75rem",
            border: "1px solid #666",
            backgroundColor: feedback === "down" ? "#842029" : "#222",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Dislike
        </button>
      </div>
    </div>
  );
}

function Glossary({ items, onFeedback }) {
  if (!items.length) {
    return <p style={{ textAlign: "left", fontSize: "0.9rem" }}>No glossary entries yet.</p>;
  }

  return (
    <div>
      {items.map((item) => (
        <GlossaryItem key={item.term.toLowerCase()} item={item} onFeedback={onFeedback} />
      ))}
    </div>
  );
}

function ModelSelector({ selectedModel, setSelectedModel }) {
  return (
    <div style={{ marginBottom: "10px" }}>
      <label htmlFor="model-select" style={{ display: "block", marginBottom: "4px", fontSize: "0.85rem" }}>
        Model
      </label>
      <select
        id="model-select"
        value={selectedModel}
        onChange={(event) => setSelectedModel(event.target.value)}
        style={{
          width: "100%",
          padding: "6px",
          backgroundColor: "#333",
          color: "#fff",
          border: "1px solid #555",
          fontSize: "0.9rem",
        }}
      >
        {MODEL_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function LoginScreen({
  userName,
  setUserName,
  userBackground,
  setUserBackground,
  selectedModel,
  setSelectedModel,
  onSubmitLogin,
  isSubmitting,
}) {
  return (
    <div
      style={{
        backgroundColor: "#000",
        color: "#fff",
        padding: "10px",
        fontFamily: "Arial, sans-serif",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <h2 style={{ textAlign: "center", textTransform: "uppercase", marginTop: 0 }}>Log In</h2>

      <label htmlFor="username" style={{ marginBottom: "4px", fontSize: "0.85rem" }}>
        User Name
      </label>
      <input
        id="username"
        type="text"
        value={userName}
        onChange={(event) => setUserName(event.target.value)}
        style={{
          width: "100%",
          padding: "6px",
          marginBottom: "10px",
          backgroundColor: "#333",
          color: "#fff",
          border: "1px solid #555",
          fontSize: "0.9rem",
        }}
      />

      <label htmlFor="background" style={{ marginBottom: "4px", fontSize: "0.85rem" }}>
        Background
      </label>
      <textarea
        id="background"
        value={userBackground}
        onChange={(event) => setUserBackground(event.target.value)}
        placeholder="One sentence about your education and/or role"
        style={{
          width: "100%",
          height: "100px",
          padding: "6px",
          marginBottom: "10px",
          resize: "none",
          backgroundColor: "#333",
          color: "#fff",
          border: "1px solid #555",
          fontSize: "0.9rem",
        }}
      />

      <ModelSelector selectedModel={selectedModel} setSelectedModel={setSelectedModel} />

      <button
        type="button"
        onClick={onSubmitLogin}
        disabled={isSubmitting}
        style={{
          width: "100%",
          padding: "8px",
          fontSize: "0.95rem",
          cursor: isSubmitting ? "not-allowed" : "pointer",
          border: "1px solid #666",
          backgroundColor: isSubmitting ? "#222" : "#444",
          color: "#fff",
        }}
      >
        {isSubmitting ? "Submitting..." : "Submit"}
      </button>
    </div>
  );
}

function CaptionSidebar() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false);

  const [userName, setUserName] = useState("");
  const [userBackground, setUserBackground] = useState("");
  const [selectedModel, setSelectedModel] = useState(
    localStorage.getItem("parse_jargon_model") || "gpt-4o-mini"
  );

  const [caption, setCaption] = useState("Waiting for live transcription...");
  const [latestTerm, setLatestTerm] = useState(null);
  const [pendingTerms, setPendingTerms] = useState([]);
  const [latestTermTimestamp, setLatestTermTimestamp] = useState(null);
  const [sessionGlossary, setSessionGlossary] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [meetingId, setMeetingId] = useState(null);

  const latestTermRef = useRef(latestTerm);
  const latestTimestampRef = useRef(latestTermTimestamp);
  const lastRequestedCaptionRef = useRef("");

  useEffect(() => {
    latestTermRef.current = latestTerm;
  }, [latestTerm]);

  useEffect(() => {
    latestTimestampRef.current = latestTermTimestamp;
  }, [latestTermTimestamp]);

  useEffect(() => {
    localStorage.setItem("parse_jargon_model", selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    let id = localStorage.getItem("session_id");
    if (!id) {
      id = Date.now().toString();
      localStorage.setItem("session_id", id);
    }
    setSessionId(id);

    const storedMeetingId = localStorage.getItem("zoom_meeting_id") || "unknown-meeting";
    setMeetingId(storedMeetingId);
  }, []);

  useEffect(() => {
    const handleMessage = (event) => {
      if (event.data && event.data.type === "TRANSCRIPTION_UPDATE" && typeof event.data.text === "string") {
        const transcript = event.data.text.trim();
        if (transcript) {
          setCaption(transcript);
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    if (!loggedIn || !sessionId || !meetingId || !caption) {
      return;
    }

    if (caption === "Waiting for live transcription..." || caption === lastRequestedCaptionRef.current) {
      return;
    }

    if (!(window.chrome && window.chrome.runtime && window.chrome.runtime.sendMessage)) {
      return;
    }

    lastRequestedCaptionRef.current = caption;

    window.chrome.runtime.sendMessage(
      {
        type: "GENERATE_GLOSSARY",
        payload: {
          sessionId,
          meetingId,
          transcript: caption,
          model: selectedModel,
        },
      },
      (response) => {
        if (window.chrome.runtime.lastError) {
          console.error("Runtime sendMessage error:", window.chrome.runtime.lastError.message);
          return;
        }

        if (!response?.success) {
          console.error("Error generating glossary:", response?.error);
          return;
        }

        const entries = normalizeGlossaryItems(response?.data?.glossary);
        if (!entries.length) {
          return;
        }

        setSessionGlossary((prev) => mergeUniqueNewestFirst(prev, entries));

        const currentLatest = latestTermRef.current;
        if (!currentLatest) {
          const newest = entries[entries.length - 1];
          setLatestTerm(newest);
          setLatestTermTimestamp(Date.now());
          if (entries.length > 1) {
            setPendingTerms((prev) => mergeUniqueQueue(prev, entries.slice(0, -1), newest));
          }
          return;
        }

        setPendingTerms((prev) => mergeUniqueQueue(prev, entries, currentLatest));
      }
    );
  }, [caption, loggedIn, meetingId, selectedModel, sessionId]);

  useEffect(() => {
    const interval = setInterval(() => {
      const currentLatest = latestTermRef.current;
      const latestTimestamp = latestTimestampRef.current;

      if (!currentLatest || !latestTimestamp) {
        return;
      }

      if (Date.now() - latestTimestamp < TERM_DISPLAY_MS) {
        return;
      }

      setPendingTerms((prevQueue) => {
        if (!prevQueue.length) {
          return prevQueue;
        }

        const [nextTerm, ...remaining] = prevQueue;
        setLatestTerm(nextTerm);
        setLatestTermTimestamp(Date.now());
        return remaining;
      });
    }, 400);

    return () => clearInterval(interval);
  }, []);

  const handleLoginSubmit = () => {
    if (!userName.trim() || !userBackground.trim()) {
      alert("Please enter both your name and background.");
      return;
    }

    if (!sessionId || !meetingId) {
      alert("Meeting/session identifiers are not ready yet. Please wait a moment and retry.");
      return;
    }

    if (!(window.chrome && window.chrome.runtime && window.chrome.runtime.sendMessage)) {
      alert("Chrome extension messaging is not available.");
      return;
    }

    setIsSubmittingLogin(true);

    window.chrome.runtime.sendMessage(
      {
        type: "SET_USERINFO",
        payload: {
          sessionId,
          meetingId,
          userName: userName.trim(),
          background: userBackground.trim(),
        },
      },
      (response) => {
        setIsSubmittingLogin(false);

        if (window.chrome.runtime.lastError) {
          alert(`Failed to set user info: ${window.chrome.runtime.lastError.message}`);
          return;
        }

        if (!response?.success) {
          alert(`Failed to set user info: ${response?.error || "Unknown error"}`);
          return;
        }

        setLoggedIn(true);
      }
    );
  };

  const handleFeedback = (term, newFeedback) => {
    setSessionGlossary((prev) =>
      prev.map((item) =>
        item.term.toLowerCase() === term.toLowerCase() ? { ...item, feedback: newFeedback } : item
      )
    );

    setLatestTerm((prev) =>
      prev && prev.term.toLowerCase() === term.toLowerCase() ? { ...prev, feedback: newFeedback } : prev
    );

    if (!(window.chrome && window.chrome.runtime && window.chrome.runtime.sendMessage)) {
      return;
    }

    window.chrome.runtime.sendMessage(
      {
        type: "TERM_FEEDBACK",
        payload: {
          sessionId,
          meetingId,
          term,
          feedback: newFeedback,
        },
      },
      (response) => {
        if (window.chrome.runtime.lastError) {
          console.error("Feedback message failed:", window.chrome.runtime.lastError.message);
          return;
        }
        if (!response?.success) {
          console.error("Feedback API failed:", response?.error);
        }
      }
    );
  };

  if (!loggedIn) {
    return (
      <LoginScreen
        userName={userName}
        setUserName={setUserName}
        userBackground={userBackground}
        setUserBackground={setUserBackground}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        onSubmitLogin={handleLoginSubmit}
        isSubmitting={isSubmittingLogin}
      />
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        fontFamily: "Arial, sans-serif",
        backgroundColor: "#000",
        color: "#fff",
      }}
    >
      <div style={{ padding: "10px", borderBottom: "1px solid #444" }}>
        <h3 style={{ margin: "0 0 8px 0", textAlign: "center", fontSize: "1rem" }}>ParseJargon</h3>
        <ModelSelector selectedModel={selectedModel} setSelectedModel={setSelectedModel} />
        <p style={{ margin: 0, fontSize: "0.75rem", opacity: 0.8 }}>Live caption: {caption}</p>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "10px", borderBottom: "1px solid #444" }}>
        <h3 style={{ marginTop: 0, textAlign: "center", fontSize: "0.95rem" }}>Latest Term</h3>
        {latestTerm ? (
          <div>
            <strong style={{ textTransform: "capitalize", fontSize: "0.95rem" }}>{latestTerm.term}</strong>
            <p style={{ margin: "6px 0", fontSize: "0.88rem" }}>{latestTerm.definition}</p>
            <div>
              <button
                type="button"
                onClick={() =>
                  handleFeedback(latestTerm.term, latestTerm.feedback === "up" ? null : "up")
                }
                style={{
                  marginRight: "6px",
                  fontSize: "0.75rem",
                  border: "1px solid #666",
                  backgroundColor: latestTerm.feedback === "up" ? "#0f5132" : "#222",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                Like
              </button>
              <button
                type="button"
                onClick={() =>
                  handleFeedback(latestTerm.term, latestTerm.feedback === "down" ? null : "down")
                }
                style={{
                  fontSize: "0.75rem",
                  border: "1px solid #666",
                  backgroundColor: latestTerm.feedback === "down" ? "#842029" : "#222",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                Dislike
              </button>
            </div>
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: "0.9rem" }}>No jargon detected yet.</p>
        )}
      </div>

      <div style={{ flex: 2, overflowY: "auto", padding: "10px" }}>
        <h3 style={{ marginTop: 0, textAlign: "center", fontSize: "0.95rem" }}>Glossary</h3>
        <Glossary items={sessionGlossary} onFeedback={handleFeedback} />
      </div>
    </div>
  );
}

export default CaptionSidebar;
