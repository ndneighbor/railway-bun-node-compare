import db from '../database/connection.js';
import performanceMonitor from '../middleware/performance-monitor.js';

export class PerformanceHandler {
    // GET /api/performance/metrics - Get current runtime metrics
    async getMetrics(request) {
        try {
            const url = new URL(request.url);
            const timeframe = url.searchParams.get('timeframe') || '1 hour';
            const metrics = await performanceMonitor.getMetrics(timeframe);
            const currentStats = await performanceMonitor.getCurrentStats();

            return Response.json({
                current: currentStats,
                metrics,
                timeframe
            });
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
        }
    }

    // GET /api/performance/history - Get historical performance data
    async getHistory(request) {
        try {
            const url = new URL(request.url);
            const runtime = url.searchParams.get('runtime');
            const hours = Math.min(parseInt(url.searchParams.get('hours')) || 24, 168); // Max 1 week

            // Build dynamic query conditions safely
            let conditions = [db.sql`timestamp > NOW() - INTERVAL '${hours} hours'`];
            
            if (runtime) {
                conditions.push(db.sql`runtime = ${runtime}`);
            }

            const whereClause = conditions.length > 0 
                ? db.sql`WHERE ${db.sql.join(conditions, db.sql` AND `)}`
                : db.sql``;

            const result = await db.sql`
                SELECT 
                    DATE_TRUNC('hour', timestamp) as hour,
                    runtime,
                    AVG(response_time_ms) as avg_response_time,
                    MIN(response_time_ms) as min_response_time,
                    MAX(response_time_ms) as max_response_time,
                    AVG(memory_usage_mb) as avg_memory_usage,
                    COUNT(*) as request_count
                FROM performance_metrics 
                ${whereClause}
                GROUP BY DATE_TRUNC('hour', timestamp), runtime
                ORDER BY hour DESC, runtime
            `;
            
            return Response.json(result);
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
        }
    }

    // GET /api/performance/compare - Compare with other runtime
    async compare(request) {
        try {
            const url = new URL(request.url);
            const hours = parseInt(url.searchParams.get('hours')) || 1;
            const comparisonUrl = process.env.COMPARISON_SERVICE_URL;

            // Get current runtime metrics
            const currentRuntime = process.env.RUNTIME_NAME || 'bun';
            const result = await db.sql`
                SELECT 
                    runtime,
                    endpoint,
                    AVG(response_time_ms) as avg_response_time,
                    MIN(response_time_ms) as min_response_time,
                    MAX(response_time_ms) as max_response_time,
                    AVG(memory_usage_mb) as avg_memory_usage,
                    COUNT(*) as request_count
                FROM performance_metrics 
                WHERE timestamp > NOW() - INTERVAL '${hours} hours'
                GROUP BY runtime, endpoint
                ORDER BY runtime, endpoint
            `;
            const localMetrics = result;

            let comparison = {
                local: {
                    runtime: currentRuntime,
                    metrics: localMetrics.filter(m => m.runtime === currentRuntime)
                },
                remote: null,
                summary: null
            };

            // Fetch remote metrics if comparison URL is available
            if (comparisonUrl) {
                try {
                    const response = await fetch(`${comparisonUrl}/api/performance/metrics?timeframe=${hours} hours`);
                    if (response.ok) {
                        const remoteData = await response.json();
                        comparison.remote = {
                            runtime: remoteData.current.runtime,
                            metrics: remoteData.metrics
                        };

                        // Calculate comparison summary
                        const localAvg = localMetrics.reduce((sum, m) => sum + parseFloat(m.avg_response_time), 0) / localMetrics.length || 0;
                        const remoteAvg = remoteData.metrics.reduce((sum, m) => sum + parseFloat(m.avg_response_time), 0) / remoteData.metrics.length || 0;
                        
                        comparison.summary = {
                            response_time_difference: localAvg - remoteAvg,
                            faster_runtime: localAvg < remoteAvg ? currentRuntime : remoteData.current.runtime,
                            performance_improvement: remoteAvg > 0 ? ((remoteAvg - localAvg) / remoteAvg * 100).toFixed(2) : 0
                        };
                    }
                } catch (fetchError) {
                    console.warn('Failed to fetch remote metrics:', fetchError.message);
                }
            }

            return Response.json(comparison);
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
        }
    }

