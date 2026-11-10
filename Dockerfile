FROM oven/bun:latest AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Copy source
COPY . .

# Create required directories
RUN mkdir -p sessions media logs data

# Expose port
EXPOSE 3000

# Health check (respects PORT so a custom port does not report unhealthy)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f "http://localhost:${PORT:-3000}/status" || exit 1

CMD ["bun", "run", "dev"]
#CMD ["bun", "src/index.ts"]
