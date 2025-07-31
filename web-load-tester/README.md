# 🚀 Web Load Tester for Bookstore Performance Comparison

A web-based load testing application that can be deployed to Railway to run performance tests from a different IP address. This solves rate limiting issues when running load tests from your local machine.

## Features

- **Web Interface**: Beautiful, responsive dashboard for configuring and monitoring load tests
- **Real-time Updates**: WebSocket-powered live progress tracking and metrics
- **Multiple Test Configurations**: Pre-configured test scenarios from light to massive (2000 users)
- **Detailed Results**: Response time percentiles, error analysis, and performance metrics
- **Export Functionality**: Download test results as JSON
- **Railway Ready**: Optimized for deployment on Railway with proper health checks

## Test Configurations

| Configuration | Users | Duration | Ramp-up | Description |
|---------------|-------|----------|---------|-------------|
| Light | 10 | 60s | 5s | Basic health checks and simple endpoints |
| Medium | 50 | 120s | 10s | Mixed API usage with search and details |
| Heavy | 100 | 180s | 15s | Comprehensive API testing |
| Extreme | 200 | 300s | 20s | High-load scenario with complex queries |
| Massive | 2000 | 600s | 60s | Maximum load test (10 minutes) |

## Quick Start

### Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm run dev
   ```

3. **Open your browser:**
   ```
   http://localhost:4000
   ```

### Railway Deployment

1. **Connect your GitHub repository to Railway**
2. **Deploy automatically** - Railway will detect the Dockerfile and deploy
3. **Access your load tester** at your Railway-provided URL

## Usage

1. **Enter Target URL**: Input the URL of the bookstore API you want to test
2. **Select Configuration**: Choose from pre-configured test scenarios
3. **Start Test**: Click "Start Load Test" and monitor progress in real-time
4. **View Results**: Analyze detailed performance metrics and export data

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 4000 | Server port |
| `NODE_ENV` | development | Environment mode |

## API Endpoints

- `GET /` - Web dashboard
- `GET /api/configurations` - Available test configurations
- `POST /api/test/start` - Start a load test
- `POST /api/test/stop/:sessionId` - Stop a running test
- `GET /api/test/results/:sessionId` - Get test results
- `GET /health` - Health check endpoint
- `WebSocket /` - Real-time updates

## Architecture

- **Backend**: Node.js with Express
- **Frontend**: Vanilla JavaScript with WebSocket
- **Real-time**: WebSocket for live progress updates
- **Load Testing**: Custom implementation with configurable scenarios
- **Deployment**: Docker container optimized for Railway

## Benefits of Web-based Testing

- **Avoid Rate Limits**: Run tests from Railway's infrastructure
- **Remote Access**: Access your load tester from anywhere
- **Team Collaboration**: Share test results with team members
- **Scalable**: Railway's infrastructure can handle high-concurrency tests
- **Real-time Monitoring**: Watch tests progress live with WebSocket updates

## Test Results

Each test provides comprehensive metrics:

- **Request/Response Counts**: Total and successful requests
- **Response Times**: Average, percentiles (50th, 95th, 99th)
- **Error Analysis**: Error types and frequencies
- **Throughput**: Requests per second
- **Success Rate**: Percentage of successful requests

## Deployment Notes

- Uses Node.js 20 Alpine for minimal image size
- Runs as non-root user for security
- Includes health checks for Railway monitoring
- Optimized for Railway's container environment

## Contributing

This load tester is designed specifically for the Node.js vs Bun bookstore performance comparison project. Modify the test configurations and endpoints as needed for your specific testing requirements.