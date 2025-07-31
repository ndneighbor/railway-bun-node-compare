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
        const { targetUrl, configName, customConfig } = req.body;

        if (!targetUrl) {
            return res.status(400).json({ error: 'Target URL is required' });
        }

        // Get configuration
        const config = customConfig || testConfigurations[configName];
        if (!config) {
            return res.status(400).json({ error: 'Invalid configuration' });
        }

        // Generate session ID
        const sessionId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create session
        const session = {
            id: sessionId,
            targetUrl,
            config,
            startTime: new Date(),
            status: 'running',
            progress: 0,
            results: {
                requests: 0,
                responses: 0,
                errors: 0,
                totalTime: 0,
                responseTimes: [],
                errorTypes: {}
            }
        };

        activeSessions.set(sessionId, session);

        // Start the load test
        runLoadTest(sessionId, targetUrl, config);

        res.json({ sessionId, message: 'Load test started' });

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

// Load test runner
async function runLoadTest(sessionId, targetUrl, config) {
    const session = activeSessions.get(sessionId);
    if (!session) return;

    const { users, duration, rampUp, endpoints } = config;
    const startTime = Date.now();
    const endTime = startTime + (duration * 1000);
    const rampUpInterval = (rampUp * 1000) / users;

    console.log(`Starting load test ${sessionId}: ${users} users, ${duration}s duration`);

    // Function to make a request
    async function makeRequest(endpoint) {
        const url = targetUrl + endpoint;
        const requestStart = Date.now();

        try {
            const response = await fetch(url, {
                method: 'GET',
                timeout: 10000,
                headers: {
                    'User-Agent': 'BookstoreLoadTester/1.0',
                    'Accept': 'application/json'
                }
            });

            const responseTime = Date.now() - requestStart;
            
            session.results.requests++;
            session.results.responses++;
            session.results.totalTime += responseTime;
            session.results.responseTimes.push(responseTime);

            // Keep only last 100 response times for memory efficiency
            if (session.results.responseTimes.length > 100) {
                session.results.responseTimes.shift();
            }

            return { success: true, responseTime, status: response.status };

        } catch (error) {
            const responseTime = Date.now() - requestStart;
            session.results.requests++;
            session.results.errors++;
            
            const errorType = error.code || error.name || 'Unknown';
            session.results.errorTypes[errorType] = (session.results.errorTypes[errorType] || 0) + 1;

            return { success: false, responseTime, error: errorType };
        }
    }

    // Function to simulate a user
    async function simulateUser(userId) {
        while (Date.now() < endTime && session.status === 'running') {
            // Pick random endpoint
            const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
            
            await makeRequest(endpoint);
            
            // Random delay between requests (100ms to 2s)
            const delay = Math.random() * 1900 + 100;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // Start users with ramp-up
    const userPromises = [];
    for (let i = 0; i < users; i++) {
        setTimeout(() => {
            if (session.status === 'running') {
                userPromises.push(simulateUser(i));
            }
        }, i * rampUpInterval);
    }

    // Monitor progress
    const progressInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min((elapsed / (duration * 1000)) * 100, 100);
        session.progress = progress;

        // Calculate stats
        const avgResponseTime = session.results.totalTime / Math.max(session.results.responses, 1);
        const errorRate = (session.results.errors / Math.max(session.results.requests, 1)) * 100;
        const rps = session.results.responses / Math.max(elapsed / 1000, 1);

        broadcast({
            type: 'progress',
            sessionId,
            progress,
            stats: {
                requests: session.results.requests,
                responses: session.results.responses,
                errors: session.results.errors,
                avgResponseTime: Math.round(avgResponseTime),
                errorRate: Math.round(errorRate * 100) / 100,
                rps: Math.round(rps * 100) / 100,
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
        
        // Calculate final statistics
        const totalRequests = session.results.requests;
        const totalResponses = session.results.responses;
        const totalErrors = session.results.errors;
        const avgResponseTime = session.results.totalTime / Math.max(totalResponses, 1);
        const errorRate = (totalErrors / Math.max(totalRequests, 1)) * 100;
        const actualDuration = (session.endTime - session.startTime) / 1000;
        const rps = totalResponses / actualDuration;

        // Calculate percentiles
        const sortedTimes = session.results.responseTimes.sort((a, b) => a - b);
        const p50 = sortedTimes[Math.floor(sortedTimes.length * 0.5)] || 0;
        const p95 = sortedTimes[Math.floor(sortedTimes.length * 0.95)] || 0;
        const p99 = sortedTimes[Math.floor(sortedTimes.length * 0.99)] || 0;

        session.finalStats = {
            totalRequests,
            totalResponses,
            totalErrors,
            avgResponseTime: Math.round(avgResponseTime),
            errorRate: Math.round(errorRate * 100) / 100,
            rps: Math.round(rps * 100) / 100,
            duration: Math.round(actualDuration),
            percentiles: { p50, p95, p99 },
            errorTypes: session.results.errorTypes
        };

        broadcast({
            type: 'completed',
            sessionId,
            session,
            stats: session.finalStats
        });

        console.log(`Load test ${sessionId} completed:`, session.finalStats);
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