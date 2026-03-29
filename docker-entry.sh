#!/bin/sh
set -e

# Ollama: bind to loopback only (host:port, no http). Same-container backend uses OLLAMA_BASE_URL.
export OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1:11434}"
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"

# Lower defaults for sidecar-in-container with Node (override on Northflank if you have more RAM)
export OLLAMA_MAX_LOADED_MODELS="${OLLAMA_MAX_LOADED_MODELS:-1}"
export OLLAMA_NUM_PARALLEL="${OLLAMA_NUM_PARALLEL:-1}"

echo "Starting Ollama (background)..."
ollama serve &
OLLAMA_PID=$!

# Wait until the API accepts TCP connections so Node does not race ahead and log "connection refused".
# Exit 137 / "Killed" usually means the Linux OOM killer removed Ollama — raise Northflank memory.
echo "Waiting for Ollama at ${OLLAMA_BASE_URL}..."
i=0
max=90
while [ "$i" -lt "$max" ]; do
  if curl -sf "${OLLAMA_BASE_URL}/api/tags" >/dev/null 2>&1; then
    echo "Ollama is reachable."
    break
  fi
  if ! kill -0 "$OLLAMA_PID" 2>/dev/null; then
    echo "WARN: Ollama process exited before becoming ready (common causes: OOM, disk, or bad OLLAMA_HOST)."
    break
  fi
  i=$((i + 1))
  sleep 1
done
if [ "$i" -eq "$max" ]; then
  echo "WARN: Ollama did not respond within ${max}s. Increase memory or check logs; backend may still start (e.g. OpenRouter)."
fi

# Pull model in background only when not relying solely on OpenRouter (pull spikes RAM/CPU).
if [ -n "${OPENROUTER_API_KEY:-}" ]; then
  echo "OPENROUTER_API_KEY is set; skipping background ollama pull."
elif [ "${SKIP_OLLAMA_PULL:-}" = "1" ] || [ "${SKIP_OLLAMA_PULL:-}" = "true" ]; then
  echo "SKIP_OLLAMA_PULL set; skipping ollama pull (ensure model is already in the image or pull manually once)."
else
  MODEL="${OLLAMA_MODEL:-llama3}"
  (sleep 3 && ollama pull "$MODEL" 2>/dev/null || true) &
fi

# Prisma: generate client then apply schema
echo "Generating Prisma client..."
npx prisma generate

echo "Applying database schema..."
retries=5
delay=3
while [ "$retries" -gt 0 ]; do
  if npx prisma db push; then
    break
  fi
  retries=$((retries - 1))
  if [ "$retries" -eq 0 ]; then
    echo "Fatal: prisma db push failed after 5 attempts. Check DATABASE_URL (e.g. ?sslmode=require)."
    exit 1
  fi
  echo "Prisma db push failed, retrying in ${delay}s (${retries} left)..."
  sleep "$delay"
done

# Node is the main process; bind 0.0.0.0 via app — Northflank must set PORT to the service port
echo "Starting server on 0.0.0.0:${PORT:-4000}..."
exec node dist/index.js
