# ParseJargon

ParseJargon is a Chrome extension for Zoom Web that provides real-time jargon support:
- detects likely jargon from live captions
- generates concise definitions
- applies lightweight personalization from user background
- keeps a persistent glossary sidebar during the meeting

This repository now runs fully local:
- frontend: React Chrome extension
- backend: FastAPI service with local JSON storage


## 1. Prerequisites

- Python 3.10+
- Node.js 18+ and npm
- Google Chrome
- An OpenAI API key

## 2. Backend Setup

From repository root:

```bash
cd backend
python -m venv .venv
source .venv/Scripts/activate
pip install -r requirements.txt
```

Edit `backend/.env` and set:

```env
OPENAI_API_KEY=your_openai_api_key_here
PARSEJARGON_DATA_FILE=local_data.json
```

Run backend:

```bash
uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```

Optional health check:

- Open `http://127.0.0.1:8000/health` in a browser.

## 3. Frontend Setup

In a new terminal:

```bash
cd frontend
npm install
npm run build
```

Load extension in Chrome:

1. Open `chrome://extensions/`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select `frontend/build`

## 4. Run the System

1. Keep backend running at `http://127.0.0.1:8000`.
2. Open Zoom Web (`https://app.zoom.us/...`) and join/start a meeting.
3. ParseJargon sidebar appears on the right.
4. Enter:
   - user name
   - one-sentence background
   - model (currently support):
     - `gpt-4o`
     - `gpt-4o-mini`
     - `gpt-5.2` (`reasoning.effort = none`)
5. Click `Submit`.
6. Turn on "Show Captions"
7. As captions update, glossary terms and definitions appear in the sidebar.
8. Use `Thumb-up/Thumb-down` buttons for term-level feedback.

## 5. Local Data Storage

Session and glossary data are persisted in:

- `backend/local_data.json`

You can delete this file to reset local state.


