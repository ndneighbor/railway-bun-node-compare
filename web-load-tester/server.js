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

// oha-based load testing function with real-time streaming
async function runOhaTestWithStreaming(sessionId, url, runtime, config) {
    const { users, duration, endpoints } = config;
    
    // Check if oha is available
    try {
        const testOha = spawn('oha', ['--version']);
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout')), 2000);
            testOha.on('close', (code) => {
                clearTimeout(timeout);
                code === 0 ? resolve() : reject(new Error(`Exit code ${code}`));
            });
            testOha.on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });
    } catch (error) {
        console.warn(`oha not available for ${runtime}, falling back to fetch-based testing`);
        return runFetchTest(url, runtime, config);
    }
    
    // Use first endpoint for focused testing (oha works best with single URL)  
    const testUrl = url + endpoints[0];
    
    const args = [
        '-z', `${Math.min(duration, 120)}s`,  // Allow longer duration for real tests
        '-c', Math.min(users, 100).toString(), // Allow more concurrent connections
        '-q', Math.floor(users * 2).toString(),
        '--json',                             // JSON output for final results
        '--latency-correction',
        '--disable-keepalive',
        testUrl
    ];
    
    console.log(`Running streaming oha test for ${runtime}: oha ${args.join(' ')}`);
    
    // Broadcast test start
    broadcast({
        type: 'ohaTestStart',
        sessionId,
        runtime,
        message: `Starting oha test for ${runtime}`,
        url: testUrl,
        config: { users: Math.min(users, 100), duration: Math.min(duration, 120) }
    });
    
    return new Promise((resolve, reject) => {
        const oha = spawn('oha', args);
        
        let jsonOutput = '';
        let currentStats = {
            requests: 0,
            responses: 0,
            errors: 0,
            avgResponseTime: 0,
            requestsPerSecond: 0
        };
        
        // Stream stdout (JSON output)
        oha.stdout.on('data', (data) => {
            jsonOutput += data.toString();
        });
        
        // Stream stderr (progress info)
        oha.stderr.on('data', (data) => {
            const chunk = data.toString();
            
            // Parse progress information from oha's stderr
            const lines = chunk.split('\n').filter(line => line.trim());
            
            for (const line of lines) {
                // Look for status updates from oha
                if (line.includes('req/s') || line.includes('RPS') || line.includes('%')) {
                    // Extract metrics from status line if possible
                    const rpsMatch = line.match(/(\d+(?:\.\d+)?)\s*req\/s/);
                    const avgMatch = line.match(/avg:\s*(\d+(?:\.\d+)?)\s*ms/);
                    const errorMatch = line.match(/(\d+)\s*errors/);
                    const requestMatch = line.match(/(\d+)\s*requests/);
                    
                    if (rpsMatch) currentStats.requestsPerSecond = parseFloat(rpsMatch[1]);
                    if (avgMatch) currentStats.avgResponseTime = parseFloat(avgMatch[1]);
                    if (errorMatch) currentStats.errors = parseInt(errorMatch[1]);
                    if (requestMatch) currentStats.requests = parseInt(requestMatch[1]);
                    
                    currentStats.responses = currentStats.requests - currentStats.errors;
                    
                    // Broadcast live progress
                    broadcast({
                        type: 'ohaProgress',
                        sessionId,
                        runtime,
                        message: line.trim(),
                        stats: { ...currentStats },
                        rawOutput: line.trim()
                    });
                }
            }
        });
        
        oha.on('close', async (code) => {
            try {
                if (code !== 0) {
                    console.error(`oha failed for ${runtime} with exit code ${code}`);
                    broadcast({
                        type: 'ohaError',
                        sessionId,
                        runtime,
                        message: `oha failed with exit code ${code}`,
                        error: `Exit code: ${code}`
                    });
                    // Fallback to fetch-based testing
                    return resolve(await runFetchTest(url, runtime, config));
                }
                
                let results;
                try {
                    results = JSON.parse(jsonOutput);
                } catch (parseError) {
                    console.error(`Failed to parse oha JSON output for ${runtime}:`, parseError.message);
                    broadcast({
                        type: 'ohaError',
                        sessionId,
                        runtime,
                        message: `Failed to parse oha results`,
                        error: parseError.message
                    });
                    return resolve(await runFetchTest(url, runtime, config));
                }
                
                // Transform oha results to match expected format
                const transformedResults = {
                    requests: results.summary?.total || currentStats.requests,
                    responses: results.summary?.success_count || currentStats.responses,
                    errors: results.summary?.error_count || currentStats.errors,
                    totalTime: (results.summary?.total_duration_secs || 0) * 1000,
                    responseTimes: [],
                    errorTypes: results.summary?.error_distribution || {},
                    avgResponseTime: (results.latency?.average_secs || 0) * 1000 || currentStats.avgResponseTime,
                    requestsPerSecond: results.requests_per_sec?.average || currentStats.requestsPerSecond,
                    percentiles: {
                        p50: (results.latency?.percentiles?.p50_secs || 0) * 1000,
                        p95: (results.latency?.percentiles?.p95_secs || 0) * 1000,
                        p99: (results.latency?.percentiles?.p99_secs || 0) * 1000
                    }
                };
                
                broadcast({
                    type: 'ohaCompleted',
                    sessionId,
                    runtime,
                    message: `oha test completed for ${runtime}`,
                    results: transformedResults
                });
                
                console.log(`oha test completed for ${runtime}:`, transformedResults);
                resolve(transformedResults);
            } catch (error) {
                console.error(`oha processing error for ${runtime}:`, error.message);
                broadcast({
                    type: 'ohaError',
                    sessionId,
                    runtime,
                    message: `oha processing error`,
                    error: error.message
                });
                resolve(await runFetchTest(url, runtime, config));
            }
        });
        
        oha.on('error', async (error) => {
            console.error(`oha spawn error for ${runtime}:`, error.message);
            broadcast({
                type: 'ohaError',
                sessionId,
                runtime,
                message: `Failed to start oha: ${error.message}. Please ensure oha is installed.`,
                error: error.message
            });
            resolve(await runFetchTest(url, runtime, config));
        });
    });
}