    // POST /api/performance/benchmark - Trigger load test scenarios with oha
    async benchmark(request) {
        try {
            const body = await request.json();
            const { scenario = 'light', duration = 60, wsId } = body;
            
            const scenarios = {
                startup: { users: 1, duration: 10, endpoints: ['/api/health'] },
                light: { users: 10, duration: 60, endpoints: ['/api/books', '/api/authors', '/api/search?q=test'] },
                medium: { users: 50, duration: 120, endpoints: ['/api/books', '/api/authors', '/api/search?q=test', '/api/books/1'] },
                heavy: { users: 100, duration: 180, endpoints: ['/api/books', '/api/authors', '/api/search?q=test', '/api/books/1', '/api/authors/1'] },
                database: { users: 20, duration: 60, endpoints: ['/api/books?page=1&limit=50', '/api/search?q=long+query+with+filters&genre=Fiction'] },
                mixed: { users: 30, duration: 120, endpoints: ['/api/books', '/api/orders', '/api/search?q=mixed'] }
            };

            if (!scenarios[scenario]) {
                return Response.json({ 
                    error: `Invalid scenario. Available: ${Object.keys(scenarios).join(', ')}` 
                }, { status: 400 });
            }

            const config = scenarios[scenario];
            const startTime = new Date();
            const benchmarkId = `benchmark_${Date.now()}`;

            // Store benchmark start
            await db.sql`
                INSERT INTO performance_metrics (runtime, endpoint, response_time_ms, memory_usage_mb) 
                VALUES (${process.env.RUNTIME_NAME || 'bun'}, ${`/benchmark/${scenario}`}, ${0}, ${process.memoryUsage().heapUsed / 1024 / 1024})
            `;

            // Start the oha benchmark asynchronously
            this.runOhaBenchmark(config, benchmarkId, wsId);

            return Response.json({
                scenario,
                config,
                startTime,
                status: 'running',
                id: benchmarkId,
                message: 'Benchmark started with oha, check WebSocket connection for real-time updates'
            });
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
        }
    }

    // Run oha benchmark with streaming output
    async runOhaBenchmark(config, benchmarkId, wsId) {
        const { spawn } = await import('child_process');
        const port = process.env.PORT || 3000;
        
        // Broadcast to all WebSocket connections (or specific wsId if provided)
        const broadcast = (message) => {
            const data = JSON.stringify({
                type: 'benchmark',
                benchmarkId,
                timestamp: new Date().toISOString(),
                ...message
            });
            
            // Get WebSocket connections from the server context
            // This will need to be passed from the server or accessed via a global
            if (global.wsConnections) {
                for (const ws of global.wsConnections) {
                    try {
                        ws.send(data);
                    } catch (error) {
                        console.error('Error sending WebSocket message:', error);
                    }
                }
            }
        };

        // Run oha command for each endpoint
        for (let i = 0; i < config.endpoints.length; i++) {
            const endpoint = config.endpoints[i];
            const url = `http://localhost:${port}${endpoint}`;
            
            broadcast({
                status: 'running',
                message: `Starting load test for ${endpoint} (${i + 1}/${config.endpoints.length})`,
                endpoint,
                progress: (i / config.endpoints.length) * 100
            });

            try {
                await this.runSingleOhaTest(url, config, broadcast);
            } catch (error) {
                broadcast({
                    status: 'error',
                    message: `Failed to test ${endpoint}: ${error.message}`,
                    endpoint,
                    error: error.message
                });
            }
        }

        broadcast({
            status: 'completed',
            message: 'All benchmark tests completed',
            progress: 100
        });
    }

