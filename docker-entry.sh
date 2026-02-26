#!/bin/sh
set -e

# Ollama: internal only (127.0.0.1), so Render does not treat it as the web service
export OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"

# Start Ollama in the background; must not be the main process so Render sees Node on PORT
echo "Starting Ollama (background)..."
ollama serve &

# Model pull in background so app can start without waiting
(sleep 3 && ollama pull llama3 2>/dev/null || true) &

# Prisma: generate client then apply schema (migrations)
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

# Node is the main process; must listen on 0.0.0.0:$PORT for Render
echo "Starting server on 0.0.0.0:${PORT:-4000}..."
exec node dist/index.js
