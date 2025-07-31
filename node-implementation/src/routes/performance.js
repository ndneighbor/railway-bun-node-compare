const express = require('express');
const db = require('../database/connection');
const performanceMonitor = require('../middleware/performance-monitor');
const router = express.Router();

// GET /api/performance/metrics - Get current runtime metrics
router.get('/metrics', async (req, res, next) => {
    try {
        const timeframe = req.query.timeframe || '1 hour';
        const metrics = await performanceMonitor.getMetrics(timeframe);
        const currentStats = await performanceMonitor.getCurrentStats();

        res.json({
            current: currentStats,
            metrics,
            timeframe
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/performance/history - Get historical performance data
router.get('/history', async (req, res, next) => {
    try {
        const { runtime, hours = 24 } = req.query;
        const hoursNum = Math.min(parseInt(hours), 168); // Max 1 week

        let query = `
            SELECT 
                DATE_TRUNC('hour', timestamp) as hour,
                runtime,
                AVG(response_time_ms) as avg_response_time,
                MIN(response_time_ms) as min_response_time,
                MAX(response_time_ms) as max_response_time,
                AVG(memory_usage_mb) as avg_memory_usage,
                COUNT(*) as request_count
            FROM performance_metrics 
            WHERE timestamp > NOW() - INTERVAL '${hoursNum} hours'
        `;

        const params = [];
        if (runtime) {
            query += ' AND runtime = $1';
            params.push(runtime);
        }

        query += `
            GROUP BY DATE_TRUNC('hour', timestamp), runtime
            ORDER BY hour DESC, runtime
        `;

        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (error) {
        next(error);
    }
});

// GET /api/performance/compare - Compare with other runtime
router.get('/compare', async (req, res, next) => {
    try {
        const { hours = 1 } = req.query;
        const comparisonUrl = process.env.COMPARISON_SERVICE_URL;

        // Get current runtime metrics
        const currentRuntime = process.env.RUNTIME_NAME || 'node';
        const query = `
            SELECT 
                runtime,
                endpoint,
                AVG(response_time_ms) as avg_response_time,
                MIN(response_time_ms) as min_response_time,
                MAX(response_time_ms) as max_response_time,
                AVG(memory_usage_mb) as avg_memory_usage,
                COUNT(*) as request_count
            FROM performance_metrics 
            WHERE timestamp > NOW() - INTERVAL '${parseInt(hours)} hours'
            GROUP BY runtime, endpoint
            ORDER BY runtime, endpoint
        `;

        const result = await db.query(query);
        const localMetrics = result.rows;

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

        res.json(comparison);
    } catch (error) {
        next(error);
    }
});

// POST /api/performance/benchmark - Trigger load test scenarios
router.post('/benchmark', async (req, res, next) => {
    try {
        const { scenario = 'light', duration = 60 } = req.body;
        
        const scenarios = {
            startup: { users: 1, duration: 10, endpoints: ['/api/health'] },
            light: { users: 10, duration: 60, endpoints: ['/api/books', '/api/authors', '/api/search?q=test'] },
            medium: { users: 50, duration: 120, endpoints: ['/api/books', '/api/authors', '/api/search?q=test', '/api/books/1'] },
            heavy: { users: 100, duration: 180, endpoints: ['/api/books', '/api/authors', '/api/search?q=test', '/api/books/1', '/api/authors/1'] },
            database: { users: 20, duration: 60, endpoints: ['/api/books?page=1&limit=50', '/api/search?q=long+query+with+filters&genre=Fiction'] },
            mixed: { users: 30, duration: 120, endpoints: ['/api/books', '/api/orders', '/api/search?q=mixed'] }
        };

        if (!scenarios[scenario]) {
            return res.status(400).json({ 
                error: `Invalid scenario. Available: ${Object.keys(scenarios).join(', ')}` 
            });
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
        await db.query(
            'INSERT INTO performance_metrics (runtime, endpoint, response_time_ms, memory_usage_mb) VALUES ($1, $2, $3, $4)',
            [process.env.RUNTIME_NAME || 'node', `/benchmark/${scenario}`, 0, process.memoryUsage().heapUsed / 1024 / 1024]
        );

        // In a real implementation, you would start the actual load test here
        // For this demo, we'll return the configuration and suggest using external tools
        res.json({
            ...benchmarkResults,
            message: 'Benchmark initiated. Use external load testing tools like wrk, artillery, or k6 for actual load testing.',
            suggested_command: `wrk -t${config.users} -c${config.users} -d${config.duration}s --timeout 10s http://localhost:${process.env.PORT || 3000}${config.endpoints[0]}`
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/performance/endpoints - Get endpoint performance stats
router.get('/endpoints', async (req, res, next) => {
    try {
        const { hours = 24 } = req.query;
        
        const query = `
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
            WHERE timestamp > NOW() - INTERVAL '${parseInt(hours)} hours'
                AND runtime = $1
            GROUP BY endpoint
            ORDER BY total_requests DESC
        `;

        const result = await db.query(query, [process.env.RUNTIME_NAME || 'node']);
        res.json(result.rows);
    } catch (error) {
        next(error);
    }
});

module.exports = router;