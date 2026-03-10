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
    python3

WORKDIR /app

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY src/ ./src/

# Persistent data volume
VOLUME ["/app/data"]

CMD ["node", "src/index.js"]
