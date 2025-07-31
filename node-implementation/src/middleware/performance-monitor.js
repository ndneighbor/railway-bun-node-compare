const db = require('../database/connection');

class PerformanceMonitor {
    constructor() {
        this.runtime = process.env.RUNTIME_NAME || 'node';
    }

    middleware() {
        const runtime = this.runtime;
        return async (req, res, next) => {
            const startTime = Date.now();
            const startMemory = process.memoryUsage();

            // Override res.end to capture response time
            const originalEnd = res.end;
            res.end = function(...args) {
                const endTime = Date.now();
                const endMemory = process.memoryUsage();
                const responseTime = endTime - startTime;
                const memoryUsage = (endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024; // MB

                // Store metrics asynchronously
                setImmediate(async () => {
                    try {
                        await db.query(
                            'INSERT INTO performance_metrics (runtime, endpoint, response_time_ms, memory_usage_mb) VALUES ($1, $2, $3, $4)',
                            [runtime, req.path, responseTime, memoryUsage]
                        );
                    } catch (error) {
                        console.error('Failed to store performance metrics:', error);
                    }
                });

                // Add performance headers
                res.setHeader('X-Response-Time', `${responseTime}ms`);
                res.setHeader('X-Memory-Usage', `${memoryUsage.toFixed(2)}MB`);
                res.setHeader('X-Runtime', runtime);

                originalEnd.apply(res, args);
            };

            next();
        };
    }

    async getMetrics(timeframe = '1 hour') {
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
            WHERE timestamp > NOW() - INTERVAL '${timeframe}'
            GROUP BY runtime, endpoint
            ORDER BY avg_response_time DESC
        `;
        
        const result = await db.query(query);
        return result.rows;
    }

    async getCurrentStats() {
        const memUsage = process.memoryUsage();
        return {
            runtime: this.runtime,
            pid: process.pid,
            uptime: process.uptime(),
            memory: {
                rss: Math.round(memUsage.rss / 1024 / 1024),
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
                external: Math.round(memUsage.external / 1024 / 1024)
            },
            cpu: process.cpuUsage()
        };
    }
}

module.exports = new PerformanceMonitor();