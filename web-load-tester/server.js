import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import fetch from 'node-fetch';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 4000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Store active test sessions
const activeSessions = new Map();

// WebSocket connections
const wsConnections = new Set();

// Load test configuration
const testConfigurations = {
    light: {
        name: 'Light Load',
        users: 10,
        duration: 60,
        rampUp: 5,
        endpoints: [
            '/api/health',
            '/api/books',
            '/api/authors'
        ]
    },
    medium: {
        name: 'Medium Load', 
        users: 50,
        duration: 120,
        rampUp: 10,
        endpoints: [
            '/api/books',
            '/api/authors',
            '/api/search?q=test',
            '/api/books/1'
        ]
    },
    heavy: {
        name: 'Heavy Load',
        users: 100,
        duration: 180,
        rampUp: 15,
        endpoints: [
            '/api/books',
            '/api/authors', 
            '/api/search?q=test',
            '/api/books/1',
            '/api/authors/1',
            '/api/orders'
        ]
    },
    extreme: {
        name: 'Extreme Load',
        users: 200,
        duration: 300,
        rampUp: 20,
        endpoints: [
            '/api/books?page=1&limit=50',
            '/api/search?q=fiction&genre=mystery',
            '/api/authors',
            '/api/books/1',
            '/api/performance/metrics'
        ]
    },
    massive: {
        name: 'Massive Load (2000 users)',
        users: 2000,
        duration: 600,
        rampUp: 60,
        endpoints: [
            '/api/books',
            '/api/authors',
            '/api/search?q=bestseller',
            '/api/books/1',
            '/api/orders'
        ]
    }
};

// WebSocket handler
wss.on('connection', (ws) => {
    wsConnections.add(ws);
    console.log('Client connected');

    ws.on('close', () => {
        wsConnections.delete(ws);
        console.log('Client disconnected');
    });
});

// Broadcast to all connected clients
function broadcast(data) {
    const message = JSON.stringify(data);
    for (const ws of wsConnections) {
        if (ws.readyState === ws.OPEN) {
            ws.send(message);
        }
    }
}

// Main route - serve the web interface
app.get('/', (req, res) => {
    try {
        const html = readFileSync(join(__dirname, 'public', 'index.html'), 'utf8');
        res.send(html);
    } catch (error) {
        res.status(500).send('Error loading interface');
    }
});

// Get available test configurations
app.get('/api/configurations', (req, res) => {
    res.json(testConfigurations);
});

// Get active sessions
app.get('/api/sessions', (req, res) => {
    const sessions = Array.from(activeSessions.entries()).map(([id, session]) => ({
        id,
        ...session
    }));
    res.json(sessions);
});

