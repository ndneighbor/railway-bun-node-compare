import db from '../database/connection.js';

class PerformanceMonitor {
    constructor() {
        this.runtime = process.env.RUNTIME_NAME || 'bun';
    }

    middleware() {
        return async (req, context) => {
            const startTime = Date.now();
            const startMemory = process.memoryUsage();

            // Store original response handler
            const originalHandler = context.handler;
            
            context.handler = async (...args) => {
                const result = await originalHandler(...args);
                
                const endTime = Date.now();
                const endMemory = process.memoryUsage();
                const responseTime = endTime - startTime;
                const memoryUsage = (endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024; // MB

                // Store metrics asynchronously
                setImmediate(async () => {
                    try {
                        await db.sql`
                            INSERT INTO performance_metrics (runtime, endpoint, response_time_ms, memory_usage_mb) 
                            VALUES (${this.runtime}, ${req.url.pathname}, ${responseTime}, ${memoryUsage})
                        `;
                    } catch (error) {
                        console.error('Failed to store performance metrics:', error);
                    }
                });

                // Add performance headers if result is a Response
                if (result instanceof Response) {
                    result.headers.set('X-Response-Time', `${responseTime}ms`);
                    result.headers.set('X-Memory-Usage', `${memoryUsage.toFixed(2)}MB`);
                    result.headers.set('X-Runtime', this.runtime);
                }

                return result;
            };

            return context;
        };
    }

    async getMetrics(timeframe = '1 hour') {
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
            WHERE timestamp > NOW() - INTERVAL ${timeframe}
            GROUP BY runtime, endpoint
            ORDER BY avg_response_time DESC
        `;
        
        return result;
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

export default new PerformanceMonitor();