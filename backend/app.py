import json
import os
import threading
import time
from pathlib import Path
from typing import Any, Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import APIConnectionError, APIStatusError, BadRequestError, OpenAI
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"

# utf-8-sig handles accidental BOM in .env files.
load_dotenv(dotenv_path=ENV_PATH, override=True, encoding="utf-8-sig")

SUPPORTED_MODELS = {"gpt-4o", "gpt-4o-mini", "gpt-5.2", "gpt-realtime"}
DEFAULT_MODEL = "gpt-4o-mini"
JARGON_IDENTIFICATION_SYSTEM_PROMPT = (
    "Your job is to help a listener understand speeches that might contain jargon terms they are unfamiliar with. "
    "You will be given the transcript snippet. For each snippet, the format will be \"Transcript: [snippet]\". "
    "Your task is to first identify any of those terms that the listener might not fully understand, then provide a definition "
    "for each term in concise plain language. "
    "Your output should be in the format of a list of term-definition pairs. "
    "Return only valid JSON in the format [{\"term\": \"definition\"}, ...]. "
    "Do not include additional commentary or text outside the JSON. "
    "Leave the list blank if you think all the terms in the input transcript are common words that don't need additional explanations. "
    "Do not include terms that are already in the previously defined term list."
)
PERSONALIZATION_SYSTEM_PROMPT = (
    "You are given a glossary, a user profile, and a user preference list. "
    "Your job is to remove terms the user is likely to already understand based on their profile and preference list. "
    "The input glossary is provided in valid JSON format, where each item is structured as {\"term\": \"definition\"}. "
    "Examine only the terms (the keys in the JSON) and remove the terms the user is likely already familiar with from the glossary. "
    "Return only valid JSON structured exactly as "
    "{\"understood_terms\": [\"term1\", \"term2\", ...], \"refined_glossary\": [{\"term\": \"definition\"}, ...]}. "
    "Do not include any extra commentary or text."
)
FEEDBACK_INTERPRETATION = {
    "thumb_up": (
        "The user considers this term important and wants continued support on related jargon in similar topics."
    ),
    "thumb_down": (
        "The user likely already understands this term and prefers fewer terms from the same topic area."
    ),
}


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


def to_prompt_glossary(items: list[dict[str, str]]) -> list[dict[str, str]]:
    return [{item["term"]: item["definition"]} for item in items if item.get("term")]


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

    try:
        response = client.responses.create(**request_args)
        return parse_json_output(response.output_text)
    except BadRequestError as e:
        error_payload = getattr(e, "body", {}) or {}
        error_info = error_payload.get("error", {}) if isinstance(error_payload, dict) else {}
        error_code = error_info.get("code")
        error_message = error_info.get("message") or str(e)
        if error_code == "model_not_found":
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Model '{model}' is not available for the current API key/project. "
                    "Select another model (for example 'gpt-4o-mini') or check your account's model access."
                ),
            ) from e
        raise HTTPException(status_code=400, detail=f"OpenAI request rejected: {error_message}") from e
    except APIConnectionError as e:
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not reach OpenAI API. Check network access, firewall/proxy settings, "
                "and verify OPENAI_API_KEY in backend/.env."
            ),
        ) from e
    except APIStatusError as e:
        raise HTTPException(status_code=502, detail=f"OpenAI API error ({e.status_code}): {str(e)}") from e


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
        liked_terms = [entry["term"] for entry in feedback_history if entry.get("feedback") == "up"]
        disliked_terms = [entry["term"] for entry in feedback_history if entry.get("feedback") == "down"]

    user_prompt = f"Transcript: {payload.transcript}, Previously defined terms: {existing_terms}"

    try:
        raw_items = run_json_prompt(
            model=model,
            system_prompt=JARGON_IDENTIFICATION_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            max_output_tokens=1200,
        )
        new_items = normalize_glossary(raw_items)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating glossary: {str(e)}") from e

    if background:
        preference_summary = {
            "thumb_up_terms": liked_terms,
            "thumb_down_terms": disliked_terms,
            "interpretation": FEEDBACK_INTERPRETATION,
        }
        personalization_user_prompt = (
            f"Glossary: {json.dumps(to_prompt_glossary(new_items), ensure_ascii=False)}, "
            f"User Profile: {background}, "
            f"User preference: {json.dumps(preference_summary, ensure_ascii=False)}"
        )
        try:
            refined = run_json_prompt(
                model=model,
                system_prompt=PERSONALIZATION_SYSTEM_PROMPT,
                user_prompt=personalization_user_prompt,
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
