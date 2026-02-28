import json
import os
import threading
import time
from pathlib import Path
from typing import Any, Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"

# utf-8-sig handles accidental BOM in .env files.
load_dotenv(dotenv_path=ENV_PATH, override=True, encoding="utf-8-sig")

SUPPORTED_MODELS = {"gpt-4o", "gpt-4o-mini", "gpt-5.2"}
DEFAULT_MODEL = "gpt-4o-mini"


def resolve_data_file() -> Path:
    raw = os.getenv("PARSEJARGON_DATA_FILE", "local_data.json")
    candidate = Path(raw)
    return candidate if candidate.is_absolute() else BASE_DIR / candidate


DATA_FILE = resolve_data_file()
OPENAI_API_KEY = (os.getenv("OPENAI_API_KEY") or "").strip()

app = FastAPI(title="ParseJargon Local Backend", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None
storage_lock = threading.Lock()


def load_data() -> dict[str, Any]:
    if not DATA_FILE.exists():
        return {}

    try:
        with DATA_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


session_states = load_data()


def save_data() -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    with DATA_FILE.open("w", encoding="utf-8") as f:
        json.dump(session_states, f, indent=2, ensure_ascii=False)


def get_meeting_state(session_id: str, meeting_id: str) -> dict[str, Any]:
    if session_id not in session_states:
        session_states[session_id] = {"meetings": {}}

    meetings = session_states[session_id]["meetings"]
    if meeting_id not in meetings:
        meetings[meeting_id] = {
            "userName": "",
            "background": "",
            "glossaryEntries": [],
        }

    return meetings[meeting_id]


def parse_json_output(raw_text: str) -> Any:
    text = raw_text.strip()
    if not text:
        raise ValueError("Model returned empty text.")

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        if "```" in text:
            text = text.replace("```json", "").replace("```", "").strip()
            return json.loads(text)
        raise


def normalize_glossary(items: Any) -> list[dict[str, str]]:
    if not isinstance(items, list):
        return []

    normalized = []
    for item in items:
        if not isinstance(item, dict):
            continue

        term = ""
        definition = ""

        if "term" in item and "definition" in item:
            term = str(item.get("term", "")).strip()
            definition = str(item.get("definition", "")).strip()
        elif len(item) == 1:
            key = next(iter(item))
            term = str(key).strip()
            definition = str(item[key]).strip()

        if term:
            normalized.append({"term": term, "definition": definition})

    return normalized


def run_json_prompt(
    *,
    model: str,
    system_prompt: str,
    user_prompt: str,
    max_output_tokens: int,
) -> Any:
    if client is None:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY is missing. Set it in backend/.env before running.",
        )

    request_args: dict[str, Any] = {
        "model": model,
        "input": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "max_output_tokens": max_output_tokens,
    }
    if model == "gpt-5.2":
        request_args["reasoning"] = {"effort": "none"}

    response = client.responses.create(**request_args)
    return parse_json_output(response.output_text)


def validate_model(model: str | None) -> str:
    selected = (model or DEFAULT_MODEL).strip()
    if selected not in SUPPORTED_MODELS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported model '{selected}'. Allowed models: {sorted(SUPPORTED_MODELS)}",
        )
    return selected


class SetUserInfoRequest(BaseModel):
    session_id: str = Field(min_length=1)
    meeting_id: str = Field(min_length=1)
    user_name: str = Field(min_length=1)
    background: str


class GenerateRequest(BaseModel):
    session_id: str = Field(min_length=1)
    meeting_id: str = Field(min_length=1)
    transcript: str = Field(min_length=1)
    model: str | None = DEFAULT_MODEL


class FeedbackRequest(BaseModel):
    session_id: str = Field(min_length=1)
    meeting_id: str = Field(min_length=1)
    term: str = Field(min_length=1)
    feedback: Literal["up", "down"] | None = None


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "data_file": str(DATA_FILE),
        "supported_models": sorted(SUPPORTED_MODELS),
        "openai_key_configured": bool(OPENAI_API_KEY),
    }


@app.post("/api/set_userinfo")
def set_userinfo(payload: SetUserInfoRequest) -> dict[str, str]:
    with storage_lock:
        meeting = get_meeting_state(payload.session_id, payload.meeting_id)
        meeting["userName"] = payload.user_name.strip()
        meeting["background"] = payload.background.strip()
        save_data()

    return {"status": "user info set successfully"}


