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

// Define routes using Bun's native routing
const routes = {
    // Health and system routes
    "GET /api/health": () => Response.json({
        status: 'healthy',
        runtime: process.env.RUNTIME_NAME || 'bun',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.version,
        bunVersion: Bun?.version || null,
        bunRevision: Bun?.revision || null,
        usingBunServe: !!Bun?.serve,
        actualRuntime: typeof Bun !== 'undefined' ? 'bun' : 'node'
    }),

    "GET /": () => Response.json({
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
            system: '/api/system',
            websocket: '/ws/metrics'
        },
        documentation: 'Visit /api-docs for detailed API documentation'
    }),

    "GET /api-docs": () => Response.json({
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
            },
            system: {
                'GET /api/system/metrics': 'Get detailed system metrics',
                'POST /api/system/stress-test': 'Run CPU intensive test',
                'POST /api/system/heap-dump': 'Analyze memory usage'
            }
        }
    }),

    // Books routes
    "GET /api/books": (request) => booksHandler.list(request),
    "POST /api/books": (request) => booksHandler.create(request),
    "GET /api/books/:id": (request, { id }) => booksHandler.getById(request, id),
    "PUT /api/books/:id": (request, { id }) => booksHandler.update(request, id),
    "DELETE /api/books/:id": (request, { id }) => booksHandler.delete(request, id),

    // Authors routes
    "GET /api/authors": (request) => authorsHandler.list(request),
    "POST /api/authors": (request) => authorsHandler.create(request),
    "GET /api/authors/:id": (request, { id }) => authorsHandler.getById(request, id),
    "PUT /api/authors/:id": (request, { id }) => authorsHandler.update(request, id),
    "DELETE /api/authors/:id": (request, { id }) => authorsHandler.delete(request, id),

    // Orders routes
    "POST /api/orders": (request) => ordersHandler.create(request),
    "GET /api/orders": (request) => ordersHandler.list(request),
    "GET /api/orders/:id": (request, { id }) => ordersHandler.getById(request, id),
    "PUT /api/orders/:id/status": (request, { id }) => ordersHandler.updateStatus(request, id),

    // Search routes
    "GET /api/search": (request) => searchHandler.search(request),
    "GET /api/search/suggestions": (request) => searchHandler.suggestions(request),
    "GET /api/search/popular": (request) => searchHandler.popular(request),

    // Performance routes
    "GET /api/performance/metrics": (request) => performanceHandler.getMetrics(request),
    "GET /api/performance/history": (request) => performanceHandler.getHistory(request),
    "GET /api/performance/compare": (request) => performanceHandler.compare(request),
    "POST /api/performance/benchmark": (request) => performanceHandler.benchmark(request),
    "GET /api/performance/endpoints": (request) => performanceHandler.getEndpoints(request),

    // System routes
    "GET /api/system/metrics": (request) => systemHandler.getMetrics(request),
    "POST /api/system/stress-test": (request) => systemHandler.stressTest(request),
    "POST /api/system/heap-dump": (request) => systemHandler.heapDump(request),
};

// Route matcher function
function matchRoute(method, pathname) {
    // Try exact match first
    const exactKey = `${method} ${pathname}`;
    if (routes[exactKey]) {
        return { handler: routes[exactKey], params: {} };
    }

    // Try pattern matching for routes with parameters
    for (const [pattern, handler] of Object.entries(routes)) {
        const [routeMethod, routePath] = pattern.split(' ', 2);
        if (routeMethod !== method) continue;

        // Convert route pattern to regex
        const paramNames = [];
        const regexPattern = routePath.replace(/:([^\/]+)/g, (match, paramName) => {
            paramNames.push(paramName);
            return '([^/]+)';
        });

        const regex = new RegExp(`^${regexPattern}$`);
        const match = pathname.match(regex);

        if (match) {
            const params = {};
            paramNames.forEach((name, index) => {
                params[name] = match[index + 1];
            });
            return { handler, params };
        }
    }

    return null;
}

// Router function using native routing
function router(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    // Try to match route
    const route = matchRoute(method, pathname);
    
    if (route) {
        try {
            return route.handler(request, route.params);
        } catch (error) {
            console.error('Route handler error:', error);
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
    }

    // Static files (if needed)
    if (pathname.startsWith('/static/')) {
        try {
            const filePath = join(import.meta.dir, 'public', pathname.replace('/static/', ''));
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
            path: pathname,
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

        // Send periodic WebSocket updates
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
        }, 5000); // Update every 5 seconds

        console.log(`✅ Server running on port ${PORT}`);
        console.log(`📊 Runtime: ${process.env.RUNTIME_NAME || 'bun'}`);
        console.log(`🟡 Bun Version: ${Bun?.version || 'Not detected'}`);
        console.log(`🟡 Bun Revision: ${Bun?.revision || 'Not detected'}`);
        console.log(`🟡 Using Bun.serve: ${!!Bun?.serve}`);
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