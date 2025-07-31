export class SystemHandler {
    // GET /api/system/metrics - Get detailed system metrics
    async getMetrics(request) {
        try {
            const memUsage = process.memoryUsage();
            const cpuUsage = process.cpuUsage();
            
            return Response.json({
                timestamp: new Date().toISOString(),
                runtime: process.env.RUNTIME_NAME || 'bun',
                process: {
                    pid: process.pid,
                    uptime: process.uptime(),
                    version: process.version,
                    platform: process.platform,
                    arch: process.arch
                },
                memory: {
                    rss: Math.round(memUsage.rss / 1024 / 1024), // MB
                    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
                    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
                    external: Math.round(memUsage.external / 1024 / 1024), // MB
                    arrayBuffers: Math.round((memUsage.arrayBuffers || 0) / 1024 / 1024) // MB
                },
                cpu: {
                    user: cpuUsage.user,
                    system: cpuUsage.system,
                    percentage: this.getCpuPercentage()
                },
                system: {
                    totalMemory: Math.round(this.getTotalMemory() / 1024 / 1024), // MB
                    freeMemory: Math.round(this.getFreeMemory() / 1024 / 1024), // MB
                    loadAverage: this.getLoadAverage(),
                    cpuCount: this.getCpuCount(),
                    hostname: this.getHostname(),
                    type: this.getSystemType(),
                    release: this.getSystemRelease()
                },
                gc: this.getGCStats(),
                bun: {
                    version: Bun?.version || 'unknown',
                    revision: Bun?.revision || 'unknown'
                }
            });
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
        }
    }

    // POST /api/system/stress-test - Run a CPU intensive task for testing
    async stressTest(request) {
        try {
            const body = await request.json();
            const { duration = 5000, intensity = 1 } = body;
            
            const startTime = Date.now();
            const endTime = startTime + duration;
            
            // CPU intensive task
            const stressTest = () => {
                let count = 0;
                while (Date.now() < endTime && count < intensity * 1000000) {
                    Math.sqrt(Math.random() * 1000000);
                    count++;
                }
                return count;
            };
            
            const operations = stressTest();
            const actualDuration = Date.now() - startTime;
            
            return Response.json({
                message: 'Stress test completed',
                duration: actualDuration,
                operations,
                operationsPerSecond: Math.round(operations / (actualDuration / 1000)),
                memoryAfter: process.memoryUsage(),
                runtime: 'bun'
            });
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
        }
    }

    // POST /api/system/heap-dump - Trigger garbage collection and get memory info
    async heapDump(request) {
        try {
            // Force garbage collection if available
            if (global.gc) {
                global.gc();
            }
            
            const memBefore = process.memoryUsage();
            
            // Create some temporary objects to test GC
            const testObjects = Array(10000).fill().map((_, i) => ({ id: i, data: 'x'.repeat(100) }));
            
            const memDuring = process.memoryUsage();
            
            // Clear the objects
            testObjects.length = 0;
            
            // Force GC again if available
            if (global.gc) {
                global.gc();
            }
            
            const memAfter = process.memoryUsage();
            
            return Response.json({
                message: 'Heap dump analysis completed',
                memory: {
                    before: {
                        heapUsed: Math.round(memBefore.heapUsed / 1024 / 1024),
                        heapTotal: Math.round(memBefore.heapTotal / 1024 / 1024)
                    },
                    during: {
                        heapUsed: Math.round(memDuring.heapUsed / 1024 / 1024),
                        heapTotal: Math.round(memDuring.heapTotal / 1024 / 1024)
                    },
                    after: {
                        heapUsed: Math.round(memAfter.heapUsed / 1024 / 1024),
                        heapTotal: Math.round(memAfter.heapTotal / 1024 / 1024)
                    }
                },
                gcAvailable: !!global.gc,
                runtime: 'bun'
            });
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
        }
    }

    // Helper methods for system information
    getCpuPercentage() {
        // Simplified CPU percentage - would need more sophisticated tracking in production
        return process._lastCpuPercentage || 0;
    }

    getTotalMemory() {
        // Try to get system memory info (may not be available in all environments)
        try {
            return require('os').totalmem?.() || 0;
        } catch {
            return 0;
        }
    }

    getFreeMemory() {
        try {
            return require('os').freemem?.() || 0;
        } catch {
            return 0;
        }
    }

    getLoadAverage() {
        try {
            const loadavg = require('os').loadavg?.() || [0, 0, 0];
            return {
                '1min': loadavg[0],
                '5min': loadavg[1],
                '15min': loadavg[2]
            };
        } catch {
            return { '1min': 0, '5min': 0, '15min': 0 };
        }
    }

    getCpuCount() {
        try {
            return require('os').cpus?.()?.length || 1;
        } catch {
            return 1;
        }
    }

    getHostname() {
        try {
            return require('os').hostname?.() || 'unknown';
        } catch {
            return 'unknown';
        }
    }

    getSystemType() {
        try {
            return require('os').type?.() || 'unknown';
        } catch {
            return 'unknown';
        }
    }

    getSystemRelease() {
        try {
            return require('os').release?.() || 'unknown';
        } catch {
            return 'unknown';
        }
    }

    getGCStats() {
        try {
            const stats = {
                available: !!global.gc,
                nodeGC: !!global.gc
            };

            if (process.getActiveResourcesInfo) {
                stats.activeHandles = process.getActiveResourcesInfo();
            }

            return stats;
        } catch (error) {
            return {
                available: false,
                error: error.message,
                note: 'System information may be limited in this environment'
            };
        }
    }
}

export default new SystemHandler();