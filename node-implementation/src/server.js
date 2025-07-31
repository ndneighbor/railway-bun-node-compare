const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const { WebSocketServer } = require('ws');
const http = require('http');

// Import routes and middleware
const booksRouter = require('./routes/books');
const authorsRouter = require('./routes/authors');
const ordersRouter = require('./routes/orders');
const searchRouter = require('./routes/search');
const performanceRouter = require('./routes/performance');
const systemRouter = require('./routes/system');
const performanceMonitor = require('./middleware/performance-monitor');
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');
const { runMigrations } = require('./database/migrations');
const { seedDatabase } = require('./database/seeds');
const db = require('./database/connection');

const app = express();
const PORT = process.env.PORT || 3000;

// Create HTTP server for WebSocket support
const server = http.createServer(app);

// Initialize WebSocket server for real-time metrics
const wss = new WebSocketServer({ server, path: '/ws/metrics' });

// Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Performance monitoring middleware
app.use(performanceMonitor.middleware());

// Serve static files
app.use('/static', express.static(path.join(__dirname, 'public')));

// Health check endpoint (required for Railway)
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        runtime: process.env.RUNTIME_NAME || 'node',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.version
    });
});

// API routes
app.use('/api/books', booksRouter);
app.use('/api/authors', authorsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/search', searchRouter);
app.use('/api/performance', performanceRouter);
app.use('/api/system', systemRouter);

// Root route with basic info
app.get('/', (req, res) => {
    res.json({
        name: 'Bookstore API - Node.js Implementation',
        runtime: process.env.RUNTIME_NAME || 'node',
        version: '1.0.0',
        endpoints: {
            health: '/api/health',
            books: '/api/books',
            authors: '/api/authors',
            orders: '/api/orders',
            search: '/api/search',
            performance: '/api/performance',
            websocket: '/ws/metrics'
        },
        documentation: 'Visit /api-docs for detailed API documentation'
    });
});

// API documentation endpoint
app.get('/api-docs', (req, res) => {
    res.json({
        title: 'Bookstore API Documentation',
        version: '1.0.0',
        runtime: process.env.RUNTIME_NAME || 'node',
        endpoints: {
            books: {
                'GET /api/books': 'List books with pagination (?page=1&limit=20&genre=&author=)',
                'POST /api/books': 'Create new book (admin)',
                'GET /api/books/:id': 'Get book details',
                'PUT /api/books/:id': 'Update book (admin)',
                'DELETE /api/books/:id': 'Delete book (admin)'
            },
            authors: {
                'GET /api/authors': 'List authors',
                'POST /api/authors': 'Create author (admin)',
                'GET /api/authors/:id': 'Get author with their books'
            },
            search: {
                'GET /api/search': 'Search books (?q=term&genre=&author=&minPrice=&maxPrice=)',
                'GET /api/search/suggestions': 'Get search suggestions',
                'GET /api/search/popular': 'Get popular search terms'
            },
            orders: {
                'POST /api/orders': 'Create new order',
                'GET /api/orders/:id': 'Get order details',
                'GET /api/orders': 'List orders (admin)',
                'PUT /api/orders/:id/status': 'Update order status (admin)'
            },
            performance: {
                'GET /api/performance/metrics': 'Get current runtime metrics',
                'POST /api/performance/benchmark': 'Trigger load test scenarios',
                'GET /api/performance/history': 'Get historical performance data',
                'GET /api/performance/compare': 'Compare with other runtime',
                'GET /api/performance/endpoints': 'Get endpoint performance stats'
            }
        }
    });
});

// WebSocket handling for real-time metrics
wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    
    // Send initial metrics
    performanceMonitor.getCurrentStats().then(stats => {
        ws.send(JSON.stringify({ type: 'initial', data: stats }));
    });

    // Send periodic updates
    const interval = setInterval(async () => {
        if (ws.readyState === ws.OPEN) {
            try {
                const stats = await performanceMonitor.getCurrentStats();
                ws.send(JSON.stringify({ type: 'update', data: stats }));
            } catch (error) {
                console.error('Error sending WebSocket update:', error);
            }
        }
    }, 5000); // Update every 5 seconds

    ws.on('close', () => {
        console.log('WebSocket client disconnected');
        clearInterval(interval);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clearInterval(interval);
    });
});

// Error handling middleware (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('HTTP server closed');
        db.close().then(() => {
            console.log('Database connection closed');
            process.exit(0);
        });
    });
});

// Initialize database and start server
async function startServer() {
    try {
        console.log('🚀 Starting Node.js Bookstore Server...');
        
        // Run migrations
        if (process.env.NODE_ENV !== 'test') {
            await runMigrations();
            
            // Seed database if no books exist
            const booksCount = await db.query('SELECT COUNT(*) FROM books');
            if (parseInt(booksCount.rows[0].count) === 0) {
                console.log('No books found, seeding database...');
                await seedDatabase();
            }
        }

        server.listen(PORT, '0.0.0.0', () => {
            console.log(`✅ Server running on port ${PORT}`);
            console.log(`📊 Runtime: ${process.env.RUNTIME_NAME || 'node'}`);
            console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
            console.log(`📖 API docs: http://localhost:${PORT}/api-docs`);
            console.log(`⚡ WebSocket: ws://localhost:${PORT}/ws/metrics`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

module.exports = { app, server };