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
            const { duration = 5000, intensity = 1, memoryIntensive = false } = body;
            
            const startTime = Date.now();
            const endTime = startTime + duration;
            
            if (memoryIntensive) {
                // Memory intensive task - create large data structures
                const largeDataSet = [];
                let count = 0;
                
                while (Date.now() < endTime) {
                    // Create complex nested objects with strings and arrays
                    largeDataSet.push({
                        id: count,
                        data: 'x'.repeat(1000 * intensity), // Large strings
                        nested: Array.from({ length: 100 * intensity }, (_, i) => ({
                            index: i,
                            value: Math.random(),
                            text: `item_${i}_`.repeat(50 * intensity),
                            subArray: Array.from({ length: 10 * intensity }, () => Math.random())
                        })),
                        timestamp: Date.now(),
                        metadata: {
                            source: 'stress-test',
                            version: 1,
                            tags: Array.from({ length: 50 * intensity }, (_, i) => `tag_${i}`)
                        }
                    });
                    
                    count++;
                    
                    // Periodically clear some data to simulate real-world memory management
                    if (count % (100 * intensity) === 0) {
                        // Remove oldest entries to prevent unbounded growth
                        if (largeDataSet.length > 50 * intensity) {
                            largeDataSet.splice(0, 25 * intensity);
                        }
                    }
                }
                
                return Response.json({
                    message: 'Memory intensive stress test completed',
                    duration: Date.now() - startTime,
                    objectsCreated: count,
                    memoryAfter: process.memoryUsage(),
                    runtime: 'bun'
                });
            } else {
                // CPU intensive task (original)
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
                    message: 'CPU intensive stress test completed',
                    duration: actualDuration,
                    operations,
                    operationsPerSecond: Math.round(operations / (actualDuration / 1000)),
                    memoryAfter: process.memoryUsage(),
                    runtime: 'bun'
                });
            }
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

    // POST /api/system/memory-stress - Advanced memory stress test
    async memoryStress(request) {
        try {
            const body = await request.json();
            const { 
                objectCount = 10000, 
                objectSize = 1000,
                duration = 30000,
                gcInterval = 5000
            } = body;
            
            const startTime = Date.now();
            const endTime = startTime + duration;
            let totalObjectsCreated = 0;
            let peakMemory = 0;
            
            // Create objects in batches
            const batchSize = 1000;
            const batches = Math.ceil(objectCount / batchSize);
            
            for (let batch = 0; batch < batches && Date.now() < endTime; batch++) {
                const currentBatchSize = Math.min(batchSize, objectCount - (batch * batchSize));
                
                // Create complex objects with various data types
                const batchObjects = Array.from({ length: currentBatchSize }, (_, i) => ({
                    id: totalObjectsCreated + i,
                    // Large string data
                    content: 'a'.repeat(objectSize),
                    // Large array data
                    dataArray: Array.from({ length: objectSize / 10 }, (_, j) => ({
                        index: j,
                        value: Math.random(),
                        nestedContent: 'b'.repeat(50),
                        timestamp: Date.now()
                    })),
                    // Object with many properties
                    properties: Object.fromEntries(
                        Array.from({ length: 100 }, (_, k) => [`prop_${k}`, `value_${k}_`.repeat(20)])
                    ),
                    createdAt: new Date().toISOString()
                }));
                
                totalObjectsCreated += currentBatchSize;
                
                // Update peak memory
                const currentMemory = process.memoryUsage().heapUsed;
                if (currentMemory > peakMemory) {
                    peakMemory = currentMemory;
                }
                
                // Periodic garbage collection
                if (global.gc && (batch + 1) % Math.floor(gcInterval / 1000) === 0) {
                    global.gc();
                }
                
                // Small delay to allow for memory monitoring
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            // Force final garbage collection
            if (global.gc) {
                global.gc();
            }
            
            const finalMemory = process.memoryUsage();
            
            return Response.json({
                message: 'Advanced memory stress test completed',
                runtime: 'bun',
                duration: Date.now() - startTime,
                objectsCreated: totalObjectsCreated,
                peakMemory: Math.round(peakMemory / 1024 / 1024),
                finalMemory: {
                    heapUsed: Math.round(finalMemory.heapUsed / 1024 / 1024),
                    heapTotal: Math.round(finalMemory.heapTotal / 1024 / 1024),
                    rss: Math.round(finalMemory.rss / 1024 / 1024)
                },
                memoryEfficiency: ((peakMemory - finalMemory.heapUsed) / peakMemory * 100).toFixed(2)
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