    // Run a single oha test
    async runSingleOhaTest(url, config, broadcast) {
        return new Promise(async (resolve, reject) => {
            const { spawn } = await import('child_process');
            
            // oha command with TUI output (we'll strip ANSI codes)
            const args = [
                '-z', `${config.duration}s`,  // Duration
                '-c', config.users.toString(), // Concurrent connections
                url
            ];

            const oha = spawn('oha', args, {
                env: { 
                    ...process.env, 
                    TERM: 'xterm-256color',
                    COLUMNS: '80',
                    LINES: '24'
                }
            });
            let output = '';
            let errorOutput = '';

            // Function to strip ANSI escape sequences
            const stripAnsi = (str) => {
                return str.replace(/\x1b\[[0-9;]*[mGKH]/g, '').replace(/\x1b\[2J/g, '').replace(/\x1b\[\?25[lh]/g, '');
            };

            oha.stdout.on('data', (data) => {
                const chunk = data.toString();
                const cleanChunk = stripAnsi(chunk);
                output += cleanChunk;
                
                // Broadcast cleaned incremental updates
                const lines = cleanChunk.split('\n').filter(line => line.trim());
                for (const line of lines) {
                    broadcast({
                        status: 'progress',
                        message: line.trim(),
                        rawOutput: line.trim()
                    });
                }
            });

            oha.stderr.on('data', (data) => {
                const chunk = data.toString();
                const cleanChunk = stripAnsi(chunk);
                errorOutput += cleanChunk;
                
                // Parse progress information from cleaned stderr
                const lines = cleanChunk.split('\n').filter(line => line.trim());
                for (const line of lines) {
                    broadcast({
                        status: 'progress', 
                        message: line.trim(),
                        rawOutput: line.trim()
                    });
                }
            });

            oha.on('close', (code) => {
                if (code === 0) {
                    try {
                        // Parse text output from oha
                        const textOutput = output + errorOutput;
                        
                        // Extract basic metrics from text output
                        const requestsMatch = textOutput.match(/(\d+)\s+requests?\s+in/i);
                        const averageMatch = textOutput.match(/Average[:\s]+([\d.]+)\s*secs?/i);
                        const requestsPerSecMatch = textOutput.match(/Requests\/sec[:\s]+([\d.]+)/i);
                        const status200Match = textOutput.match(/\[200\]\s+(\d+)\s+responses?/i);
                        
                        const result = {
                            url,
                            summary: {
                                total: requestsMatch ? parseInt(requestsMatch[1]) : 0,
                                average: averageMatch ? parseFloat(averageMatch[1]) : 0,
                                requestsPerSecond: requestsPerSecMatch ? parseFloat(requestsPerSecMatch[1]) : 0,
                                successful: status200Match ? parseInt(status200Match[1]) : 0
                            },
                            rawOutput: textOutput
                        };
                        
                        broadcast({
                            status: 'endpoint_completed',
                            message: `Completed test for ${url}`,
                            result
                        });
                        resolve(result);
                    } catch (parseError) {
                        broadcast({
                            status: 'parse_error',
                            message: `Failed to parse results for ${url}`,
                            rawOutput: output,
                            error: parseError.message
                        });
                        resolve({ error: parseError.message, rawOutput: output });
                    }
                } else {
                    const error = new Error(`oha process exited with code ${code}: ${errorOutput}`);
                    broadcast({
                        status: 'error',
                        message: `oha failed for ${url}`,
                        error: error.message,
                        exitCode: code
                    });
                    reject(error);
                }
            });

            oha.on('error', (error) => {
                broadcast({
                    status: 'error',
                    message: `Failed to start oha: ${error.message}. Please ensure oha is installed.`,
                    error: error.message
                });
                reject(error);
            });
        });
    }

    // GET /api/performance/memory - Get detailed memory usage  
    async getMemory(request) {
        try {
            const memUsage = process.memoryUsage();
            
            return Response.json({
                runtime: 'bun',
                timestamp: new Date().toISOString(),
                memory: {
                    rss: Math.round(memUsage.rss / 1024 / 1024 * 100) / 100, // MB
                    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024 * 100) / 100, // MB  
                    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024 * 100) / 100, // MB
                    external: Math.round(memUsage.external / 1024 / 1024 * 100) / 100, // MB
                    arrayBuffers: Math.round(memUsage.arrayBuffers / 1024 / 1024 * 100) / 100 // MB
                },
                uptime: Math.round(process.uptime()),
                platform: process.platform,
                bunVersion: Bun.version,
                bunRevision: Bun.revision
            });
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
        }
    }

    // GET /api/performance/endpoints - Get endpoint performance stats
    async getEndpoints(request) {
        try {
            const url = new URL(request.url);
            const hours = parseInt(url.searchParams.get('hours')) || 24;
            
            const result = await db.sql`
                SELECT 
                    endpoint,
                    COUNT(*) as total_requests,
                    AVG(response_time_ms) as avg_response_time,
                    MIN(response_time_ms) as min_response_time,
                    MAX(response_time_ms) as max_response_time,
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY response_time_ms) as median_response_time,
                    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) as p95_response_time,
                    AVG(memory_usage_mb) as avg_memory_usage
                FROM performance_metrics 
                WHERE timestamp > NOW() - INTERVAL '${hours} hours'
                    AND runtime = ${process.env.RUNTIME_NAME || 'bun'}
                GROUP BY endpoint
                ORDER BY total_requests DESC
            `;
            
            return Response.json(result);
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
        }
    }
}

export default new PerformanceHandler();