// Keep the original non-streaming version for backwards compatibility
async function runOhaTest(url, runtime, config) {
    return runOhaTestWithStreaming(null, url, runtime, config);
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

// Enhanced comparison test runner with real-time oha streaming
async function runComparisonTest(sessionId, nodeUrl, bunUrl, config) {
    const session = activeSessions.get(sessionId);
    if (!session) return;

    const { users, duration, endpoints } = config;
    const startTime = Date.now();
    const usersPerRuntime = Math.floor(users / 2);

    console.log(`Starting streaming oha comparison test ${sessionId}: ${users} users (${usersPerRuntime} each), ${duration}s duration`);

    // Initialize progress tracking
    const progressTracker = {
        nodeStats: { requests: 0, responses: 0, errors: 0, avgResponseTime: 0, requestsPerSecond: 0 },
        bunStats: { requests: 0, responses: 0, errors: 0, avgResponseTime: 0, requestsPerSecond: 0 },
        startTime: Date.now(),
        duration: duration * 1000,
        nodeCompleted: false,
        bunCompleted: false
    };

    // Set up progress broadcasting interval
    const progressInterval = setInterval(() => {
        if (!activeSessions.has(sessionId)) {
            clearInterval(progressInterval);
            return;
        }

        const elapsed = (Date.now() - progressTracker.startTime) / 1000;
        const progress = Math.min((elapsed / duration) * 100, 100);
        
        // Determine current winner
        let winner = 'tie';
        const nodeScore = progressTracker.nodeStats.requestsPerSecond - (progressTracker.nodeStats.avgResponseTime || 0) / 10;
        const bunScore = progressTracker.bunStats.requestsPerSecond - (progressTracker.bunStats.avgResponseTime || 0) / 10;
        
        if (nodeScore > bunScore && progressTracker.nodeStats.errors <= progressTracker.bunStats.errors) {
            winner = 'node';
        } else if (bunScore > nodeScore && progressTracker.bunStats.errors <= progressTracker.nodeStats.errors) {
            winner = 'bun';
        }

        // Broadcast live progress
        broadcast({
            type: 'progress',
            sessionId,
            progress,
            comparison: {
                node: {
                    requests: progressTracker.nodeStats.requests,
                    responses: progressTracker.nodeStats.responses,
                    errors: progressTracker.nodeStats.errors,
                    avgResponseTime: Math.round(progressTracker.nodeStats.avgResponseTime),
                    errorRate: Math.round((progressTracker.nodeStats.errors / Math.max(progressTracker.nodeStats.requests, 1)) * 10000) / 100,
                    rps: Math.round(progressTracker.nodeStats.requestsPerSecond * 100) / 100
                },
                bun: {
                    requests: progressTracker.bunStats.requests,
                    responses: progressTracker.bunStats.responses,
                    errors: progressTracker.bunStats.errors,
                    avgResponseTime: Math.round(progressTracker.bunStats.avgResponseTime),
                    errorRate: Math.round((progressTracker.bunStats.errors / Math.max(progressTracker.bunStats.requests, 1)) * 10000) / 100,
                    rps: Math.round(progressTracker.bunStats.requestsPerSecond * 100) / 100
                },
                winner
            }
        });

        // Clear interval when both tests complete
        if ((progressTracker.nodeCompleted && progressTracker.bunCompleted) || progress >= 100) {
            clearInterval(progressInterval);
        }
    }, 2000); // Update every 2 seconds

    // Listen for oha progress updates to update our tracker
    const originalBroadcast = global.broadcast || broadcast;
    global.broadcast = (data) => {
        // Intercept oha progress messages for this session
        if (data.sessionId === sessionId && data.type === 'ohaProgress') {
            if (data.runtime === 'node') {
                progressTracker.nodeStats = { ...progressTracker.nodeStats, ...data.stats };
            } else if (data.runtime === 'bun') {
                progressTracker.bunStats = { ...progressTracker.bunStats, ...data.stats };
            }
        } else if (data.sessionId === sessionId && data.type === 'ohaCompleted') {
            if (data.runtime === 'node') {
                progressTracker.nodeCompleted = true;
            } else if (data.runtime === 'bun') {
                progressTracker.bunCompleted = true;
            }
        }
        
        // Forward all messages to clients
        originalBroadcast(data);
    };

    try {
        // Run oha tests in parallel for both runtimes with streaming
        const [nodeResults, bunResults] = await Promise.all([
            runOhaTestWithStreaming(sessionId, nodeUrl, 'node', { users: usersPerRuntime, duration, endpoints }),
            runOhaTestWithStreaming(sessionId, bunUrl, 'bun', { users: usersPerRuntime, duration, endpoints })
        ]);

        // Restore original broadcast function
        global.broadcast = originalBroadcast;
        clearInterval(progressInterval);

        // Update session results with final oha data
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
        session.endTime = new Date();

        console.log(`Streaming comparison test ${sessionId} completed successfully`);
        
        // Calculate final comparison and advantages
        const finalComparison = calculateFinalComparison(nodeResults, bunResults);
        
        // Broadcast final completed results
        broadcast({
            type: 'completed',
            sessionId,
            session,
            comparison: finalComparison,
            stats: {
                node: nodeResults,
                bun: bunResults
            }
        });
        
    } catch (error) {
        // Restore original broadcast function
        global.broadcast = originalBroadcast;
        clearInterval(progressInterval);
        
        console.error(`Comparison test ${sessionId} failed:`, error.message);
        session.status = 'failed';
        session.error = error.message;
        
        broadcast({
            type: 'error',
            sessionId,
            message: 'Comparison test failed',
            error: error.message
        });
    }
}

// Calculate final comparison with advantages
function calculateFinalComparison(nodeResults, bunResults) {
    let winner = 'tie';
    const nodeAdvantages = [];
    const bunAdvantages = [];
    
    // Compare response times
    if (nodeResults.avgResponseTime < bunResults.avgResponseTime) {
        nodeAdvantages.push('faster_response_time');
    } else if (bunResults.avgResponseTime < nodeResults.avgResponseTime) {
        bunAdvantages.push('faster_response_time');
    }
    
    // Compare throughput
    if (nodeResults.requestsPerSecond > bunResults.requestsPerSecond) {
        nodeAdvantages.push('higher_throughput');
    } else if (bunResults.requestsPerSecond > nodeResults.requestsPerSecond) {
        bunAdvantages.push('higher_throughput');
    }
    
    // Compare error rates
    const nodeErrorRate = (nodeResults.errors || 0) / Math.max(nodeResults.requests || 1, 1);
    const bunErrorRate = (bunResults.errors || 0) / Math.max(bunResults.requests || 1, 1);
    
    if (nodeErrorRate < bunErrorRate) {
        nodeAdvantages.push('lower_error_rate');
    } else if (bunErrorRate < nodeErrorRate) {
        bunAdvantages.push('lower_error_rate');
    }
    
    // Compare P95 latency
    if ((nodeResults.percentiles?.p95 || 0) < (bunResults.percentiles?.p95 || 0)) {
        nodeAdvantages.push('better_p95_latency');
    } else if ((bunResults.percentiles?.p95 || 0) < (nodeResults.percentiles?.p95 || 0)) {
        bunAdvantages.push('better_p95_latency');
    }
    
    // Determine overall winner
    if (nodeAdvantages.length > bunAdvantages.length) {
        winner = 'node';
    } else if (bunAdvantages.length > nodeAdvantages.length) {
        winner = 'bun';
    }
    
    return {
        winner,
        nodeAdvantages,
        bunAdvantages,
        performanceGap: {
            responseTime: Math.abs((nodeResults.avgResponseTime || 0) - (bunResults.avgResponseTime || 0)),
            throughput: Math.abs((nodeResults.requestsPerSecond || 0) - (bunResults.requestsPerSecond || 0)),
            errorRate: Math.abs(nodeErrorRate - bunErrorRate) * 100
        }
    };
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