#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -d "$PROJECT_DIR/demo" ]]; then
  APP_DIR="$PROJECT_DIR/demo"
else
  APP_DIR="$PROJECT_DIR/demo-site"
fi

PORT="${JOBTRAIL_PORT:-4173}"
URL="http://127.0.0.1:${PORT}"
VENV_DIR="$APP_DIR/.venv"
PYTHON_BIN="${PYTHON_BIN:-python3}"
INSTALL_STAMP="$VENV_DIR/.jobtrail-requirements-installed"

open_browser() {
  if command -v open >/dev/null 2>&1; then
    open "$URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 || true
  fi
}

if curl --silent --fail "$URL/api/dashboard" >/dev/null 2>&1; then
  echo "JobTrail is already running at $URL"
  open_browser
  exit 0
fi

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Python 3 is required. Install it from https://www.python.org/downloads/"
  exit 1
fi

mkdir -p "$APP_DIR/data"

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  echo "Creating JobTrail's private Python environment..."
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

if [[ ! -f "$INSTALL_STAMP" || "$APP_DIR/requirements.txt" -nt "$INSTALL_STAMP" ]]; then
  echo "Installing JobTrail dependencies..."
  "$VENV_DIR/bin/python" -m pip install --upgrade pip
  "$VENV_DIR/bin/python" -m pip install -r "$APP_DIR/requirements.txt"
  touch "$INSTALL_STAMP"
fi

if command -v ollama >/dev/null 2>&1; then
  if ! curl --silent --fail http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    echo "Starting Ollama for local CV and profile analysis..."
    nohup ollama serve >"$APP_DIR/data/ollama.log" 2>&1 &
    for _ in {1..15}; do
      curl --silent --fail http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break
      sleep 1
    done
  fi
  if ! ollama list 2>/dev/null | grep -q 'qwen2.5:7b'; then
    echo "Note: install the optional profile model later with: ollama pull qwen2.5:7b"
  fi
else
  echo "Note: Ollama is optional. File uploads will use basic extraction without it."
fi

echo "Starting JobTrail at $URL"
echo "Keep this window open. Press Control-C to stop the server."

(
  for _ in {1..60}; do
    if curl --silent --fail "$URL/api/dashboard" >/dev/null 2>&1; then
      open_browser
      exit 0
    fi
    sleep 1
  done
) &

cd "$APP_DIR"
exec "$VENV_DIR/bin/python" server.py --host 127.0.0.1 --port "$PORT"
