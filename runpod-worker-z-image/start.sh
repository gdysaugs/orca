#!/usr/bin/env bash
set -euo pipefail

echo "worker-comfyui: Starting ComfyUI"
python -u /comfyui/main.py --disable-auto-launch --disable-metadata --log-stdout &
COMFY_PID=$!

COMFY_START_MAX_RETRIES="${COMFY_START_MAX_RETRIES:-300}"
COMFY_START_INTERVAL_MS="${COMFY_START_INTERVAL_MS:-1000}"

echo "worker-comfyui: Waiting for ComfyUI API"
for attempt in $(seq 1 "${COMFY_START_MAX_RETRIES}"); do
  if ! kill -0 "${COMFY_PID}" 2>/dev/null; then
    echo "worker-comfyui: ComfyUI exited before becoming reachable"
    wait "${COMFY_PID}"
    exit 1
  fi

  if python - <<'PY'
import os
import sys
import urllib.request

host = os.environ.get("COMFY_HOST", "127.0.0.1:8188")
try:
  with urllib.request.urlopen(f"http://{host}/", timeout=2) as response:
    sys.exit(0 if response.status == 200 else 1)
except Exception:
  sys.exit(1)
PY
  then
    echo "worker-comfyui: ComfyUI API is reachable"
    break
  fi

  if [ "${attempt}" = "${COMFY_START_MAX_RETRIES}" ]; then
    echo "worker-comfyui: ComfyUI API did not become reachable"
    exit 1
  fi

  sleep "$(python - <<PY
print(max(0.05, int("${COMFY_START_INTERVAL_MS}") / 1000))
PY
)"
done

echo "worker-comfyui: Starting RunPod handler"
python -u /handler.py
