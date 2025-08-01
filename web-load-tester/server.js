import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import fetch from 'node-fetch';
import { readFileSync } from 'fs';
import { promises as fs } from 'fs';
import { spawn, exec } from 'child_process';
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

// Get environment variables for auto-populating URLs
app.get('/api/environment', (req, res) => {
    res.json({
        nodeUrl: process.env.NODE_PUBLIC_DOMAIN || '',
        bunUrl: process.env.BUN_PUBLIC_DOMAIN || '',
        hasNodeUrl: !!process.env.NODE_PUBLIC_DOMAIN,
        hasBunUrl: !!process.env.BUN_PUBLIC_DOMAIN
    });
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

// oha-based load testing function with real-time streaming via Rust service
async function runOhaTestWithStreaming(sessionId, url, runtime, config) {
    const { users, duration, endpoints } = config;
    
    // Use the Rust streaming service
    const streamingServiceUrl = 'https://blissful-celebration-production.up.railway.app';
    
    console.log(`[${runtime}] Using Rust streaming service for load testing`);
    
    // Prepare URLs for the test
    let baseUrl = url;
    if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
        baseUrl = 'https://' + baseUrl;
    }
    const testUrl = baseUrl + endpoints[0];
    
    // Broadcast test start
    broadcast({
        type: 'ohaTestStart',
        sessionId,
        runtime,
        message: `Starting load test for ${runtime} at ${testUrl}`,
        url: testUrl,
        config: { users: Math.min(users, 100), duration: Math.min(duration, 120) }
    });
    
    return new Promise(async (resolve, reject) => {
        try {
            // Import WebSocket client
            const WebSocketClient = (await import('ws')).default;
            
            let currentStats = {
                requests: 0,
                responses: 0,
                errors: 0,
                avgResponseTime: 0,
                requestsPerSecond: 0
            };
            
            let testCompleted = false;
            let testId = null;
            
            // Connect to WebSocket for real-time updates
            const ws = new WebSocketClient(`wss://blissful-celebration-production.up.railway.app/ws`);
            
            ws.on('open', () => {
                console.log(`[${runtime}] WebSocket connected`);
            });
            
            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    
                    // Filter messages by test_id if we have one
                    if (testId && message.test_id !== testId) {
                        return;
                    }
                    
                    // Handle different message types
                    switch (message.type) {
                        case 'TestStarted':
                            if (!testId) {
                                testId = message.test_id;
                                console.log(`[${runtime}] Tracking test ID: ${testId}`);
                            }
                            break;
                            
                        case 'Progress':
                            // Only process messages for our runtime
                            if (message.runtime === runtime) {
                                currentStats = {
                                    requests: message.requests_sent,
                                    responses: message.responses_received,
                                    errors: message.errors,
                                    avgResponseTime: message.avg_latency_ms,
                                    requestsPerSecond: message.current_rps
                                };
                                
                                broadcast({
                                    type: 'ohaProgress',
                                    sessionId,
                                    runtime,
                                    message: `Progress: ${message.requests_sent} requests, ${message.current_rps.toFixed(1)} RPS, ${message.avg_latency_ms.toFixed(1)}ms avg`,
                                    stats: currentStats,
                                    rawOutput: `Progress: ${message.progress_percent.toFixed(1)}% - ${message.elapsed_seconds.toFixed(1)}s elapsed`
                                });
                            }
                            break;
                            
                        case 'TestCompleted':
                            // Only process messages for our runtime
                            if (message.runtime === runtime) {
                                testCompleted = true;
                                const results = message.results;
                                
                                const transformedResults = {
                                    requests: results.total_requests,
                                    responses: results.successful_requests,
                                    errors: results.failed_requests,
                                    totalTime: results.total_duration_seconds * 1000,
                                    responseTimes: [],
                                    errorTypes: results.error_types || {},
                                    avgResponseTime: results.avg_latency_ms,
                                    requestsPerSecond: results.requests_per_second,
                                    percentiles: {
                                        p50: results.p50_latency_ms,
                                        p95: results.p95_latency_ms,
                                        p99: results.p99_latency_ms
                                    }
                                };
                                
                                broadcast({
                                    type: 'ohaCompleted',
                                    sessionId,
                                    runtime,
                                    message: `Load test completed for ${runtime}`,
                                    results: transformedResults
                                });
                                
                                console.log(`Load test completed for ${runtime}:`, transformedResults);
                                ws.close();
                                resolve(transformedResults);
                            }
                            break;
                            
                        case 'TestError':
                            if (message.runtime === runtime) {
                                broadcast({
                                    type: 'ohaError',
                                    sessionId,
                                    runtime,
                                    message: `Test error for ${runtime}`,
                                    error: message.error
                                });
                                ws.close();
                                reject(new Error(message.error));
                            }
                            break;
                    }
                } catch (error) {
                    console.error(`[${runtime}] Error parsing WebSocket message:`, error);
                }
            });
            
            ws.on('error', (error) => {
                console.error(`[${runtime}] WebSocket error:`, error);
                if (!testCompleted) {
                    reject(error);
                }
            });
            
            ws.on('close', () => {
                console.log(`[${runtime}] WebSocket closed`);
                if (!testCompleted) {
                    // Don't reject if we're just waiting for the test to start
                    setTimeout(() => {
                        if (!testCompleted && !testId) {
                            reject(new Error('WebSocket closed before test started'));
                        }
                    }, 5000);
                }
            });
            
            // Wait a moment for WebSocket to connect
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Start the test via Rust service API  
            // Note: We send the same URL for both node and bun since we're testing one at a time
            const testResponse = await fetch(`${streamingServiceUrl}/api/test/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    node_url: runtime === 'node' ? testUrl : 'http://localhost:3001/api/health',
                    bun_url: runtime === 'bun' ? testUrl : 'http://localhost:3002/api/health',
                    duration_seconds: Math.min(duration, 120),
                    connections: Math.min(users, 100),
                    rate_per_second: Math.min(users * 10, 1000)
                })
            });
            
            if (!testResponse.ok) {
                throw new Error(`Failed to start test: ${testResponse.statusText}`);
            }
            
            const { test_id } = await testResponse.json();
            testId = test_id;
            console.log(`[${runtime}] Test started with ID: ${test_id}`);
            
            // Set a timeout for the test
            const testTimeout = setTimeout(() => {
                if (!testCompleted) {
                    ws.close();
                    reject(new Error('Test timeout'));
                }
            }, (Math.min(duration, 120) + 30) * 1000); // Add 30s buffer
            
        } catch (error) {
            console.error(`Error in Rust streaming service for ${runtime}:`, error);
            broadcast({
                type: 'ohaError',
                sessionId,
                runtime,
                message: `Failed to connect to streaming service`,
                error: error.message
            });
            
            // Fall back to fetch-based testing
            console.log(`[${runtime}] Falling back to fetch-based testing`);
            resolve(await runFetchTest(url, runtime, config, sessionId));
        }
    });
}
// Keep the original non-streaming version for backwards compatibility
async function runOhaTest(url, runtime, config) {
    return runOhaTestWithStreaming(null, url, runtime, config);
}

// Enhanced fetch-based testing with real-time streaming updates
async function runFetchTest(url, runtime, config, sessionId = null) {
    const { users, duration, endpoints } = config;
    const startTime = Date.now();
    const endTime = startTime + (Math.min(duration, 120) * 1000); // Allow longer duration
    
    console.log(`[${runtime}] Starting fetch-based test as fallback`);
    
    // Ensure URL has protocol for fetch compatibility
    let baseUrl = url;
    if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
        baseUrl = 'https://' + baseUrl;
    }
    
    // Broadcast test start
    if (sessionId) {
        broadcast({
            type: 'ohaTestStart',
            sessionId,
            runtime,
            message: `Starting fetch-based test for ${runtime} (oha fallback)`,
            url: baseUrl + endpoints[0],
            config: { users: Math.min(users, 50), duration: Math.min(duration, 120) }
        });
    }
    
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
    
    // Set up real-time progress broadcasting
    let lastBroadcast = 0;
    const broadcastInterval = 2000; // Broadcast every 2 seconds
    
    const broadcastProgress = () => {
        if (sessionId && Date.now() - lastBroadcast > broadcastInterval) {
            const elapsed = (Date.now() - startTime) / 1000;
            const currentRps = results.responses / Math.max(elapsed, 0.1);
            const currentAvg = results.totalTime / Math.max(results.responses, 1);
            
            broadcast({
                type: 'ohaProgress',
                sessionId,
                runtime,
                message: `Fetch test: ${results.requests} req, ${results.responses} resp, ${currentRps.toFixed(1)} RPS`,
                stats: {
                    requests: results.requests,
                    responses: results.responses,
                    errors: results.errors,
                    avgResponseTime: currentAvg,
                    requestsPerSecond: currentRps
                },
                rawOutput: `${results.requests} requests, ${results.responses} responses, ${currentRps.toFixed(1)} req/s`
            });
            
            lastBroadcast = Date.now();
        }
    };
    
    const testPromises = [];
    const maxConcurrent = Math.min(users, 50); // Allow more concurrent requests
    
    for (let i = 0; i < maxConcurrent; i++) {
        testPromises.push(
            (async () => {
                while (Date.now() < endTime) {
                    const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
                    const testUrl = baseUrl + endpoint;
                    const requestStart = Date.now();
                    
                    try {
                        const response = await fetch(testUrl, {
                            method: 'GET',
                            timeout: 10000,
                            headers: {
                                'User-Agent': `LoadTester-${runtime}-Fetch`,
                                'Accept': 'application/json',
                                'Connection': 'keep-alive'
                            }
                        });
                        
                        const responseTime = Date.now() - requestStart;
                        results.requests++;
                        results.responses++;
                        results.totalTime += responseTime;
                        results.responseTimes.push(responseTime);
                        
                        // Keep only last 1000 response times for better percentile calculation
                        if (results.responseTimes.length > 1000) {
                            results.responseTimes.shift();
                        }
                        
                        broadcastProgress();
                        
                    } catch (error) {
                        const responseTime = Date.now() - requestStart;
                        results.requests++;
                        results.errors++;
                        
                        const errorType = error.code || error.name || 'Unknown';
                        results.errorTypes[errorType] = (results.errorTypes[errorType] || 0) + 1;
                        
                        broadcastProgress();
                    }
                    
                    // Smaller delay for higher throughput
                    await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
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
    
    // Broadcast completion
    if (sessionId) {
        broadcast({
            type: 'ohaCompleted',
            sessionId,
            runtime,
            message: `Fetch-based test completed for ${runtime}`,
            results
        });
    }
    
    console.log(`[${runtime}] Fetch test completed:`, results);
    return results;
}

// Enhanced comparison test runner with real-time oha streaming
async function runComparisonTest(sessionId, nodeUrl, bunUrl, config) {
    const session = activeSessions.get(sessionId);
    if (!session) return;

    const { users, duration, endpoints } = config;
    const startTime = Date.now();

    console.log(`Starting streaming comparison test ${sessionId}: ${users} users, ${duration}s duration`);
    
    // Use the Rust streaming service for both runtimes together
    const streamingServiceUrl = 'https://blissful-celebration-production.up.railway.app';
    
    try {
        // Import WebSocket client
        const WebSocketClient = (await import('ws')).default;
        
        // Prepare URLs
        let baseNodeUrl = nodeUrl;
        if (!baseNodeUrl.startsWith('http://') && !baseNodeUrl.startsWith('https://')) {
            baseNodeUrl = 'https://' + baseNodeUrl;
        }
        const nodeTestUrl = baseNodeUrl + endpoints[0];
        
        let baseBunUrl = bunUrl;
        if (!baseBunUrl.startsWith('http://') && !baseBunUrl.startsWith('https://')) {
            baseBunUrl = 'https://' + baseBunUrl;
        }
        const bunTestUrl = baseBunUrl + endpoints[0];
        
        // Connect to WebSocket for real-time updates
        const ws = new WebSocketClient(`wss://blissful-celebration-production.up.railway.app/ws`);
        
        let testCompleted = false;
        let testId = null;
        let nodeResults = null;
        let bunResults = null;
        
        ws.on('open', () => {
            console.log('WebSocket connected for comparison test');
        });
        
        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                
                // Filter messages by test_id if we have one
                if (testId && message.test_id !== testId) {
                    return;
                }
                
                // Handle different message types
                switch (message.type) {
                    case 'TestStarted':
                        if (!testId) {
                            testId = message.test_id;
                            console.log(`Tracking comparison test ID: ${testId}`);
                        }
                        break;
                        
                    case 'Progress':
                        // Update progress for the specific runtime
                        const stats = {
                            requests: message.requests_sent,
                            responses: message.responses_received,
                            errors: message.errors,
                            avgResponseTime: message.avg_latency_ms,
                            requestsPerSecond: message.current_rps
                        };
                        
                        // Update session with progress
                        if (message.runtime === 'node') {
                            session.results.node = { ...session.results.node, ...stats };
                        } else if (message.runtime === 'bun') {
                            session.results.bun = { ...session.results.bun, ...stats };
                        }
                        
                        // Calculate progress
                        const progress = message.progress_percent || ((message.elapsed_seconds / duration) * 100);
                        session.progress = Math.min(progress, 100);
                        
                        // Determine current winner
                        const nodeScore = session.results.node.requestsPerSecond - (session.results.node.avgResponseTime || 0) / 10;
                        const bunScore = session.results.bun.requestsPerSecond - (session.results.bun.avgResponseTime || 0) / 10;
                        let winner = 'tie';
                        if (nodeScore > bunScore) winner = 'node';
                        else if (bunScore > nodeScore) winner = 'bun';
                        
                        // Broadcast progress
                        broadcast({
                            type: 'progress',
                            sessionId,
                            progress: session.progress,
                            comparison: {
                                node: {
                                    requests: session.results.node.requests,
                                    responses: session.results.node.responses,
                                    errors: session.results.node.errors,
                                    avgResponseTime: Math.round(session.results.node.avgResponseTime || 0),
                                    errorRate: Math.round((session.results.node.errors / Math.max(session.results.node.requests, 1)) * 10000) / 100,
                                    rps: Math.round((session.results.node.requestsPerSecond || 0) * 100) / 100
                                },
                                bun: {
                                    requests: session.results.bun.requests,
                                    responses: session.results.bun.responses,
                                    errors: session.results.bun.errors,
                                    avgResponseTime: Math.round(session.results.bun.avgResponseTime || 0),
                                    errorRate: Math.round((session.results.bun.errors / Math.max(session.results.bun.requests, 1)) * 10000) / 100,
                                    rps: Math.round((session.results.bun.requestsPerSecond || 0) * 100) / 100
                                },
                                winner
                            }
                        });
                        break;
                        
                    case 'TestCompleted':
                        // Store results for the specific runtime
                        const results = message.results;
                        const transformedResults = {
                            requests: results.total_requests,
                            responses: results.successful_requests,
                            errors: results.failed_requests,
                            totalTime: results.total_duration_seconds * 1000,
                            responseTimes: [],
                            errorTypes: results.error_types || {},
                            avgResponseTime: results.avg_latency_ms,
                            requestsPerSecond: results.requests_per_second,
                            percentiles: {
                                p50: results.p50_latency_ms,
                                p95: results.p95_latency_ms,
                                p99: results.p99_latency_ms
                            }
                        };
                        
                        if (message.runtime === 'node') {
                            nodeResults = transformedResults;
                            session.results.node = { ...session.results.node, ...transformedResults };
                        } else if (message.runtime === 'bun') {
                            bunResults = transformedResults;
                            session.results.bun = { ...session.results.bun, ...transformedResults };
                        }
                        
                        // Check if both tests are complete
                        if (nodeResults && bunResults) {
                            testCompleted = true;
                            session.status = 'completed';
                            session.progress = 100;
                            session.endTime = new Date();
                            
                            // Calculate final comparison
                            const finalComparison = calculateFinalComparison(nodeResults, bunResults);
                            session.comparison = finalComparison;
                            
                            // Broadcast completion
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
                            
                            console.log(`Comparison test ${sessionId} completed successfully`);
                            ws.close();
                        }
                        break;
                        
                    case 'TestError':
                        broadcast({
                            type: 'error',
                            sessionId,
                            message: `Test error for ${message.runtime}`,
                            error: message.error
                        });
                        break;
                }
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        });
        
        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
        });
        
        ws.on('close', () => {
            console.log('WebSocket closed');
            if (!testCompleted) {
                session.status = 'failed';
                session.error = 'WebSocket connection closed unexpectedly';
            }
        });
        
        // Wait a moment for WebSocket to connect
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Start the test via Rust service API - both URLs at once
        const testResponse = await fetch(`${streamingServiceUrl}/api/test/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                node_url: nodeTestUrl,
                bun_url: bunTestUrl,
                duration_seconds: Math.min(duration, 120),
                connections: Math.min(users, 100),
                rate_per_second: Math.min(users * 10, 1000)
            })
        });
        
        if (!testResponse.ok) {
            throw new Error(`Failed to start test: ${testResponse.statusText}`);
        }
        
        const { test_id } = await testResponse.json();
        testId = test_id;
        console.log(`Comparison test started with ID: ${test_id}`);
        
    } catch (error) {
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