#!/bin/bash
# AyuBridge backend launcher — creates the venv on first run, then serves on :8000
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  echo "· creating virtualenv…"
  python3 -m venv .venv
  ./.venv/bin/pip install -q --disable-pip-version-check -r requirements.txt
fi
echo "· AyuBridge API → http://localhost:8000 (docs at /docs)"
exec ./.venv/bin/uvicorn ayubridge.main:app --host 0.0.0.0 --port 8000 "$@"
