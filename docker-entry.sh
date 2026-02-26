#!/bin/sh
set -e

# Start Ollama in the background (LLM for interviews)
echo "Starting Ollama..."
ollama serve &

# Give Ollama a moment to bind; pull model in background so app can start
(sleep 3 && ollama pull llama3 2>/dev/null || true) &

# Apply Prisma schema (retry: Render DB may not be ready on first connect)
echo "Applying database schema..."
retries=5
delay=3
while [ "$retries" -gt 0 ]; do
  if npx prisma db push; then
    break
  fi
  retries=$((retries - 1))
  if [ "$retries" -eq 0 ]; then
    echo "Fatal: prisma db push failed after 5 attempts. Check DATABASE_URL and DB availability (e.g. SSL: ?sslmode=require)."
    exit 1
  fi
  echo "Prisma db push failed, retrying in ${delay}s (${retries} left)..."
  sleep "$delay"
done

echo "Starting server..."
exec node dist/index.js
