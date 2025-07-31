# Bookstore Performance Comparison Platform

A comprehensive performance comparison platform featuring **identical bookstore implementations** in Node.js and Bun, designed for deployment on Railway. This project enables real-world performance analysis between the two JavaScript runtimes.

## 🏗️ Project Structure

```
bookstore-comparison/
├── node-implementation/     # Node.js version (Express + PostgreSQL)
├── bun-implementation/      # Bun version (Native HTTP + PostgreSQL)
├── shared/                  # Common assets and configurations
│   ├── database/           # SQL schema and seed data
│   ├── components/         # React SSR components
│   └── public/            # CSS and static assets
├── benchmark-runner.js     # Cross-implementation testing tool
└── README.md              # This file
```

## 🚀 Quick Start

### Prerequisites
- Node.js 24+ (for development)
- Bun 1.2.19+ (for Bun implementation)
- PostgreSQL database (Railway managed recommended)
- Railway CLI (for deployment)

### 1. Clone and Setup

```bash
git clone <repository-url>
cd bookstore-comparison
```

### 2. Set Up Database

Create a PostgreSQL database on Railway:

```bash
railway add postgresql
```

### 3. Deploy Node.js Implementation

```bash
cd node-implementation
cp .env.example .env
# Edit .env with your DATABASE_URL and other settings

# Deploy to Railway (package-lock.json included for reproducible builds)
railway login
railway link  # Link to your Railway project
railway up    # Deploy Node version
```

### 4. Deploy Bun Implementation

```bash
cd ../bun-implementation
cp .env.example .env
# Edit .env with your DATABASE_URL and other settings

# Deploy to separate Railway project (bun.lockb will be generated during build)
railway login
railway link  # Link to a NEW Railway project
railway up    # Deploy Bun version
```

### 5. Run Performance Comparison

```bash
cd ..
node benchmark-runner.js --node-url https://your-node-service.railway.app --bun-url https://your-bun-service.railway.app
```

## 📊 Features

### Core Bookstore Functionality
- **Books Management**: Full CRUD operations with pagination and filtering
- **Authors Management**: Author profiles with their books
- **Search System**: Advanced search with suggestions and full-text search
- **Order Processing**: Shopping cart and order management
- **Real-time Performance Monitoring**: Live metrics via WebSocket

### Performance Analysis
- **Cross-runtime Comparison**: Side-by-side performance metrics
- **Historical Data**: Performance trends over time
- **Load Testing Integration**: Built-in benchmark scenarios
- **Memory Usage Tracking**: Real-time memory consumption
- **Response Time Analysis**: Detailed latency measurements

### Technical Features
- **Identical API Endpoints**: Exactly matching functionality across runtimes
- **Shared Database Schema**: Common PostgreSQL structure
- **React SSR Components**: Server-side rendered interfaces
- **WebSocket Support**: Real-time performance updates
- **Railway Health Checks**: Built-in monitoring endpoints

## 🛠️ API Documentation

### Books Endpoints
- `GET /api/books` - List books with pagination and filtering
- `POST /api/books` - Create new book (admin)
- `GET /api/books/:id` - Get book details
- `PUT /api/books/:id` - Update book (admin)
- `DELETE /api/books/:id` - Delete book (admin)

### Authors Endpoints
- `GET /api/authors` - List authors with book counts
- `POST /api/authors` - Create author (admin)
- `GET /api/authors/:id` - Get author with their books

### Search Endpoints
- `GET /api/search` - Search books with filters
- `GET /api/search/suggestions` - Get search suggestions
- `GET /api/search/popular` - Get popular search terms

### Orders Endpoints
- `POST /api/orders` - Create new order
- `GET /api/orders/:id` - Get order details
- `GET /api/orders` - List orders (admin)
- `PUT /api/orders/:id/status` - Update order status

### Performance Endpoints
- `GET /api/performance/metrics` - Current runtime metrics
- `POST /api/performance/benchmark` - Trigger load test
- `GET /api/performance/history` - Historical performance data
- `GET /api/performance/compare` - Cross-runtime comparison
- `GET /api/performance/endpoints` - Per-endpoint statistics

### System Endpoints
- `GET /api/health` - Health check (required for Railway)
- `GET /api-docs` - API documentation
- `WS /ws/metrics` - Real-time performance WebSocket

## 🔬 Performance Monitoring

### Real-time Metrics Collection
Both implementations automatically collect:
- Response times for all endpoints
- Memory usage per request
- Request throughput
- Error rates
- Database query performance

### Cross-Service Comparison
Each service can query the other's metrics for real-time comparison:
- Average response times
- Memory consumption patterns
- Throughput differences
- Performance improvement percentages

