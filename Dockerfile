# ========== Stage 1: Build whisper.cpp ==========
FROM node:18-bookworm-slim AS whisper-builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake \
    build-essential \
    git \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Clone whisper.cpp (avoids COPY context issues; works in CI and locally)
ARG WHISPER_CPP_REV=v1.8.3
RUN git clone --depth 1 --branch ${WHISPER_CPP_REV} https://github.com/ggml-org/whisper.cpp.git /build/whisper.cpp

RUN cd /build/whisper.cpp \
    && cmake -B build \
        -DWHISPER_BUILD_EXAMPLES=ON \
        -DWHISPER_BUILD_TESTS=OFF \
        -DWHISPER_FFMPEG=OFF \
        -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build --target whisper-cli -j$(nproc)

# Download base.en model (used by transcribe routes)
RUN cd /build/whisper.cpp/models \
    && chmod +x download-ggml-model.sh \
    && ./download-ggml-model.sh base.en .

# ========== Stage 2: Build Node app ==========
FROM node:18-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma/
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src/
RUN npm run build

# ========== Stage 3: Production image (Node + Whisper + Ollama) ==========
FROM node:18-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV OLLAMA_HOST=127.0.0.1
ENV OLLAMA_ORIGINS=*

# Install Ollama (single binary; runs as ollama serve)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && curl -fsSL https://ollama.com/download/ollama-linux-amd64.tgz | tar xz -C /usr/local/bin \
    && chmod +x /usr/local/bin/ollama \
    && rm -rf /var/lib/apt/lists/*

# Copy whisper-cli and model from whisper-builder
RUN mkdir -p /app/whisper.cpp/build/bin /app/whisper.cpp/models
COPY --from=whisper-builder /build/whisper.cpp/build/bin/whisper-cli /app/whisper.cpp/build/bin/whisper-cli
COPY --from=whisper-builder /build/whisper.cpp/models/ggml-base.en.bin /app/whisper.cpp/models/ggml-base.en.bin

# Node app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install prisma@5.17.0 --no-save

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma/
COPY --from=builder /app/dist ./dist

COPY docker-entry.sh /app/docker-entry.sh
RUN chmod +x /app/docker-entry.sh

EXPOSE 4000

CMD ["/app/docker-entry.sh"]
