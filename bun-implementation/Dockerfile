FROM oven/bun:1.2.19-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN bun install --production

# Copy application code
COPY . .

# Create non-root user for security
RUN addgroup -g 1001 -S bunjs
RUN adduser -S bunuser -u 1001
USER bunuser

# Expose port
EXPOSE $PORT

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "const res = await fetch('http://localhost:' + process.env.PORT + '/api/health'); process.exit(res.ok ? 0 : 1)"

# Start application
CMD ["bun", "run", "src/server.js"]