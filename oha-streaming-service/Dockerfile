# Build stage
FROM rust:1.83-slim as builder

# Install system dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy dependency files
COPY Cargo.toml Cargo.lock ./

# Copy source code
COPY src ./src

# Build the application
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

# Create app user
RUN useradd -m -u 1001 app

# Copy the binary from builder stage
COPY --from=builder /app/target/release/oha-streaming-service /usr/local/bin/oha-streaming-service

# Change ownership to app user
RUN chown app:app /usr/local/bin/oha-streaming-service

# Switch to app user
USER app

# Expose port
EXPOSE 3030

# Set environment variables
ENV RUST_LOG=info

# Run the application
CMD ["oha-streaming-service"]