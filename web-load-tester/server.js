import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import fetch from 'node-fetch';
import { readFileSync } from 'fs';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
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

// oha-based load testing function with fallback to fetch
async function runOhaTest(url, runtime, config) {
    const { users, duration, endpoints } = config;
    
    // Check if oha is available
    try {
        const testOha = spawn('oha', ['--version']);
        await new Promise((resolve, reject) => {
            testOha.on('close', (code) => code === 0 ? resolve() : reject());
            testOha.on('error', reject);
        });
    } catch (error) {
        console.warn(`oha not available for ${runtime}, falling back to fetch-based testing`);
        return runFetchTest(url, runtime, config);
    }
    
    const outputFile = join(__dirname, `oha-results-${runtime}-${Date.now()}.json`);
    
    // Use first endpoint for focused testing (oha works best with single URL)  
    const testUrl = url + endpoints[0];
    
    const args = [
        '-z', `${Math.min(duration, 30)}s`,  // Cap duration for testing
        '-c', Math.min(users, 50).toString(), // Cap concurrent connections
        '-q', Math.floor(users * 2).toString(),
        '--output-format', 'json',
        '-o', outputFile,
        '--latency-correction',
        '--disable-keepalive',
        '--no-tui',
        testUrl
    ];
    
    console.log(`Running oha test for ${runtime}: oha ${args.join(' ')}`);
    
    return new Promise((resolve, reject) => {
        const oha = spawn('oha', args);
        
        let stdout = '';
        let stderr = '';
        
        oha.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        oha.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        oha.on('close', async (code) => {
            try {
                if (code !== 0) {
                    console.error(`oha failed for ${runtime}:`, stderr);
                    // Fallback to fetch-based testing
                    return resolve(await runFetchTest(url, runtime, config));
                }
                
                let results;
                try {
                    const fileContent = await fs.readFile(outputFile, 'utf8');
                    results = JSON.parse(fileContent);
                } catch (parseError) {
                    console.error(`Failed to parse oha output for ${runtime}:`, parseError.message);
                    return resolve(await runFetchTest(url, runtime, config));
                }
                
                await fs.unlink(outputFile).catch(() => {}); // Cleanup
                
                // Transform oha results to match expected format
                const transformedResults = {
                    requests: results.summary?.total || 0,
                    responses: results.summary?.success_count || 0,
                    errors: results.summary?.error_count || 0,
                    totalTime: (results.summary?.total_duration_secs || 0) * 1000,
                    responseTimes: [],
                    errorTypes: results.summary?.error_distribution || {},
                    avgResponseTime: (results.latency?.average_secs || 0) * 1000,
                    requestsPerSecond: results.requests_per_sec?.average || 0,
                    percentiles: {
                        p50: (results.latency?.percentiles?.p50_secs || 0) * 1000,
                        p95: (results.latency?.percentiles?.p95_secs || 0) * 1000,
                        p99: (results.latency?.percentiles?.p99_secs || 0) * 1000
                    }
                };
                
                console.log(`oha test completed for ${runtime}:`, transformedResults);
                resolve(transformedResults);
            } catch (error) {
                console.error(`oha processing error for ${runtime}:`, error.message);
                resolve(await runFetchTest(url, runtime, config));
            }
        });
        
        oha.on('error', async (error) => {
            console.error(`oha spawn error for ${runtime}:`, error.message);
            resolve(await runFetchTest(url, runtime, config));
        });
    });
}

