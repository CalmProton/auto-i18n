# Use official Bun image
FROM oven/bun:1.3.0-alpine AS base

# Install dependencies for building native modules and curl for healthcheck
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    curl

WORKDIR /app

# Install dependencies (cached layer)
FROM base AS dependencies

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

# Copy dev dependencies for building frontend
FROM base AS build-deps
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

# Build frontend
FROM build-deps AS build
COPY . .
RUN bun run client:build

# Production image
FROM base AS production

# Copy dependencies from dependencies stage
COPY --from=dependencies /app/node_modules ./node_modules

# Copy built frontend from build stage
COPY --from=build /app/client/dist ./client/dist

# Copy application code
COPY . .

# Create tmp directory for runtime data
RUN mkdir -p /app/tmp/logs

# Expose ports
EXPOSE 3000 5173

# Set environment
ENV NODE_ENV=production

# Start the application
CMD ["bun", "run", "server/index.ts"]