// Start a load test
app.post('/api/test/start', async (req, res) => {
    try {
        const { nodeUrl, bunUrl, configName, customConfig } = req.body;

        if (!nodeUrl || !bunUrl) {
            return res.status(400).json({ error: 'Both Node.js and Bun URLs are required' });
        }

        // Get configuration
        const config = customConfig || testConfigurations[configName];
        if (!config) {
            return res.status(400).json({ error: 'Invalid configuration' });
        }

        // Generate session ID
        const sessionId = `comparison_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create comparison session
        const session = {
            id: sessionId,
            nodeUrl,
            bunUrl,
            config,
            startTime: new Date(),
            status: 'running',
            progress: 0,
            results: {
                node: {
                    runtime: 'node',
                    requests: 0,
                    responses: 0,
                    errors: 0,
                    totalTime: 0,
                    responseTimes: [],
                    errorTypes: {}
                },
                bun: {
                    runtime: 'bun',
                    requests: 0,
                    responses: 0,
                    errors: 0,
                    totalTime: 0,
                    responseTimes: [],
                    errorTypes: {}
                }
            },
            comparison: {
                winner: null,
                nodeAdvantage: 0,
                bunAdvantage: 0,
                metrics: {}
            }
        };

        activeSessions.set(sessionId, session);

        // Start parallel load tests for both runtimes
        runComparisonTest(sessionId, nodeUrl, bunUrl, config);

        res.json({ sessionId, message: 'Comparison test started' });

    } catch (error) {
        console.error('Error starting test:', error);
        res.status(500).json({ error: error.message });
    }
});

// Stop a load test
app.post('/api/test/stop/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = activeSessions.get(sessionId);

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    session.status = 'stopped';
    session.endTime = new Date();

    broadcast({
        type: 'sessionStopped',
        sessionId,
        session
    });

    res.json({ message: 'Test stopped' });
});

// Get session results
app.get('/api/test/results/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = activeSessions.get(sessionId);

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    res.json(session);
});

// Comparison test runner
async function runComparisonTest(sessionId, nodeUrl, bunUrl, config) {
    const session = activeSessions.get(sessionId);
    if (!session) return;

    const { users, duration, rampUp, endpoints } = config;
    const startTime = Date.now();
    const endTime = startTime + (duration * 1000);
    const rampUpInterval = (rampUp * 1000) / users;
    const usersPerRuntime = Math.floor(users / 2);

    console.log(`Starting comparison test ${sessionId}: ${users} users (${usersPerRuntime} each), ${duration}s duration`);

    // Function to make a request to a specific runtime
    async function makeRequest(runtime, baseUrl, endpoint) {
        const url = baseUrl + endpoint;
        const requestStart = Date.now();

        try {
            const response = await fetch(url, {
                method: 'GET',
                timeout: 10000,
                headers: {
                    'User-Agent': `BookstoreLoadTester/1.0-${runtime}`,
                    'Accept': 'application/json'
                }
            });

            const responseTime = Date.now() - requestStart;
            const results = session.results[runtime];
            
            results.requests++;
            results.responses++;
            results.totalTime += responseTime;
            results.responseTimes.push(responseTime);

            // Keep only last 100 response times for memory efficiency
            if (results.responseTimes.length > 100) {
                results.responseTimes.shift();
            }

            return { success: true, responseTime, status: response.status };

        } catch (error) {
            const responseTime = Date.now() - requestStart;
            const results = session.results[runtime];
            
            results.requests++;
            results.errors++;
            
            const errorType = error.code || error.name || 'Unknown';
            results.errorTypes[errorType] = (results.errorTypes[errorType] || 0) + 1;

            return { success: false, responseTime, error: errorType };
        }
    }

    // Function to simulate a user for a specific runtime
    async function simulateUser(runtime, baseUrl, userId) {
        while (Date.now() < endTime && session.status === 'running') {
            // Pick random endpoint
            const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
            
            await makeRequest(runtime, baseUrl, endpoint);
            
            // Random delay between requests (100ms to 2s)
            const delay = Math.random() * 1900 + 100;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // Start users with ramp-up for both runtimes
    const userPromises = [];
    
    // Node.js users
    for (let i = 0; i < usersPerRuntime; i++) {
        setTimeout(() => {
            if (session.status === 'running') {
                userPromises.push(simulateUser('node', nodeUrl, `node_${i}`));
            }
        }, i * rampUpInterval);
    }
    
    // Bun users
    for (let i = 0; i < usersPerRuntime; i++) {
        setTimeout(() => {
            if (session.status === 'running') {
                userPromises.push(simulateUser('bun', bunUrl, `bun_${i}`));
            }
        }, i * rampUpInterval);
    }

    // Monitor progress and calculate comparison
    const progressInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min((elapsed / (duration * 1000)) * 100, 100);
        session.progress = progress;

        // Calculate stats for both runtimes
        const nodeResults = session.results.node;
        const bunResults = session.results.bun;

        const nodeAvgResponseTime = nodeResults.totalTime / Math.max(nodeResults.responses, 1);
        const bunAvgResponseTime = bunResults.totalTime / Math.max(bunResults.responses, 1);
        
        const nodeErrorRate = (nodeResults.errors / Math.max(nodeResults.requests, 1)) * 100;
        const bunErrorRate = (bunResults.errors / Math.max(bunResults.requests, 1)) * 100;
        
        const nodeRps = nodeResults.responses / Math.max(elapsed / 1000, 1);
        const bunRps = bunResults.responses / Math.max(elapsed / 1000, 1);

        // Determine current leader
        let currentWinner = 'tie';
        if (nodeAvgResponseTime < bunAvgResponseTime && nodeErrorRate <= bunErrorRate) {
            currentWinner = 'node';
        } else if (bunAvgResponseTime < nodeAvgResponseTime && bunErrorRate <= nodeErrorRate) {
            currentWinner = 'bun';
        } else if (nodeRps > bunRps) {
            currentWinner = 'node';
        } else if (bunRps > nodeRps) {
            currentWinner = 'bun';
        }

        broadcast({
            type: 'progress',
            sessionId,
            progress,
            comparison: {
                node: {
                    requests: nodeResults.requests,
                    responses: nodeResults.responses,
                    errors: nodeResults.errors,
                    avgResponseTime: Math.round(nodeAvgResponseTime),
                    errorRate: Math.round(nodeErrorRate * 100) / 100,
                    rps: Math.round(nodeRps * 100) / 100
                },
                bun: {
                    requests: bunResults.requests,
                    responses: bunResults.responses,
                    errors: bunResults.errors,
                    avgResponseTime: Math.round(bunAvgResponseTime),
                    errorRate: Math.round(bunErrorRate * 100) / 100,
                    rps: Math.round(bunRps * 100) / 100
                },
                winner: currentWinner,
                elapsed: Math.round(elapsed / 1000)
            }
        });

        if (progress >= 100 || session.status !== 'running') {
            clearInterval(progressInterval);
        }
    }, 1000);

    // Wait for test completion
    setTimeout(() => {
        session.status = 'completed';
        session.endTime = new Date();
        
        const actualDuration = (session.endTime - session.startTime) / 1000;

        // Calculate final statistics for both runtimes
        function calculateStats(results) {
            const totalRequests = results.requests;
            const totalResponses = results.responses;
            const totalErrors = results.errors;
            const avgResponseTime = results.totalTime / Math.max(totalResponses, 1);
            const errorRate = (totalErrors / Math.max(totalRequests, 1)) * 100;
            const rps = totalResponses / actualDuration;

            // Calculate percentiles
            const sortedTimes = results.responseTimes.sort((a, b) => a - b);
            const p50 = sortedTimes[Math.floor(sortedTimes.length * 0.5)] || 0;
            const p95 = sortedTimes[Math.floor(sortedTimes.length * 0.95)] || 0;
            const p99 = sortedTimes[Math.floor(sortedTimes.length * 0.99)] || 0;

            return {
                totalRequests,
                totalResponses,
                totalErrors,
                avgResponseTime: Math.round(avgResponseTime),
                errorRate: Math.round(errorRate * 100) / 100,
                rps: Math.round(rps * 100) / 100,
                percentiles: { p50, p95, p99 },
                errorTypes: results.errorTypes
            };
        }

        const nodeStats = calculateStats(session.results.node);
        const bunStats = calculateStats(session.results.bun);

        // Determine overall winner with detailed comparison
        let winner = 'tie';
        let nodeAdvantages = [];
        let bunAdvantages = [];

        if (nodeStats.avgResponseTime < bunStats.avgResponseTime) {
            nodeAdvantages.push('faster_response_time');
        } else if (bunStats.avgResponseTime < nodeStats.avgResponseTime) {
            bunAdvantages.push('faster_response_time');
        }

        if (nodeStats.rps > bunStats.rps) {
            nodeAdvantages.push('higher_throughput');
        } else if (bunStats.rps > nodeStats.rps) {
            bunAdvantages.push('higher_throughput');
        }

        if (nodeStats.errorRate < bunStats.errorRate) {
            nodeAdvantages.push('lower_error_rate');
        } else if (bunStats.errorRate < nodeStats.errorRate) {
            bunAdvantages.push('lower_error_rate');
        }

        if (nodeStats.percentiles.p95 < bunStats.percentiles.p95) {
            nodeAdvantages.push('better_p95_latency');
        } else if (bunStats.percentiles.p95 < nodeStats.percentiles.p95) {
            bunAdvantages.push('better_p95_latency');
        }

        // Determine winner based on advantages
        if (nodeAdvantages.length > bunAdvantages.length) {
            winner = 'node';
        } else if (bunAdvantages.length > nodeAdvantages.length) {
            winner = 'bun';
        }

        session.comparison = {
            winner,
            nodeAdvantages,
            bunAdvantages,
            performanceGap: {
                responseTime: Math.abs(nodeStats.avgResponseTime - bunStats.avgResponseTime),
                throughput: Math.abs(nodeStats.rps - bunStats.rps),
                errorRate: Math.abs(nodeStats.errorRate - bunStats.errorRate)
            }
        };

        session.finalStats = {
            duration: Math.round(actualDuration),
            node: nodeStats,
            bun: bunStats
        };

        broadcast({
            type: 'completed',
            sessionId,
            session,
            comparison: session.comparison,
            stats: session.finalStats
        });

        console.log(`Comparison test ${sessionId} completed. Winner: ${winner}`);
        console.log('Node.js stats:', nodeStats);
        console.log('Bun stats:', bunStats);
    }, duration * 1000);
}

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        activeSessions: activeSessions.size,
        connectedClients: wsConnections.size 
    });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Web Load Tester running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});