@app.post("/api/generate")
def generate_glossary(payload: GenerateRequest) -> dict[str, list[dict[str, Any]]]:
    model = validate_model(payload.model)

    with storage_lock:
        meeting = get_meeting_state(payload.session_id, payload.meeting_id)
        background = meeting.get("background", "").strip()
        existing_terms = [e.get("term", "") for e in meeting.get("glossaryEntries", []) if e.get("term")]
        feedback_history = [
            {"term": e.get("term", ""), "feedback": e.get("feedback")}
            for e in meeting.get("glossaryEntries", [])
            if e.get("feedback") in {"up", "down"}
        ]

    user_prompt_parts = []
    if existing_terms:
        user_prompt_parts.append(f"Previously defined terms: {existing_terms}")
    user_prompt_parts.append(f"Transcript: {payload.transcript}")
    user_prompt = "\n".join(user_prompt_parts)

    base_prompt = (
        "Your job is to help an audience listen to speeches that might contain unfamiliar terms. "
        "Given a transcript snippet, identify terms that likely need explanation and provide concise definitions in plain language. "
        "Return ONLY valid JSON in this exact format: [{\"term\": \"...\", \"definition\": \"...\"}]. "
        "Do not include terms already in the provided previous term list. "
        "If no terms need explanation, return [] only."
    )

    try:
        raw_items = run_json_prompt(
            model=model,
            system_prompt=base_prompt,
            user_prompt=user_prompt,
            max_output_tokens=1200,
        )
        new_items = normalize_glossary(raw_items)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating glossary: {str(e)}") from e

    if background:
        personalization_prompt = (
            "You are given a glossary and a user profile. "
            "Remove terms the user is likely to already understand. "
            "Return ONLY valid JSON in this exact format: "
            "{\"understood_terms\": [\"...\"], \"refined_glossary\": [{\"term\": \"...\", \"definition\": \"...\"}]}. "
            "Do not add any extra text."
        )
        personalization_input = json.dumps(
            {
                "background": background,
                "feedback_history": feedback_history,
                "candidate_glossary": new_items,
            },
            ensure_ascii=False,
        )
        try:
            refined = run_json_prompt(
                model=model,
                system_prompt=personalization_prompt,
                user_prompt=personalization_input,
                max_output_tokens=900,
            )
            refined_glossary = refined.get("refined_glossary", new_items) if isinstance(refined, dict) else new_items
            new_items = normalize_glossary(refined_glossary)
        except Exception as e:
            # Keep original extraction if personalization fails.
            print(f"Personalization warning: {e}")

    newly_added: list[dict[str, Any]] = []
    now_ms = int(time.time() * 1000)

    with storage_lock:
        meeting = get_meeting_state(payload.session_id, payload.meeting_id)
        glossary_entries = meeting.get("glossaryEntries", [])
        known_terms = {str(e.get("term", "")).strip().lower() for e in glossary_entries if e.get("term")}

        for item in new_items:
            term = item.get("term", "").strip()
            definition = item.get("definition", "").strip()
            if not term:
                continue
            lower_term = term.lower()
            if lower_term in known_terms:
                continue

            entry = {
                "term": term,
                "definition": definition,
                "timestamp": now_ms,
                "feedback": None,
            }
            glossary_entries.append(entry)
            known_terms.add(lower_term)
            newly_added.append(entry)

        meeting["glossaryEntries"] = glossary_entries
        save_data()

    return {"glossary": newly_added}


@app.post("/api/feedback")
def store_feedback(payload: FeedbackRequest) -> dict[str, str]:
    term = payload.term.strip()
    if not term:
        raise HTTPException(status_code=400, detail="Term cannot be empty.")

    with storage_lock:
        meeting = get_meeting_state(payload.session_id, payload.meeting_id)
        found = False
        for entry in meeting.get("glossaryEntries", []):
            if str(entry.get("term", "")).strip().lower() == term.lower():
                entry["feedback"] = payload.feedback
                found = True
                break

        if not found:
            raise HTTPException(
                status_code=404,
                detail=f"Term '{term}' not found for session '{payload.session_id}' and meeting '{payload.meeting_id}'.",
            )

        save_data()

    return {"status": "feedback recorded successfully"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=int(os.getenv("PORT", "8000")), reload=True)
