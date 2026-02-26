#!/bin/sh
set -e

# Start Ollama in the background (LLM for interviews)
echo "Starting Ollama..."
ollama serve &

# Give Ollama a moment to bind; pull model in background so app can start
(sleep 3 && ollama pull llama3 2>/dev/null || true) &

# Apply Prisma schema to the database
echo "Applying database schema..."
npx prisma db push

echo "Starting server..."
exec node dist/index.js
