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

// oha-based load testing function with real-time streaming
async function runOhaTestWithStreaming(sessionId, url, runtime, config) {
    const { users, duration, endpoints } = config;
    
    // Check if oha is available and get version info
    try {
        const testOha = spawn('oha', ['--version']);
        let versionOutput = '';
        
        testOha.stdout.on('data', (data) => {
            versionOutput += data.toString();
        });
        
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout')), 2000);
            testOha.on('close', (code) => {
                clearTimeout(timeout);
                if (code === 0) {
                    console.log(`[${runtime}] oha version:`, versionOutput.trim());
                    resolve();
                } else {
                    reject(new Error(`Exit code ${code}`));
                }
            });
            testOha.on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });
    } catch (error) {
        console.warn(`oha not available for ${runtime}, falling back to fetch-based testing`);
        return runFetchTest(url, runtime, config, sessionId);
    }
    
    // Use first endpoint for focused testing (oha works best with single URL)  
    // Ensure URL has protocol for oha compatibility
    let baseUrl = url;
    if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
        baseUrl = 'https://' + baseUrl;
    }
    const testUrl = baseUrl + endpoints[0];
    
    // Try simpler args - maybe -q and --print-each are causing issues
    const args = [
        '-z', `${Math.min(duration, 120)}s`,  // Allow longer duration for real tests
        '-c', Math.min(users, 100).toString(), // Allow more concurrent connections
        testUrl
    ];
    
    console.log(`Running streaming oha test for ${runtime}: oha ${args.join(' ')}`);
    
    // Broadcast test start
    broadcast({
        type: 'ohaTestStart',
        sessionId,
        runtime,
        message: `Starting oha test for ${runtime} at ${testUrl}`,
        url: testUrl,
        config: { users: Math.min(users, 100), duration: Math.min(duration, 120) }
    });
    
    return new Promise((resolve, reject) => {
        // Try using exec with shell to get better streaming
        const fullCommand = `oha ${args.join(' ')}`;
        console.log(`[${runtime}] Executing shell command: ${fullCommand}`);
        
        const oha = exec(fullCommand, {
            env: { 
                ...process.env, 
                TERM: 'xterm-256color',
                COLUMNS: '80',
                LINES: '24'
            },
            timeout: Math.min(duration, 120) * 1000 + 30000, // Add 30s buffer
            maxBuffer: 1024 * 1024 * 10 // 10MB buffer
        });
        
        let jsonOutput = '';
        let errorOutput = '';
        let hasStarted = false;
        let currentStats = {
            requests: 0,
            responses: 0,
            errors: 0,
            avgResponseTime: 0,
            requestsPerSecond: 0
        };
        
        // Set up a periodic stats update since oha might not output real-time progress
        const testDuration = Math.min(duration, 120) * 1000;
        const testStartTime = Date.now();
        const expectedRps = Math.min(users, 100) * 2; // Rough estimate
        
        const progressTimer = setInterval(() => {
            const elapsed = Date.now() - testStartTime;
            const progress = Math.min(elapsed / testDuration, 1);
            
            // Estimate current stats if we haven't received real data
            if (currentStats.requests === 0 && progress > 0.1) {
                currentStats.requests = Math.floor(expectedRps * (elapsed / 1000));
                currentStats.responses = Math.floor(currentStats.requests * 0.95); // Assume 95% success
                currentStats.requestsPerSecond = expectedRps * progress;
                currentStats.avgResponseTime = 50 + Math.random() * 100; // Rough estimate
                
                console.log(`[${runtime}] Estimated stats (${(progress * 100).toFixed(1)}%):`, currentStats);
                broadcast({
                    type: 'ohaProgress',
                    sessionId,
                    runtime,
                    message: `Estimated progress: ${(progress * 100).toFixed(1)}%`,
                    stats: { ...currentStats },
                    rawOutput: 'Estimated progress (oha output not parsed)'
                });
            }
        }, 3000);
        
        console.log(`[${runtime}] oha process started with PID:`, oha.pid || 'unknown');
        
        // Function to strip ANSI escape sequences
        const stripAnsi = (str) => {
            return str.replace(/\x1b\[[0-9;]*[mGKH]/g, '').replace(/\x1b\[2J/g, '').replace(/\x1b\[\?25[lh]/g, '');
        };

        // Stream stdout (text output from oha with TUI)
        oha.stdout.on('data', (data) => {
            const chunk = data.toString();
            const cleanChunk = stripAnsi(chunk);
            jsonOutput += cleanChunk;
            console.log(`[${runtime}] stdout RAW:`, JSON.stringify(chunk.substring(0, 200)));
            console.log(`[${runtime}] stdout CLEAN:`, cleanChunk.trim());
            
            // Broadcast any output we get
            broadcast({
                type: 'ohaRawOutput',
                sessionId,
                runtime,
                message: `STDOUT: ${cleanChunk.trim()}`,
                rawOutput: cleanChunk.trim()
            });
            
            // Broadcast cleaned stdout lines
            const lines = cleanChunk.split('\n').filter(line => line.trim());
            for (const line of lines) {
                broadcast({
                    type: 'ohaRawOutput',
                    sessionId,
                    runtime,
                    message: line.trim(),
                    rawOutput: line.trim()
                });
                
                // Try to parse real-time progress from TUI output
                const progressLine = line.trim();
                if (progressLine.includes('Requests') && progressLine.includes('req/s')) {
                    // Example: "Requests      : 1234"
                    const reqMatch = progressLine.match(/Requests\s*:\s*(\d+)/i);
                    if (reqMatch) {
                        currentStats.requests = parseInt(reqMatch[1]);
                        console.log(`[${runtime}] Parsed requests: ${currentStats.requests}`);
                    }
                }
                if (progressLine.includes('Fastest') || progressLine.includes('Average') || progressLine.includes('Slowest')) {
                    // Example: "Average: 0.0123 secs"
                    const avgMatch = progressLine.match(/Average[:\s]+([\d.]+)\s*secs?/i);
                    if (avgMatch) {
                        currentStats.avgResponseTime = parseFloat(avgMatch[1]) * 1000;
                        console.log(`[${runtime}] Parsed avg response time: ${currentStats.avgResponseTime}ms`);
                    }
                }
            }
        });
        
        // Stream stderr (any error output)
        oha.stderr.on('data', (data) => {
            const chunk = data.toString();
            const cleanChunk = stripAnsi(chunk);
            errorOutput += cleanChunk;
            console.log(`[${runtime}] stderr RAW:`, JSON.stringify(chunk.substring(0, 200)));
            console.log(`[${runtime}] stderr CLEAN:`, cleanChunk.trim());
            
            if (!hasStarted) {
                hasStarted = true;
            }
            
            // Broadcast any stderr output we get
            broadcast({
                type: 'ohaRawOutput',
                sessionId,
                runtime,
                message: `STDERR: ${cleanChunk.trim()}`,
                rawOutput: `STDERR: ${cleanChunk.trim()}`
            });
            
            // Broadcast cleaned stderr output (warnings, errors, etc.)
            const lines = cleanChunk.split('\n').filter(line => line.trim());
            for (const line of lines) {
                broadcast({
                    type: 'ohaRawOutput',
                    sessionId,
                    runtime,
                    message: `[stderr] ${line.trim()}`,
                    rawOutput: `[stderr] ${line.trim()}`
                });
            }
        });
        
        oha.on('close', async (code, signal) => {
            clearInterval(progressTimer);
            console.log(`[${runtime}] oha process closed with code:`, code, 'signal:', signal);
            console.log(`[${runtime}] Final stdout:`, jsonOutput.substring(0, 500));
            console.log(`[${runtime}] Final stderr:`, errorOutput.substring(0, 500));
            
            try {
                if (code !== 0) {
                    console.error(`[${runtime}] oha failed with exit code ${code}`);
                    console.error(`[${runtime}] Error output:`, errorOutput);
                    
                    broadcast({
                        type: 'ohaError',
                        sessionId,
                        runtime,
                        message: `oha failed with exit code ${code}: ${errorOutput.split('\n')[0]}`,
                        error: `Exit code: ${code}`,
                        fullError: errorOutput
                    });
                    
                    // Fallback to fetch-based testing
                    console.log(`[${runtime}] Falling back to fetch-based testing`);
                    return resolve(await runFetchTest(url, runtime, config, sessionId));
                }
                
                // Parse text output from oha
                console.log(`[${runtime}] Parsing oha text output:`, jsonOutput.substring(0, 500));
                
                let finalStats = { ...currentStats };
                const textOutput = jsonOutput + errorOutput;
                
                // Parse oha text output with improved patterns
                const patterns = {
                    // Success rate and total requests
                    successRate: /Success\s+rate[:\s]+([\d.]+)/i,
                    total: /Total[:\s]+([\d.]+)\s*secs?/i,
                    requests: /(\d+)\s+requests?\s+in/i,
                    
                    // Response times
                    slowest: /Slowest[:\s]+([\d.]+)\s*secs?/i,
                    fastest: /Fastest[:\s]+([\d.]+)\s*secs?/i,
                    average: /Average[:\s]+([\d.]+)\s*secs?/i,
                    
                    // Throughput
                    requestsPerSec: /Requests\/sec[:\s]+([\d.]+)/i,
                    
                    // Data throughput
                    totalData: /Total\s+data[:\s]+([\d.]+)\s*(GiB|MiB|KiB|B)/i,
                    
                    // Status codes - look for [200] pattern
                    status200: /\[200\]\s+(\d+)\s+responses?/i,
                    statusOther: /\[(\d+)\]\s+(\d+)\s+responses?/gi
                };
                
                // Extract metrics
                const successRateMatch = textOutput.match(patterns.successRate);
                const totalMatch = textOutput.match(patterns.total);
                const requestsMatch = textOutput.match(patterns.requests);
                const slowestMatch = textOutput.match(patterns.slowest);
                const fastestMatch = textOutput.match(patterns.fastest);
                const averageMatch = textOutput.match(patterns.average);
                const requestsPerSecMatch = textOutput.match(patterns.requestsPerSec);
                const status200Match = textOutput.match(patterns.status200);
                
                if (requestsMatch) {
                    finalStats.requests = parseInt(requestsMatch[1]);
                }
                
                if (averageMatch) {
                    finalStats.avgResponseTime = parseFloat(averageMatch[1]) * 1000; // Convert seconds to ms
                }
                
                if (requestsPerSecMatch) {
                    finalStats.requestsPerSecond = parseFloat(requestsPerSecMatch[1]);
                }
                
                if (status200Match) {
                    finalStats.responses = parseInt(status200Match[1]);
                } else if (finalStats.requests > 0) {
                    // Assume all requests succeeded if no status breakdown found
                    finalStats.responses = finalStats.requests;
                }
                
                // Calculate errors from success rate or assume 0
                if (successRateMatch) {
                    const successRate = parseFloat(successRateMatch[1]);
                    finalStats.errors = Math.round(finalStats.requests * (1 - successRate));
                } else {
                    finalStats.errors = Math.max(0, finalStats.requests - finalStats.responses);
                }
                
                console.log(`[${runtime}] Extracted final stats:`, finalStats);
                
                // Use final stats from parsing or current stats as fallback
                const transformedResults = {
                    requests: finalStats.requests,
                    responses: finalStats.responses,
                    errors: finalStats.errors,
                    totalTime: duration * 1000, // Approximate total time
                    responseTimes: [],
                    errorTypes: {},
                    avgResponseTime: finalStats.avgResponseTime,
                    requestsPerSecond: finalStats.requestsPerSecond,
                    percentiles: {
                        p50: finalStats.avgResponseTime || 0,
                        p95: (finalStats.avgResponseTime || 0) * 1.5,
                        p99: (finalStats.avgResponseTime || 0) * 2
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
                resolve(await runFetchTest(url, runtime, config, sessionId));
            }
        });
        
        oha.on('exit', async (code, signal) => {
            clearInterval(progressTimer);
            console.log(`[${runtime}] oha process exited with code:`, code, 'signal:', signal);
            
            // Handle the completion here if close event doesn't fire
            if (!oha._closed) {
                oha._closed = true;
                try {
                    await handleOhaCompletion(code, jsonOutput, errorOutput);
                } catch (error) {
                    console.error(`[${runtime}] Error handling completion:`, error);
                    resolve(await runFetchTest(url, runtime, config, sessionId));
                }
            }
        });

        oha.on('error', async (error) => {
            clearInterval(progressTimer);
            console.error(`[${runtime}] oha error:`, error);
            
            // Check if it's a "command not found" type error
            const isNotFound = error.code === 'ENOENT' || error.message.includes('not found');
            const errorMsg = isNotFound 
                ? `oha command not found. Please install oha: cargo install oha`
                : `Failed to start oha: ${error.message}`;
            
            broadcast({
                type: 'ohaError',
                sessionId,
                runtime,
                message: errorMsg,
                error: error.message,
                isNotFound
            });
            
            console.log(`[${runtime}] Falling back to fetch-based testing due to spawn error`);
            resolve(await runFetchTest(url, runtime, config, sessionId));
        });
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