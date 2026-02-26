#!/bin/bash

# Real-Time Voice Interview System - Quick Start Script

echo "🚀 Starting Real-Time Voice Interview System..."
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if Ollama is running
echo "Checking Ollama..."
if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Ollama is running${NC}"
else
    echo -e "${YELLOW}⚠ Ollama is not running${NC}"
    echo "  Starting Ollama..."
    ollama serve &
    sleep 3
fi

# Check if llama3 model is available
echo "Checking llama3 model..."
if ollama list | grep -q "llama3"; then
    echo -e "${GREEN}✓ llama3 model is available${NC}"
else
    echo -e "${YELLOW}⚠ llama3 model not found${NC}"
    echo "  Downloading llama3 model (this may take a while)..."
    ollama pull llama3
fi

# Check if Redis is running
echo "Checking Redis..."
if redis-cli ping > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Redis is running${NC}"
else
    echo -e "${YELLOW}⚠ Redis is not running${NC}"
    echo "  Please start Redis manually: redis-server"
fi

# Check if PostgreSQL is running
echo "Checking PostgreSQL..."
if pg_isready > /dev/null 2>&1; then
    echo -e "${GREEN}✓ PostgreSQL is running${NC}"
else
    echo -e "${RED}✗ PostgreSQL is not running${NC}"
    echo "  Please start PostgreSQL manually"
    exit 1
fi

echo ""
echo "All services are ready!"
echo ""
echo "📝 Next steps:"
echo "  1. Open a new terminal and run: cd backend && npm run dev"
echo "  2. Open another terminal and run: cd frontend && npm run dev"
echo "  3. Navigate to: http://localhost:3000/voice-interview"
echo ""
echo "Enjoy your voice interview! 🎤"
