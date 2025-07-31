const express = require('express');
const os = require('os');
const router = express.Router();

// GET /api/system/metrics - Get detailed system metrics
router.get('/metrics', (req, res) => {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const loadAverage = os.loadavg();
    
    res.json({
        timestamp: new Date().toISOString(),
        runtime: process.env.RUNTIME_NAME || 'node',
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
            percentage: getCpuPercentage()
        },
        system: {
            totalMemory: Math.round(os.totalmem() / 1024 / 1024), // MB
            freeMemory: Math.round(os.freemem() / 1024 / 1024), // MB
            loadAverage: {
                '1min': loadAverage[0],
                '5min': loadAverage[1],
                '15min': loadAverage[2]
            },
            cpuCount: os.cpus().length,
            hostname: os.hostname(),
            type: os.type(),
            release: os.release()
        },
        gc: getGCStats()
    });
});

// GET /api/system/stress-test - Run a CPU intensive task for testing
router.post('/stress-test', (req, res) => {
    const { duration = 5000, intensity = 1 } = req.body;
    
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
    
    res.json({
        message: 'Stress test completed',
        duration: actualDuration,
        operations,
        operationsPerSecond: Math.round(operations / (actualDuration / 1000)),
        memoryAfter: process.memoryUsage()
    });
});

// GET /api/system/heap-dump - Trigger garbage collection and get memory info
router.post('/heap-dump', (req, res) => {
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
    
    res.json({
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
        gcAvailable: !!global.gc
    });
});

// Helper function to get CPU percentage (approximation)
function getCpuPercentage() {
    const startUsage = process.cpuUsage();
    const startTime = Date.now();
    
    // This is a simplified CPU percentage calculation
    // In a real implementation, you'd want to track this over time
    setTimeout(() => {
        const endUsage = process.cpuUsage(startUsage);
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        // Store for next request (simplified)
        process._lastCpuPercentage = ((endUsage.user + endUsage.system) / 1000) / duration * 100;
    }, 100);
    
    return process._lastCpuPercentage || 0;
}

// Helper function to get GC stats (if available)
function getGCStats() {
    try {
        if (process.getActiveResourcesInfo) {
            return {
                activeHandles: process.getActiveResourcesInfo(),
                activeRequests: process._getActiveRequests ? process._getActiveRequests().length : 0
            };
        }
    } catch (error) {
        // GC stats not available
    }
    
    return {
        available: false,
        note: 'Start Node.js with --expose-gc for detailed GC statistics'
    };
}

module.exports = router;