# JobTrail Demo

Local full-stack prototype for the CIS 454 Auto Job Application Tracker.

## Run locally

Install the one PDF dependency and run the local server:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python server.py --port 4173 --collect-now
```

Then open `http://127.0.0.1:4173`.

## Start from a fresh GitHub clone

```bash
git clone https://github.com/SidKumaran975/CIS454.git
cd CIS454/demo
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python server.py --collect-now
```

Keep the terminal open and visit `http://127.0.0.1:4173`. Use `Control-C` to
stop the server. Gmail is optional; a fresh clone immediately works with the
public Greenhouse and Lever sources.

The server collects published jobs from four Greenhouse boards and four Lever
boards, normalizes and scores them, then stores them in `data/jobtrail.db`.
Collection runs on startup and on the persisted schedule configured in the UI.

The local server can also read a LinkedIn profile export and/or CV in PDF,
DOCX, HTML, JSON, CSV, Markdown, or plain text. It extracts profile suggestions
in memory and does not save the uploaded files.

The dedicated profile workspace separates candidate facts ("Who I am") from
search intent ("What I want"). Both persist in SQLite and drive explainable
role-family, skill, domain, seniority, location, employment-type, and exclusion
scoring.

Profile documents are analyzed locally with Ollama's `qwen2.5:7b` model. The
structured result includes contact details, summary, work history, education,
projects, certifications, languages, accomplishments, authorization, clearance,
skills, and suggested role families. Users review the result before saving it;
raw files and extracted document text are not persisted. If Ollama is stopped,
the importer explicitly reports that it used the simpler rule-based fallback.

`nomic-embed-text` is detected for a later semantic-ranking phase. Qdrant is not
required for document extraction and is not currently configured.

LinkedIn, Glassdoor, and Handshake job-alert messages can be saved as `.eml`
and imported from the profile workspace. JobTrail extracts real job links,
deduplicates them, stores them in SQLite, and scores them without scraping those
platforms. Its optional Gmail integration uses read-only OAuth, processes alerts
in quota-safe batches, and never asks for or stores a mailbox password.

The dashboard contains no sample jobs. Saved, dismissed, and applied states,
the search profile, collection schedule, job listings, source health, collection
runs, and generated morning/evening digest snapshots persist in SQLite.

The scheduler runs only while `server.py` is running. Email delivery is not yet
configured; the morning and evening digest records are generated locally.
