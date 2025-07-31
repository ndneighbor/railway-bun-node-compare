# OHA Streaming Service

A high-performance Rust service that provides real-time load testing capabilities with WebSocket streaming for the Node.js vs Bun comparison project.

## Features

- 🚀 **Real-time streaming**: WebSocket-based progress updates during load tests
- 📊 **Detailed metrics**: Latency histograms, RPS, error tracking
- 🔥 **High performance**: Built in Rust for minimal overhead
- 🎯 **Accurate testing**: Direct HTTP client implementation for precise control
- 📡 **REST API**: Simple HTTP endpoints for test management

## API Endpoints

### HTTP API

- `GET /` - Service information
- `GET /health` - Health check
- `POST /api/test/start` - Start a new load test
- `GET /api/test/status/:test_id` - Get test status
- `POST /api/test/stop/:test_id` - Stop a running test

### WebSocket API

- `GET /ws` - WebSocket connection for real-time updates

## Request/Response Format

### Start Test Request
```json
{
  "node_url": "https://node-server.railway.app/api/books",
  "bun_url": "https://bun-server.railway.app/api/books", 
  "duration_seconds": 60,
  "connections": 50,
  "rate_per_second": 100
}
```

### WebSocket Messages

#### Progress Update
```json
{
  "type": "Progress",
  "test_id": "uuid",
  "runtime": "node|bun",
  "requests_sent": 1000,
  "responses_received": 995,
  "errors": 5,
  "current_rps": 16.7,
  "avg_latency_ms": 45.2,
  "p95_latency_ms": 89.1,
  "elapsed_seconds": 30.5,
  "progress_percent": 50.8,
  "timestamp": "2024-01-01T12:00:00Z"
}
```

#### Test Completed
```json
{
  "type": "TestCompleted",
  "test_id": "uuid",
  "runtime": "node",
  "results": {
    "runtime": "node",
    "total_requests": 6000,
    "successful_requests": 5950,
    "failed_requests": 50,
    "total_duration_seconds": 60.1,
    "requests_per_second": 99.8,
    "avg_latency_ms": 45.2,
    "min_latency_ms": 12.1,
    "max_latency_ms": 234.5,
    "p50_latency_ms": 42.3,
    "p95_latency_ms": 89.1,
    "p99_latency_ms": 156.7,
    "error_types": {
      "Timeout": 30,
      "HTTP_500": 20
    }
  },
  "timestamp": "2024-01-01T12:01:00Z"
}
```

## Development

### Prerequisites
- Rust 1.75+
- Docker (for deployment)

### Running Locally
```bash
cd oha-streaming-service
cargo run
```

### Building for Production
```bash
cargo build --release
```

### Testing
```bash
cargo test
```

## Deployment

This service is designed to be deployed on Railway using the provided Dockerfile and railway.toml configuration.

## Environment Variables

- `PORT` - Server port (default: 3030)
- `RUST_LOG` - Log level (default: info)

## Architecture

The service uses:
- **Axum** - Fast, ergonomic web framework
- **Tokio** - Async runtime for high concurrency
- **Reqwest** - HTTP client for making load test requests
- **HDRHistogram** - Accurate latency percentile calculations
- **WebSockets** - Real-time streaming to clients

This replaces the previous approach of trying to parse oha's output by implementing the load testing logic directly in Rust, giving us complete control over metrics collection and real-time streaming.