FROM ubuntu:22.04

WORKDIR /app

# Install curl, bash, and unzip for Bun installation
RUN apt-get update && apt-get install -y curl bash unzip && rm -rf /var/lib/apt/lists/*

# Install Bun using the official install script (includes SIMD optimizations)
RUN curl https://bun.sh/install | bash

# Add Bun to PATH
ENV PATH="/root/.bun/bin:$PATH"

# Copy package files
COPY package*.json ./

# Install dependencies
RUN bun install --production

# Copy application code
COPY . .

# Create non-root user for security
RUN groupadd -g 1001 bunjs
RUN useradd -m -u 1001 -g bunjs bunuser

# Copy Bun to user directory and set permissions
RUN cp -r /root/.bun /home/bunuser/.bun && chown -R bunuser:bunjs /home/bunuser/.bun

USER bunuser
ENV PATH="/home/bunuser/.bun/bin:$PATH"

# Expose port
EXPOSE $PORT

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "const res = await fetch('http://localhost:' + process.env.PORT + '/api/health'); process.exit(res.ok ? 0 : 1)"

# Start application
CMD ["bun", "run", "src/server.js"]