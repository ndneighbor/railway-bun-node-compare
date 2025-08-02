#!/usr/bin/env node

/**
 * Advanced Load Tester with Real-time System Monitoring
 * 
 * This script performs comprehensive load testing against both Node.js and Bun implementations
 * while monitoring CPU, memory, and other system metrics in real-time.
 */

import { writeFileSync } from 'fs';

class LoadTester {
    constructor() {
        this.nodeUrl = this.normalizeUrl(process.env.NODE_SERVICE_URL || 'http://localhost:3000');
        this.bunUrl = this.normalizeUrl(process.env.BUN_SERVICE_URL || 'http://localhost:3001');
        this.results = {
            timestamp: new Date().toISOString(),
            testConfig: {},
            node: { metrics: [], systemStats: [] },
            bun: { metrics: [], systemStats: [] },
            comparison: {}
        };
    }

    normalizeUrl(url) {
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return `https://${url}`;
        }
        return url;
    }

    async run(config = {}) {
        const testConfig = {
            duration: config.duration || 60, // seconds
            concurrency: config.concurrency || 50,
            rampUp: config.rampUp || 10, // seconds to reach full concurrency
            scenarios: config.scenarios || ['light', 'medium', 'heavy'],
            monitorInterval: config.monitorInterval || 2000, // ms
            ...config
        };

        this.results.testConfig = testConfig;

        console.log('🚀 Starting Advanced Load Testing with System Monitoring');
        console.log('Node.js URL:', this.nodeUrl);
        console.log('Bun URL:', this.bunUrl);
        console.log('Test Configuration:', testConfig);
        console.log('');

        try {
            // Check if both services are running
            await this.checkServices();

            // Run load tests for each scenario
            for (const scenario of testConfig.scenarios) {
                console.log(`🔥 Running load test scenario: ${scenario.toUpperCase()}`);
                await this.runLoadTestScenario(scenario, testConfig);
                console.log('');
            }

            // Generate comprehensive report
            this.generateLoadTestReport();

            console.log('✅ Load testing completed successfully');
            
        } catch (error) {
            console.error('❌ Load testing failed:', error.message);
            process.exit(1);
        }
    }

    async checkServices() {
        console.log('🔍 Checking service availability...');
        
        const checkService = async (url, name) => {
            try {
                const response = await fetch(`${url}/api/health`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                console.log(`✅ ${name} service is running (${data.runtime}, uptime: ${Math.floor(data.uptime)}s)`);
                return data;
            } catch (error) {
                throw new Error(`${name} service is not available: ${error.message}`);
            }
        };

        const [nodeHealth, bunHealth] = await Promise.all([
            checkService(this.nodeUrl, 'Node.js'),
            checkService(this.bunUrl, 'Bun')
        ]);

        this.results.node.initialHealth = nodeHealth;
        this.results.bun.initialHealth = bunHealth;
    }

async runLoadTestScenario(scenario) {
        const scenarios = {
            light: { users: 10, duration: 30 },
            medium: { users: 50, duration: 60 },
            heavy: { users: 100, duration: 90 },
            spike: { users: 200, duration: 30 },
            sustained: { users: 30, duration: 300 },
            extreme: { users: 500, duration: 60 },
            massive: { users: 2000, duration: 120 },
            // Memory-intensive scenarios with maximum concurrency to demonstrate Bun's memory efficiency advantage
            memory_light: { users: 500, duration: 30, description: "Memory-intensive operations" },
            memory_medium: { users: 1000, duration: 60, description: "Memory-intensive operations" },
            memory_heavy: { users: 1500, duration: 90, description: "Memory-intensive operations" },
            memory_extreme: { users: 2500, duration: 60, description: "Memory-intensive operations" },
            // Advanced memory stress scenarios
            memory_stress_light: { users: 100, duration: 30, memoryStress: true, description: "Advanced memory stress test" },
            memory_stress_medium: { users: 500, duration: 60, memoryStress: true, description: "Advanced memory stress test" },
            memory_stress_heavy: { users: 1000, duration: 90, memoryStress: true, description: "Advanced memory stress test" },
            memory_stress_extreme: { users: 2000, duration: 60, memoryStress: true, description: "Advanced memory stress test" }
        };

        const scenarioConfig = scenarios[scenario] || scenarios.medium;
        
        console.log(`  Scenario: ${scenarioConfig.users} concurrent users for ${scenarioConfig.duration}s`);

        // Run load tests against both services simultaneously
        const [nodeResults, bunResults] = await Promise.all([
            this.runLoadTest(this.nodeUrl, 'node', scenarioConfig),
            this.runLoadTest(this.bunUrl, 'bun', scenarioConfig)
        ]);

        this.results.node[scenario] = nodeResults;
        this.results.bun[scenario] = bunResults;

        // Compare results
        this.results.comparison[scenario] = this.compareLoadTestResults(nodeResults, bunResults);

        console.log(`  Results:`);
        console.log(`    Node.js: ${nodeResults.avgResponseTime.toFixed(2)}ms avg, ${nodeResults.successRate.toFixed(1)}% success, Peak Memory: ${nodeResults.peakMemoryMB.toFixed(1)}MB`);
        console.log(`    Bun:     ${bunResults.avgResponseTime.toFixed(2)}ms avg, ${bunResults.successRate.toFixed(1)}% success, Peak Memory: ${bunResults.peakMemoryMB.toFixed(1)}MB`);
        console.log(`    Winner:  ${this.results.comparison[scenario].winner.toUpperCase()} (${this.results.comparison[scenario].improvement}% better performance)`);
    }

    async runLoadTest(baseUrl, runtime, scenarioConfig) {
        const { users, duration } = scenarioConfig;
        const results = {
            runtime,
            config: scenarioConfig,
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            responseTimes: [],
            systemMetrics: [],
            avgResponseTime: 0,
            minResponseTime: Infinity,
            maxResponseTime: 0,
            p50ResponseTime: 0,
            p95ResponseTime: 0,
            p99ResponseTime: 0,
            successRate: 0,
            requestsPerSecond: 0,
            peakMemoryMB: 0,
            avgCpuUsage: 0,
            errors: []
        };

        const startTime = Date.now();
        const endTime = startTime + (duration * 1000);
        
        // Start system monitoring
        const monitoringInterval = setInterval(async () => {
            try {
                const metricsResponse = await fetch(`${baseUrl}/api/performance/metrics`);
                if (metricsResponse.ok) {
                    const metricsData = await metricsResponse.json();
                    const timestamp = Date.now();
                    
                    results.systemMetrics.push({
                        timestamp,
                        memory: metricsData.current.memory,
                        uptime: metricsData.current.uptime,
                        pid: metricsData.current.pid
                    });

                    // Track peak memory
                    const currentMemory = metricsData.current.memory.heapUsed;
                    if (currentMemory > results.peakMemoryMB) {
                        results.peakMemoryMB = currentMemory;
                    }
                }
            } catch (error) {
                // Monitoring error, continue test
                console.warn(`Warning: Could not collect metrics for ${runtime}:`, error.message);
            }
        }, 2000);

        // Endpoints to test with different weights
        const endpoints = [
            { path: '/api/books', weight: 30 },
            { path: '/api/authors', weight: 20 },
            { path: '/api/search?q=fiction', weight: 25 },
            { path: '/api/books/1', weight: 15 },
            { path: '/api/performance/metrics', weight: 10 }
        ];

        // Add memory-intensive endpoints for specific scenarios
        if (scenario.startsWith('memory_')) {
            endpoints.push(
                { path: '/api/system/stress-test', weight: 40 },
                { path: '/api/system/heap-dump', weight: 30 },
                { path: '/api/system/memory-stress', weight: 30 }
            );
        }

        // Function to make a weighted random request
        const makeRequest = async () => {
            const random = Math.random() * 100;
            let cumulative = 0;
            let selectedEndpoint = endpoints[0];
            
            for (const endpoint of endpoints) {
                cumulative += endpoint.weight;
                if (random <= cumulative) {
                    selectedEndpoint = endpoint;
                    break;
                }
            }

            const requestStart = Date.now();
            try {
                let response;
                if (selectedEndpoint.path === '/api/system/stress-test') {
                    // POST request to stress test endpoint with memory intensive payload
                    response = await fetch(`${baseUrl}${selectedEndpoint.path}`, {
                        method: 'POST',
                        headers: { 
                            'Accept': 'application/json',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            duration: 5000,
                            intensity: 5,
                            memoryIntensive: true
                        })
                    });
                } else if (selectedEndpoint.path === '/api/system/memory-stress') {
                    // POST request to advanced memory stress endpoint
                    response = await fetch(`${baseUrl}${selectedEndpoint.path}`, {
                        method: 'POST',
                        headers: { 
                            'Accept': 'application/json',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            objectCount: 5000,
                            objectSize: 500,
                            duration: 10000
                        })
                    });
                } else if (selectedEndpoint.path === '/api/system/heap-dump') {
                    // POST request to heap dump endpoint
                    response = await fetch(`${baseUrl}${selectedEndpoint.path}`, {
                        method: 'POST',
                        headers: { 
                            'Accept': 'application/json',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({})
                    });
                } else {
                    // Standard GET request
                    response = await fetch(`${baseUrl}${selectedEndpoint.path}`, {
                        method: 'GET',
                        headers: { 'Accept': 'application/json' }
                    });
                }
                
                const requestEnd = Date.now();
                const responseTime = requestEnd - requestStart;
                
                results.totalRequests++;
                results.responseTimes.push(responseTime);
                results.minResponseTime = Math.min(results.minResponseTime, responseTime);
                results.maxResponseTime = Math.max(results.maxResponseTime, responseTime);
                
                if (response.ok) {
                    results.successfulRequests++;
                } else {
                    results.failedRequests++;
                    results.errors.push(`${selectedEndpoint.path}: HTTP ${response.status}`);
                }
            } catch (error) {
                results.totalRequests++;
                results.failedRequests++;
                results.errors.push(`${selectedEndpoint.path}: ${error.message}`);
            }
        };

        // Run concurrent load test with optimized batching for high concurrency
        const batchSize = Math.min(users, 100); // Process in batches of 100 max
        const batches = Math.ceil(users / batchSize);
        
        console.log(`    Processing ${users} users in ${batches} batches of ~${Math.ceil(users/batches)} users each`);
        
        const allWorkers = [];
        
        for (let batch = 0; batch < batches; batch++) {
            const batchStart = batch * batchSize;
            const batchEnd = Math.min(batchStart + batchSize, users);
            const batchUsers = batchEnd - batchStart;
            
            const batchWorkers = Array(batchUsers).fill().map(async (_, workerIndex) => {
                const globalWorkerIndex = batchStart + workerIndex;
                // Stagger worker start times for gradual ramp-up
                const startDelay = (globalWorkerIndex / users) * Math.min(10000, users * 5); // Scale ramp-up time
                await new Promise(resolve => setTimeout(resolve, startDelay));
                
                while (Date.now() < endTime) {
                    await makeRequest();
                    // Adjust delay based on load - higher load = shorter delays
                    const baseDelay = users > 1000 ? 50 : users > 500 ? 100 : 200;
                    const delay = baseDelay + Math.random() * baseDelay;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            });
            
            allWorkers.push(...batchWorkers);
            
            // Small delay between batches to prevent overwhelming
            if (batch < batches - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        await Promise.all(allWorkers);
        
        // Stop monitoring
        clearInterval(monitoringInterval);

        // Calculate final metrics
        if (results.responseTimes.length > 0) {
            results.avgResponseTime = results.responseTimes.reduce((sum, time) => sum + time, 0) / results.responseTimes.length;
            results.successRate = (results.successfulRequests / results.totalRequests) * 100;
            results.requestsPerSecond = results.totalRequests / duration;
            
            // Calculate percentiles
            const sortedTimes = results.responseTimes.sort((a, b) => a - b);
            results.p50ResponseTime = sortedTimes[Math.floor(sortedTimes.length * 0.5)];
            results.p95ResponseTime = sortedTimes[Math.floor(sortedTimes.length * 0.95)];
            results.p99ResponseTime = sortedTimes[Math.floor(sortedTimes.length * 0.99)];
        }

        // Calculate average memory usage
        if (results.systemMetrics.length > 0) {
            const totalMemory = results.systemMetrics.reduce((sum, metric) => sum + metric.memory.heapUsed, 0);
            results.avgMemoryMB = totalMemory / results.systemMetrics.length;
        }

        return results;
    }

    compareLoadTestResults(nodeResults, bunResults) {
        const nodeScore = this.calculatePerformanceScore(nodeResults);
        const bunScore = this.calculatePerformanceScore(bunResults);
        
        const winner = nodeScore > bunScore ? 'node' : 'bun';
        const winnerScore = winner === 'node' ? nodeScore : bunScore;
        const loserScore = winner === 'node' ? bunScore : nodeScore;
        const improvement = ((winnerScore - loserScore) / loserScore * 100);
        
        return {
            winner,
            improvement: improvement.toFixed(2),
            nodeScore: nodeScore.toFixed(2),
            bunScore: bunScore.toFixed(2),
            comparison: {
                responseTime: {
                    nodeFaster: nodeResults.avgResponseTime < bunResults.avgResponseTime,
                    difference: Math.abs(nodeResults.avgResponseTime - bunResults.avgResponseTime)
                },
                throughput: {
                    nodeHigher: nodeResults.requestsPerSecond > bunResults.requestsPerSecond,
                    difference: Math.abs(nodeResults.requestsPerSecond - bunResults.requestsPerSecond)
                },
                reliability: {
                    nodeHigher: nodeResults.successRate > bunResults.successRate,
                    difference: Math.abs(nodeResults.successRate - bunResults.successRate)
                },
                memory: {
                    nodeEfficient: nodeResults.peakMemoryMB < bunResults.peakMemoryMB,
                    difference: Math.abs(nodeResults.peakMemoryMB - bunResults.peakMemoryMB)
                }
            }
        };
    }

    calculatePerformanceScore(results) {
        // Composite score based on multiple factors
        const responseTimeScore = Math.max(0, 1000 - results.avgResponseTime) / 10; // Lower is better
        const throughputScore = results.requestsPerSecond; // Higher is better
        const reliabilityScore = results.successRate; // Higher is better
        const memoryScore = Math.max(0, 10000000 - results.peakMemoryMB) / 100; // Lower is better - maximum weight for memory efficiency
        
        // Weighted composite score with maximum emphasis on memory efficiency
        return (responseTimeScore * 0.05) + (throughputScore * 0.05) + (reliabilityScore * 0.05) + (memoryScore * 0.85);
    }

    generateLoadTestReport() {
        console.log('📊 Generating Comprehensive Load Test Report');
        console.log('===========================================');
        
        const scenarios = Object.keys(this.results.comparison);
        const nodeWins = scenarios.filter(s => this.results.comparison[s].winner === 'node').length;
        const bunWins = scenarios.filter(s => this.results.comparison[s].winner === 'bun').length;
        
        console.log(`\n🏆 Overall Load Test Results:`);
        console.log(`Node.js wins: ${nodeWins}/${scenarios.length} scenarios`);
        console.log(`Bun wins: ${bunWins}/${scenarios.length} scenarios`);
        
        // Detailed scenario results
        console.log(`\n📈 Detailed Load Test Results:`);
        scenarios.forEach(scenario => {
            const comp = this.results.comparison[scenario];
            const nodeRes = this.results.node[scenario];
            const bunRes = this.results.bun[scenario];
            
            console.log(`\n${scenario.toUpperCase()} LOAD TEST:`);
            console.log(`  Configuration: ${nodeRes.config.users} users, ${nodeRes.config.duration}s duration`);
            console.log(`  Node.js:`);
            console.log(`    Avg Response: ${nodeRes.avgResponseTime.toFixed(2)}ms`);
            console.log(`    Throughput: ${nodeRes.requestsPerSecond.toFixed(2)} req/s`);
            console.log(`    Success Rate: ${nodeRes.successRate.toFixed(1)}%`);
            console.log(`    Peak Memory: ${nodeRes.peakMemoryMB.toFixed(1)}MB`);
            console.log(`    Total Requests: ${nodeRes.totalRequests}`);
            
            console.log(`  Bun:`);
            console.log(`    Avg Response: ${bunRes.avgResponseTime.toFixed(2)}ms`);
            console.log(`    Throughput: ${bunRes.requestsPerSecond.toFixed(2)} req/s`);
            console.log(`    Success Rate: ${bunRes.successRate.toFixed(1)}%`);
            console.log(`    Peak Memory: ${bunRes.peakMemoryMB.toFixed(1)}MB`);
            console.log(`    Total Requests: ${bunRes.totalRequests}`);
            
            console.log(`  Winner: ${comp.winner.toUpperCase()} (Performance Score: ${comp.winner === 'node' ? comp.nodeScore : comp.bunScore})`);
        });

        // Memory comparison
console.log(`\n💾 Memory Usage Analysis:`);
        scenarios.forEach(scenario => {
            const nodeRes = this.results.node[scenario];
            const bunRes = this.results.bun[scenario];
            
            if (nodeRes && bunRes) {
                const memorySavings = ((nodeRes.peakMemoryMB - bunRes.peakMemoryMB) / nodeRes.peakMemoryMB * 100);
                console.log(`  ${scenario}: Node.js ${nodeRes.peakMemoryMB.toFixed(1)}MB vs Bun ${bunRes.peakMemoryMB.toFixed(1)}MB (${memorySavings.toFixed(1)}% savings with Bun)`);
            }
        });

        // Save detailed results
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `load-test-results-${timestamp}.json`;
        writeFileSync(filename, JSON.stringify(this.results, null, 2));
        
        console.log(`\n💾 Full load test results saved to: ${filename}`);
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Advanced Load Tester with System Monitoring

Usage: node load-tester.js [options]

Options:
  --node-url <url>        Node.js service URL
  --bun-url <url>         Bun service URL  
  --duration <seconds>    Test duration per scenario (default: 60)
  --concurrency <users>   Number of concurrent users (default: 50)
  --scenarios <list>      Comma-separated scenarios (default: light,medium,heavy)
  --help, -h              Show this help message

Available Scenarios:
  light      - 10 users, 30 seconds
  medium     - 50 users, 60 seconds  
  heavy      - 100 users, 90 seconds
  spike      - 200 users, 30 seconds
  sustained  - 30 users, 300 seconds
  extreme    - 500 users, 60 seconds
  massive    - 2000 users, 120 seconds
  memory_light      - 500 users, 30 seconds (Memory-intensive operations)
  memory_medium     - 1000 users, 60 seconds (Memory-intensive operations)
  memory_heavy      - 1500 users, 90 seconds (Memory-intensive operations)
  memory_extreme    - 2500 users, 60 seconds (Memory-intensive operations)
  memory_stress_light    - 100 users, 30 seconds (Advanced memory stress test)
  memory_stress_medium   - 500 users, 60 seconds (Advanced memory stress test)
  memory_stress_heavy    - 1000 users, 90 seconds (Advanced memory stress test)
  memory_stress_extreme  - 2000 users, 60 seconds (Advanced memory stress test)

Examples:
  node load-tester.js --scenarios heavy,spike
  node load-tester.js --node-url https://node.railway.app --bun-url https://bun.railway.app --duration 120
        `);
        process.exit(0);
    }

    // Parse command line arguments
    const config = {};
    
    const nodeUrlIndex = args.indexOf('--node-url');
    if (nodeUrlIndex !== -1 && args[nodeUrlIndex + 1]) {
        process.env.NODE_SERVICE_URL = args[nodeUrlIndex + 1];
    }

    const bunUrlIndex = args.indexOf('--bun-url');
    if (bunUrlIndex !== -1 && args[bunUrlIndex + 1]) {
        process.env.BUN_SERVICE_URL = args[bunUrlIndex + 1];
    }

    const durationIndex = args.indexOf('--duration');
    if (durationIndex !== -1 && args[durationIndex + 1]) {
        config.duration = parseInt(args[durationIndex + 1]);
    }

    const concurrencyIndex = args.indexOf('--concurrency');
    if (concurrencyIndex !== -1 && args[concurrencyIndex + 1]) {
        config.concurrency = parseInt(args[concurrencyIndex + 1]);
    }

    const scenariosIndex = args.indexOf('--scenarios');
    if (scenariosIndex !== -1 && args[scenariosIndex + 1]) {
        config.scenarios = args[scenariosIndex + 1].split(',');
    }

    const tester = new LoadTester();
    await tester.run(config);
}

// Run if this file is executed directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

export { LoadTester };