### Load Testing Scenarios
Built-in benchmark scenarios:
- **Startup**: Cold start performance measurement
- **Light**: 10 concurrent users for 60 seconds
- **Medium**: 50 concurrent users for 120 seconds
- **Heavy**: 100 concurrent users for 180 seconds
- **Database**: Complex queries with joins
- **Mixed**: Combined read/write operations

## 🚀 Railway Deployment

### Environment Variables

Both implementations require these environment variables:

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:port/database

# Application
PORT=3000
NODE_ENV=production
JWT_SECRET=your-jwt-secret-key

# Performance Monitoring
BENCHMARK_ENABLED=true
RUNTIME_NAME=node  # or "bun" for bun implementation
COMPARISON_SERVICE_URL=https://other-service.railway.app

# Railway (set automatically)
RAILWAY_STATIC_URL=
RAILWAY_PUBLIC_DOMAIN=
```

### Deployment Commands

Deploy Node.js implementation:
```bash
cd node-implementation
railway up
```

Deploy Bun implementation:
```bash
cd bun-implementation
railway up
```

### Health Checks
Both services include comprehensive health checks:
- HTTP endpoint: `GET /api/health`
- Docker health checks with automatic retries
- Performance metrics validation

## 🏁 Running Benchmarks

### Local Development
```bash
# Start Node.js service (terminal 1)
cd node-implementation
npm install
npm run dev

# Start Bun service (terminal 2)
cd bun-implementation
bun install
bun run dev

# Run benchmarks (terminal 3)
node benchmark-runner.js
```

### Production Comparison
```bash
node benchmark-runner.js \
  --node-url https://node-bookstore.railway.app \
  --bun-url https://bun-bookstore.railway.app
```

### Benchmark Output
The benchmark runner provides:
- Detailed performance metrics per endpoint
- Response time percentiles (P50, P95, P99)
- Throughput comparison (requests per second)
- Memory usage analysis
- Winner determination with improvement percentages
- JSON export for further analysis

Example output:
```
🏆 Overall Results:
Node.js wins: 3/6 scenarios
Bun wins: 3/6 scenarios

📊 Detailed Results:

HEALTH_CHECK:
  Node.js: 12.45ms avg, 45.2 req/s
  Bun:     8.32ms avg, 67.8 req/s
  Winner:  BUN (33.2% faster)
```

## 🔧 Development

### Database Migrations
Run database migrations:
```bash
# Node.js implementation
cd node-implementation
npm run migrate
npm run seed

# Bun implementation
cd bun-implementation
bun run migrate
bun run seed
```

### Adding New Endpoints
1. Add route handler to both implementations
2. Update API documentation in README
3. Add benchmark scenario to `benchmark-runner.js`
4. Test cross-runtime compatibility

### Performance Monitoring Setup
Both implementations include:
- Automatic metrics collection middleware
- WebSocket for real-time updates
- Database storage of performance data
- Cross-service comparison endpoints

## 📈 Performance Analysis

### Key Metrics Tracked
- **Response Time**: Average, min, max, and percentiles
- **Memory Usage**: Heap usage per request
- **Throughput**: Requests per second
- **Error Rate**: Failed requests percentage
- **Database Performance**: Query execution times

### Comparison Features
- Real-time performance dashboard
- Historical performance trends
- Cross-runtime benchmark results
- Memory usage patterns
- Load testing scenarios

### Expected Results
Based on runtime characteristics:
- **Bun**: Generally faster startup and lower memory usage
- **Node.js**: More consistent performance under sustained load
- **Database Operations**: Similar performance due to shared PostgreSQL
- **Static Content**: Bun typically serves faster
- **Complex Logic**: Performance varies by implementation

## 🐛 Troubleshooting

### Common Issues

**Database Connection Failed**
```bash
# Check DATABASE_URL format
# Ensure PostgreSQL service is running
# Verify Railway database credentials
```

**Service Not Responding**
```bash
# Check Railway logs
railway logs

# Verify health endpoint
curl https://your-service.railway.app/api/health
```

**Benchmark Runner Errors**
```bash
# Ensure both services are accessible
# Check CORS settings for cross-origin requests
# Verify API endpoints are responding
```

**WebSocket Connection Issues**
```bash
# Check firewall settings
# Ensure WebSocket upgrade is working
# Verify /ws/metrics endpoint
```

### Development Tips
1. Use Railway logs for debugging deployment issues
2. Test endpoints individually before running full benchmarks
3. Monitor database connection limits during load testing
4. Use Railway's built-in metrics for additional insights

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Ensure both implementations have identical functionality
4. Add benchmark scenarios for new features
5. Update documentation
6. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🔗 Links

- [Railway Documentation](https://docs.railway.app)
- [Node.js Documentation](https://nodejs.org/docs)
- [Bun Documentation](https://bun.sh/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs)

---

**Built for Railway** 🚂 - Deploy both implementations with `railway up` and start comparing performance immediately!