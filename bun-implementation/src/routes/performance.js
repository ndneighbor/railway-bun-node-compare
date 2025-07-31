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

    // POST /api/performance/benchmark - Trigger load test scenarios
    async benchmark(request) {
        try {
            const body = await request.json();
            const { scenario = 'light', duration = 60 } = body;
            
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

            // Simulate load testing (in a real implementation, this would use a proper load testing tool)
            const benchmarkResults = {
                scenario,
                config,
                startTime,
                status: 'running',
                id: `benchmark_${Date.now()}`
            };

            // Store benchmark start
            await db.sql`
                INSERT INTO performance_metrics (runtime, endpoint, response_time_ms, memory_usage_mb) 
                VALUES (${process.env.RUNTIME_NAME || 'bun'}, ${`/benchmark/${scenario}`}, ${0}, ${process.memoryUsage().heapUsed / 1024 / 1024})
            `;

            // In a real implementation, you would start the actual load test here
            // For this demo, we'll return the configuration and suggest using external tools
            return Response.json({
                ...benchmarkResults,
                message: 'Benchmark initiated. Use external load testing tools like wrk, artillery, or k6 for actual load testing.',
                suggested_command: `wrk -t${config.users} -c${config.users} -d${config.duration}s --timeout 10s http://localhost:${process.env.PORT || 3000}${config.endpoints[0]}`
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