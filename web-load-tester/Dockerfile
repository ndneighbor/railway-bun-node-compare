FROM node:20-alpine

WORKDIR /app

# Install oha for high-performance load testing
RUN apk add --no-cache curl && \
    curl -L https://github.com/hatoo/oha/releases/latest/download/oha-linux-musl-x86_64 -o /usr/local/bin/oha && \
    chmod +x /usr/local/bin/oha && \
    /usr/local/bin/oha --version

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production

# Copy application code
COPY . .

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodeuser -u 1001
USER nodeuser

# Expose port
EXPOSE $PORT

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); http.get('http://localhost:' + process.env.PORT + '/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

# Start application
CMD ["npm", "start"]