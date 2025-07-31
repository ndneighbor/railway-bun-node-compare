import { readFileSync } from 'fs';
import { join } from 'path';

// Import route handlers
import booksHandler from './routes/books.js';
import authorsHandler from './routes/authors.js';
import ordersHandler from './routes/orders.js';
import searchHandler from './routes/search.js';
import performanceHandler from './routes/performance.js';
import systemHandler from './routes/system.js';
import performanceMonitor from './middleware/performance-monitor.js';
import { runMigrations } from './database/migrations.js';
import { seedDatabase } from './database/seeds.js';
import db from './database/connection.js';

const PORT = process.env.PORT || 3000;

// WebSocket connections for real-time metrics
const wsConnections = new Set();

// Router function
function router(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Health check endpoint (required for Railway)
    if (path === '/api/health' && method === 'GET') {
        return new Response(JSON.stringify({
            status: 'healthy',
            runtime: process.env.RUNTIME_NAME || 'bun',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            version: process.version
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Root route with basic info
    if (path === '/' && method === 'GET') {
        return new Response(JSON.stringify({
            name: 'Bookstore API - Bun Implementation',
            runtime: process.env.RUNTIME_NAME || 'bun',
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
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // API documentation endpoint
    if (path === '/api-docs' && method === 'GET') {
        return new Response(JSON.stringify({
            title: 'Bookstore API Documentation',
            version: '1.0.0',
            runtime: process.env.RUNTIME_NAME || 'bun',
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
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Books routes
    if (path === '/api/books' && method === 'GET') {
        return booksHandler.list(request);
    }
    if (path === '/api/books' && method === 'POST') {
        return booksHandler.create(request);
    }
    if (path.match(/^\/api\/books\/\d+$/) && method === 'GET') {
        const id = path.split('/').pop();
        return booksHandler.getById(request, id);
    }
    if (path.match(/^\/api\/books\/\d+$/) && method === 'PUT') {
        const id = path.split('/').pop();
        return booksHandler.update(request, id);
    }
    if (path.match(/^\/api\/books\/\d+$/) && method === 'DELETE') {
        const id = path.split('/').pop();
        return booksHandler.delete(request, id);
    }

    // Authors routes
    if (path === '/api/authors' && method === 'GET') {
        return authorsHandler.list(request);
    }
    if (path === '/api/authors' && method === 'POST') {
        return authorsHandler.create(request);
    }
    if (path.match(/^\/api\/authors\/\d+$/) && method === 'GET') {
        const id = path.split('/').pop();
        return authorsHandler.getById(request, id);
    }
    if (path.match(/^\/api\/authors\/\d+$/) && method === 'PUT') {
        const id = path.split('/').pop();
        return authorsHandler.update(request, id);
    }
    if (path.match(/^\/api\/authors\/\d+$/) && method === 'DELETE') {
        const id = path.split('/').pop();
        return authorsHandler.delete(request, id);
    }

    // Orders routes
    if (path === '/api/orders' && method === 'POST') {
        return ordersHandler.create(request);
    }
    if (path === '/api/orders' && method === 'GET') {
        return ordersHandler.list(request);
    }
    if (path.match(/^\/api\/orders\/\d+$/) && method === 'GET') {
        const id = path.split('/').pop();
        return ordersHandler.getById(request, id);
    }
    if (path.match(/^\/api\/orders\/\d+\/status$/) && method === 'PUT') {
        const id = path.split('/')[3];
        return ordersHandler.updateStatus(request, id);
    }

    // Search routes
    if (path === '/api/search' && method === 'GET') {
        return searchHandler.search(request);
    }
    if (path === '/api/search/suggestions' && method === 'GET') {
        return searchHandler.suggestions(request);
    }
    if (path === '/api/search/popular' && method === 'GET') {
        return searchHandler.popular(request);
    }

    // Performance routes
    if (path === '/api/performance/metrics' && method === 'GET') {
        return performanceHandler.getMetrics(request);
    }
    if (path === '/api/performance/history' && method === 'GET') {
        return performanceHandler.getHistory(request);
    }
    if (path === '/api/performance/compare' && method === 'GET') {
        return performanceHandler.compare(request);
    }
    if (path === '/api/performance/benchmark' && method === 'POST') {
        return performanceHandler.benchmark(request);
    }
    if (path === '/api/performance/endpoints' && method === 'GET') {
        return performanceHandler.getEndpoints(request);
    }

    // System routes
    if (path === '/api/system/metrics' && method === 'GET') {
        return systemHandler.getMetrics(request);
    }
    if (path === '/api/system/stress-test' && method === 'POST') {
        return systemHandler.stressTest(request);
    }
    if (path === '/api/system/heap-dump' && method === 'POST') {
        return systemHandler.heapDump(request);
    }

    // Static files (if needed)
    if (path.startsWith('/static/')) {
        try {
            const filePath = join(import.meta.dir, 'public', path.replace('/static/', ''));
            const file = readFileSync(filePath);
            return new Response(file);
        } catch {
            return new Response('Not Found', { status: 404 });
        }
    }

    // 404 for all other routes
    return new Response(JSON.stringify({
        error: {
            message: 'Not Found',
            status: 404,
            timestamp: new Date().toISOString(),
            path,
            method
        }
    }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
    });
}

// WebSocket upgrade handler
function upgradeWebSocket(request, server) {
    const url = new URL(request.url);
    
    if (url.pathname === '/ws/metrics') {
        if (server.upgrade(request)) {
            return; // Successfully upgraded
        }
    }
    
    return new Response('WebSocket upgrade failed', { status: 400 });
}

// Initialize database and start server
async function startServer() {
    try {
        console.log('🚀 Starting Bun Bookstore Server...');
        
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

        const server = Bun.serve({
            port: PORT,
            hostname: '0.0.0.0',
            
            async fetch(request, server) {
                // Handle WebSocket upgrade
                if (server.upgrade(request, {
                    data: { connectedAt: Date.now() }
                })) {
                    return; // Successfully upgraded to WebSocket
                }

                // Handle HTTP requests
                const startTime = Date.now();
                const startMemory = process.memoryUsage();

                try {
                    const response = await router(request);
                    
                    // Add performance metrics
                    const endTime = Date.now();
                    const endMemory = process.memoryUsage();
                    const responseTime = endTime - startTime;
                    const memoryUsage = (endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024;

                    // Store metrics asynchronously
                    setImmediate(async () => {
                        try {
                            await db.query(
                                'INSERT INTO performance_metrics (runtime, endpoint, response_time_ms, memory_usage_mb) VALUES ($1, $2, $3, $4)',
                                [process.env.RUNTIME_NAME || 'bun', new URL(request.url).pathname, responseTime, memoryUsage]
                            );
                        } catch (error) {
                            console.error('Failed to store performance metrics:', error);
                        }
                        
                        // Trigger GC if memory usage is high
                        if (endMemory.heapUsed > 100 * 1024 * 1024 && Bun?.gc) { // > 100MB
                            Bun.gc(false);
                        }
                    });

                    // Add performance headers
                    response.headers.set('X-Response-Time', `${responseTime}ms`);
                    response.headers.set('X-Memory-Usage', `${memoryUsage.toFixed(2)}MB`);
                    response.headers.set('X-Runtime', process.env.RUNTIME_NAME || 'bun');

                    return response;
                } catch (error) {
                    console.error('Request error:', error);
                    return new Response(JSON.stringify({
                        error: {
                            message: 'Internal Server Error',
                            status: 500,
                            timestamp: new Date().toISOString()
                        }
                    }), {
                        status: 500,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
            },

            websocket: {
                open(ws) {
                    wsConnections.add(ws);
                    console.log('WebSocket client connected');
                    
                    // Send initial metrics
                    performanceMonitor.getCurrentStats().then(stats => {
                        ws.send(JSON.stringify({ type: 'initial', data: stats }));
                    });
                },
                
                message(ws, message) {
                    // Handle incoming WebSocket messages if needed
                    console.log('WebSocket message received:', message);
                },
                
                close(ws) {
                    wsConnections.delete(ws);
                    console.log('WebSocket client disconnected');
                },
                
                error(ws, error) {
                    console.error('WebSocket error:', error);
                    wsConnections.delete(ws);
                }
            }
        });

        // Send periodic WebSocket updates with GC
        setInterval(async () => {
            if (wsConnections.size > 0) {
                try {
                    const stats = await performanceMonitor.getCurrentStats();
                    const message = JSON.stringify({ type: 'update', data: stats });
                    
                    for (const ws of wsConnections) {
                        try {
                            ws.send(message);
                        } catch (error) {
                            console.error('Error sending WebSocket update:', error);
                            wsConnections.delete(ws);
                        }
                    }
                } catch (error) {
                    console.error('Error getting performance stats:', error);
                }
            }
            
            // Force garbage collection every 30 seconds if available
            if (Bun?.gc) {
                Bun.gc(false); // Non-blocking GC
            }
        }, 5000); // Update every 5 seconds
        
        // More aggressive GC for high-load scenarios
        setInterval(() => {
            if (Bun?.gc) {
                Bun.gc(false); // Non-blocking garbage collection
            }
        }, 30000); // Every 30 seconds

        console.log(`✅ Server running on port ${PORT}`);
        console.log(`📊 Runtime: ${process.env.RUNTIME_NAME || 'bun'}`);
        console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
        console.log(`📖 API docs: http://localhost:${PORT}/api-docs`);
        console.log(`⚡ WebSocket: ws://localhost:${PORT}/ws/metrics`);
        
        return server;
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully');
    await db.close();
    console.log('Database connection closed');
    process.exit(0);
});

// Start the server
startServer();