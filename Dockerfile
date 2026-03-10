FROM node:20-alpine

# Canvas native dependencies
RUN apk add --no-cache \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    build-base \
    g++ \
    make \
    python3 \
    ffmpeg \
    curl

# Install yt-dlp binary (most reliable YouTube streaming, continuously updated)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp

WORKDIR /app

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY src/ ./src/
COPY webui/ ./webui/

# Persistent data volume
VOLUME ["/app/data"]

EXPOSE 3000

CMD ["node", "src/index.js"]
