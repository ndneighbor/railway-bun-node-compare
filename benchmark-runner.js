#!/usr/bin/env node

/**
 * Cross-Implementation Benchmark Runner
 * 
 * This script runs performance benchmarks against both Node.js and Bun implementations
 * and provides comparative analysis of their performance characteristics.
 */

import { spawn } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

class BenchmarkRunner {
    constructor() {
        this.nodeUrl = this.normalizeUrl(process.env.NODE_SERVICE_URL || 'http://localhost:3000');
        this.bunUrl = this.normalizeUrl(process.env.BUN_SERVICE_URL || 'http://localhost:3001');
        this.results = {
            timestamp: new Date().toISOString(),
            node: {},
            bun: {},
            comparison: {}
        };
    }

    normalizeUrl(url) {
        // Add https:// if no protocol is specified
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return `https://${url}`;
        }
        return url;
    }

    async run() {
        console.log('🚀 Starting Cross-Implementation Benchmark');
        console.log('Node.js URL:', this.nodeUrl);
        console.log('Bun URL:', this.bunUrl);
        console.log('');

        try {
            // Check if both services are running
            await this.checkServices();

            // Run benchmarks
            await this.runBenchmarkSuite();

            // Generate comparison report
            this.generateReport();

            console.log('✅ Benchmark completed successfully');
            console.log('📊 Results saved to benchmark-results.json');
            
        } catch (error) {
            console.error('❌ Benchmark failed:', error.message);
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
                console.log(`✅ ${name} service is running (${data.runtime})`);
                return data;
            } catch (error) {
                throw new Error(`${name} service is not available at ${url}: ${error.message}`);
            }
        };

        const [nodeHealth, bunHealth] = await Promise.all([
            checkService(this.nodeUrl, 'Node.js'),
            checkService(this.bunUrl, 'Bun')
        ]);

        this.results.node.health = nodeHealth;
        this.results.bun.health = bunHealth;
        console.log('');
    }

    async runBenchmarkSuite() {
        const scenarios = [
            { name: 'health_check', endpoint: '/api/health', method: 'GET' },
            { name: 'books_list', endpoint: '/api/books?page=1&limit=20', method: 'GET' },
            { name: 'books_search', endpoint: '/api/search?q=fiction', method: 'GET' },
            { name: 'authors_list', endpoint: '/api/authors', method: 'GET' },
            { name: 'book_detail', endpoint: '/api/books/1', method: 'GET' },
            { name: 'performance_metrics', endpoint: '/api/performance/metrics', method: 'GET' }
        ];

        for (const scenario of scenarios) {
            console.log(`🧪 Running benchmark: ${scenario.name}`);
            
            // Run concurrent requests to both services
            const [nodeResult, bunResult] = await Promise.all([
                this.runScenario(this.nodeUrl, scenario, 'node'),
                this.runScenario(this.bunUrl, scenario, 'bun')
            ]);

            this.results.node[scenario.name] = nodeResult;
            this.results.bun[scenario.name] = bunResult;

            // Calculate comparison metrics
            this.results.comparison[scenario.name] = this.compareResults(nodeResult, bunResult);
            
            console.log(`  Node.js: ${nodeResult.avgResponseTime.toFixed(2)}ms avg`);
            console.log(`  Bun:     ${bunResult.avgResponseTime.toFixed(2)}ms avg`);
            console.log(`  Winner:  ${this.results.comparison[scenario.name].faster} (${this.results.comparison[scenario.name].improvement}% faster)`);
            console.log('');
        }
    }

    async runScenario(baseUrl, scenario, runtime) {
        const url = `${baseUrl}${scenario.endpoint}`;
        const concurrency = 10;
        const duration = 30; // seconds
        const requests = [];
        const results = {
            runtime,
            scenario: scenario.name,
            url,
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            responseTimes: [],
            avgResponseTime: 0,
            minResponseTime: Infinity,
            maxResponseTime: 0,
            requestsPerSecond: 0,
            errors: []
        };

        const startTime = Date.now();
        const endTime = startTime + (duration * 1000);

        // Function to make a request and measure performance
        const makeRequest = async () => {
            const requestStart = Date.now();
            try {
                const response = await fetch(url, {
                    method: scenario.method,
                    headers: { 'Accept': 'application/json' }
                });
                
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
                    results.errors.push(`HTTP ${response.status}`);
                }
            } catch (error) {
                results.totalRequests++;
                results.failedRequests++;
                results.errors.push(error.message);
            }
        };

        // Run concurrent requests for the specified duration
        const workers = Array(concurrency).fill().map(async () => {
            while (Date.now() < endTime) {
                await makeRequest();
                // Small delay to prevent overwhelming the server
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        });

        await Promise.all(workers);

        // Calculate final metrics
        if (results.responseTimes.length > 0) {
            results.avgResponseTime = results.responseTimes.reduce((sum, time) => sum + time, 0) / results.responseTimes.length;
            results.requestsPerSecond = results.totalRequests / duration;
            
            // Calculate percentiles
            const sortedTimes = results.responseTimes.sort((a, b) => a - b);
            results.p50ResponseTime = sortedTimes[Math.floor(sortedTimes.length * 0.5)];
            results.p95ResponseTime = sortedTimes[Math.floor(sortedTimes.length * 0.95)];
            results.p99ResponseTime = sortedTimes[Math.floor(sortedTimes.length * 0.99)];
        }

        return results;
    }

    compareResults(nodeResult, bunResult) {
        const nodeAvg = nodeResult.avgResponseTime;
        const bunAvg = bunResult.avgResponseTime;
        
        const faster = nodeAvg < bunAvg ? 'node' : 'bun';
        const slower = faster === 'node' ? 'bun' : 'node';
        const fasterTime = faster === 'node' ? nodeAvg : bunAvg;
        const slowerTime = faster === 'node' ? bunAvg : nodeAvg;
        
        const improvement = ((slowerTime - fasterTime) / slowerTime * 100);
        
        return {
            faster,
            slower,
            improvement: improvement.toFixed(2),
            nodeFaster: faster === 'node',
            bunFaster: faster === 'bun',
            responseTimeDifference: Math.abs(nodeAvg - bunAvg),
            throughputComparison: {
                node: nodeResult.requestsPerSecond,
                bun: bunResult.requestsPerSecond,
                winner: nodeResult.requestsPerSecond > bunResult.requestsPerSecond ? 'node' : 'bun'
            }
        };
    }

    generateReport() {
        console.log('📈 Generating Performance Report');
        console.log('================================');
        
        // Overall performance summary
        const scenarios = Object.keys(this.results.comparison);
        const nodeWins = scenarios.filter(s => this.results.comparison[s].nodeFaster).length;
        const bunWins = scenarios.filter(s => this.results.comparison[s].bunFaster).length;
        
        console.log(`\n🏆 Overall Results:`);
        console.log(`Node.js wins: ${nodeWins}/${scenarios.length} scenarios`);
        console.log(`Bun wins: ${bunWins}/${scenarios.length} scenarios`);
        
        // Detailed results
        console.log(`\n📊 Detailed Results:`);
        scenarios.forEach(scenario => {
            const comp = this.results.comparison[scenario];
            const nodeRes = this.results.node[scenario];
            const bunRes = this.results.bun[scenario];
            
            console.log(`\n${scenario.toUpperCase()}:`);
            console.log(`  Node.js: ${nodeRes.avgResponseTime.toFixed(2)}ms avg, ${nodeRes.requestsPerSecond.toFixed(2)} req/s`);
            console.log(`  Bun:     ${bunRes.avgResponseTime.toFixed(2)}ms avg, ${bunRes.requestsPerSecond.toFixed(2)} req/s`);
            console.log(`  Winner:  ${comp.faster.toUpperCase()} (${comp.improvement}% faster)`);
        });

        // Memory usage comparison if available
        if (this.results.node.health && this.results.bun.health) {
            console.log(`\n💾 Memory Usage:`);
            console.log(`  Node.js: ${this.results.node.health.memory.heapUsed / 1024 / 1024}MB heap`);
            console.log(`  Bun:     ${this.results.bun.health.memory.heapUsed / 1024 / 1024}MB heap`);
        }

        // Save detailed results to file
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `benchmark-results-${timestamp}.json`;
        writeFileSync(filename, JSON.stringify(this.results, null, 2));
        
        console.log(`\n💾 Full results saved to: ${filename}`);
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Bookstore Performance Benchmark Runner

Usage: node benchmark-runner.js [options]

Options:
  --node-url <url>    Node.js service URL (default: http://localhost:3000)
  --bun-url <url>     Bun service URL (default: http://localhost:3001)
  --help, -h          Show this help message

Environment Variables:
  NODE_SERVICE_URL    Node.js service URL
  BUN_SERVICE_URL     Bun service URL

Examples:
  node benchmark-runner.js
  node benchmark-runner.js --node-url https://node-bookstore.railway.app --bun-url https://bun-bookstore.railway.app
        `);
        process.exit(0);
    }

    // Parse command line arguments
    const nodeUrlIndex = args.indexOf('--node-url');
    if (nodeUrlIndex !== -1 && args[nodeUrlIndex + 1]) {
        process.env.NODE_SERVICE_URL = args[nodeUrlIndex + 1];
    }

    const bunUrlIndex = args.indexOf('--bun-url');
    if (bunUrlIndex !== -1 && args[bunUrlIndex + 1]) {
        process.env.BUN_SERVICE_URL = args[bunUrlIndex + 1];
    }

    const runner = new BenchmarkRunner();
    await runner.run();
}

// Run if this file is executed directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

export { BenchmarkRunner };