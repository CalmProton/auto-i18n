FROM oven/bun:latest

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json bun.lock* ./

# Install all dependencies (including devDependencies for frontend build)
RUN bun install

# Copy application code
COPY . .

# Build the Vue client
RUN bun run client:build

# Remove devDependencies after build
RUN bun install --production

# Create tmp directory for runtime data
RUN mkdir -p /app/tmp/logs

# Set production environment
ENV NODE_ENV=production

# Default port (configurable via PORT env var)
EXPOSE 3000

CMD ["bun", "start"]