// Fallback fetch-based testing (simplified version of old implementation)
async function runFetchTest(url, runtime, config) {
    const { users, duration, endpoints } = config;
    const startTime = Date.now();
    const endTime = startTime + (Math.min(duration, 30) * 1000); // Cap duration
    
    const results = {
        requests: 0,
        responses: 0,
        errors: 0,
        totalTime: 0,
        responseTimes: [],
        errorTypes: {},
        avgResponseTime: 0,
        requestsPerSecond: 0,
        percentiles: { p50: 0, p95: 0, p99: 0 }
    };
    
    const testPromises = [];
    const maxConcurrent = Math.min(users, 20); // Limit concurrent requests
    
    for (let i = 0; i < maxConcurrent; i++) {
        testPromises.push(
            (async () => {
                while (Date.now() < endTime) {
                    const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
                    const testUrl = url + endpoint;
                    const requestStart = Date.now();
                    
                    try {
                        const response = await fetch(testUrl, {
                            method: 'GET',
                            timeout: 5000,
                            headers: {
                                'User-Agent': `LoadTester-${runtime}`,
                                'Accept': 'application/json'
                            }
                        });
                        
                        const responseTime = Date.now() - requestStart;
                        results.requests++;
                        results.responses++;
                        results.totalTime += responseTime;
                        results.responseTimes.push(responseTime);
                        
                        // Keep only last 100 response times
                        if (results.responseTimes.length > 100) {
                            results.responseTimes.shift();
                        }
                    } catch (error) {
                        const responseTime = Date.now() - requestStart;
                        results.requests++;
                        results.errors++;
                        
                        const errorType = error.code || error.name || 'Unknown';
                        results.errorTypes[errorType] = (results.errorTypes[errorType] || 0) + 1;
                    }
                    
                    // Small delay between requests
                    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
                }
            })()
        );
    }
    
    await Promise.all(testPromises);
    
    // Calculate final stats
    const actualDuration = (Date.now() - startTime) / 1000;
    results.avgResponseTime = results.totalTime / Math.max(results.responses, 1);
    results.requestsPerSecond = results.responses / actualDuration;
    
    // Calculate percentiles
    if (results.responseTimes.length > 0) {
        const sorted = results.responseTimes.sort((a, b) => a - b);
        results.percentiles.p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
        results.percentiles.p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;  
        results.percentiles.p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;
    }
    
    console.log(`Fetch test completed for ${runtime}:`, results);
    return results;
}

// Comparison test runner using oha
async function runComparisonTest(sessionId, nodeUrl, bunUrl, config) {
    const session = activeSessions.get(sessionId);
    if (!session) return;

    const { users, duration, endpoints } = config;
    const startTime = Date.now();
    const usersPerRuntime = Math.floor(users / 2);

    console.log(`Starting oha-based comparison test ${sessionId}: ${users} users (${usersPerRuntime} each), ${duration}s duration`);

    try {
        // Run oha tests in parallel for both runtimes
        const [nodeResults, bunResults] = await Promise.all([
            runOhaTest(nodeUrl, 'node', { users: usersPerRuntime, duration, endpoints }),
            runOhaTest(bunUrl, 'bun', { users: usersPerRuntime, duration, endpoints })
        ]);

        // Update session results with oha data
        session.results.node = {
            ...session.results.node,
            ...nodeResults
        };

        session.results.bun = {
            ...session.results.bun,
            ...bunResults
        };

        session.status = 'completed';
        session.progress = 100;

        console.log(`Comparison test ${sessionId} completed successfully`);
        
    } catch (error) {
        console.error(`Comparison test ${sessionId} failed:`, error.message);
        session.status = 'failed';
        session.error = error.message;
    }

    // Calculate final comparison metrics
    const nodeResults = session.results.node;
    const bunResults = session.results.bun;
    
    // Determine winner based on multiple factors
    let winner = 'tie';
    const nodeScore = (nodeResults.requestsPerSecond || 0) - (nodeResults.avgResponseTime || 0) / 10;
    const bunScore = (bunResults.requestsPerSecond || 0) - (bunResults.avgResponseTime || 0) / 10;
    
    if (nodeScore > bunScore && (nodeResults.errors || 0) <= (bunResults.errors || 0)) {
        winner = 'node';
    } else if (bunScore > nodeScore && (bunResults.errors || 0) <= (nodeResults.errors || 0)) {
        winner = 'bun';
    }

    // Broadcast final results
    broadcast({
        type: 'progress',
        sessionId,
        progress: 100,
        comparison: {
            node: {
                requests: nodeResults.requests || 0,
                responses: nodeResults.responses || 0,
                errors: nodeResults.errors || 0,
                avgResponseTime: Math.round(nodeResults.avgResponseTime || 0),
                errorRate: Math.round(((nodeResults.errors || 0) / Math.max(nodeResults.requests || 1, 1)) * 10000) / 100,
                rps: Math.round((nodeResults.requestsPerSecond || 0) * 100) / 100,
                percentiles: nodeResults.percentiles || {}
            },
            bun: {
                requests: bunResults.requests || 0,
                responses: bunResults.responses || 0,
                errors: bunResults.errors || 0,
                avgResponseTime: Math.round(bunResults.avgResponseTime || 0),
                errorRate: Math.round(((bunResults.errors || 0) / Math.max(bunResults.requests || 1, 1)) * 10000) / 100,
                rps: Math.round((bunResults.requestsPerSecond || 0) * 100) / 100,
                percentiles: bunResults.percentiles || {}
            },
            winner,
            elapsed: duration
        }
    });
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