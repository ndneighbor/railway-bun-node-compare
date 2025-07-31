#!/usr/bin/env node

// Test script for real-time oha streaming in web-load-tester
import { WebSocket } from 'ws';
import fetch from 'node-fetch';

const LOAD_TESTER_URL = 'http://localhost:4000';
const WS_URL = 'ws://localhost:4000';

console.log('🔥 Testing Real-time oha Streaming in Web Load Tester');
console.log('This script will:');
console.log('1. Connect to web-load-tester WebSocket');
console.log('2. Start a comparison test');
console.log('3. Listen for real-time oha streaming updates');
console.log('');

async function testStreamingComparison() {
    console.log('📡 Connecting to WebSocket...');
    
    const ws = new WebSocket(WS_URL);
    
    ws.on('open', () => {
        console.log('✅ WebSocket connected successfully');
        startComparisonTest();
    });
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            
            switch (message.type) {
                case 'progress':
                    console.log(`📊 Progress: ${message.progress.toFixed(1)}%`);
                    console.log(`   🟢 Node.js: ${message.comparison.node.rps} RPS, ${message.comparison.node.avgResponseTime}ms avg`);
                    console.log(`   🟠 Bun: ${message.comparison.bun.rps} RPS, ${message.comparison.bun.avgResponseTime}ms avg`);
                    console.log(`   🏆 Current Winner: ${message.comparison.winner.toUpperCase()}`);
                    break;
                
                case 'ohaTestStart':
                    console.log(`🚀 [${message.runtime.toUpperCase()}] oha test started: ${message.message}`);
                    console.log(`   📍 URL: ${message.url}`);
                    console.log(`   👥 Users: ${message.config.users}, Duration: ${message.config.duration}s`);
                    break;
                
                case 'ohaProgress':
                    const stats = message.stats;
                    console.log(`⚡ [${message.runtime.toUpperCase()}] ${message.message}`);
                    console.log(`   📈 Stats: ${stats.requests} req, ${stats.responses} resp, ${stats.errors} err, ${stats.requestsPerSecond.toFixed(1)} RPS`);
                    break;
                
                case 'ohaCompleted':
                    console.log(`✅ [${message.runtime.toUpperCase()}] oha test completed: ${message.message}`);
                    if (message.results) {
                        console.log(`   📊 Final Results: ${message.results.requests} requests, ${message.results.requestsPerSecond.toFixed(2)} RPS`);
                        console.log(`   ⏱️  Avg Response: ${message.results.avgResponseTime.toFixed(2)}ms`);
                        console.log(`   📉 P95: ${message.results.percentiles?.p95?.toFixed(2)}ms`);
                    }
                    break;
                
                case 'ohaError':
                    console.log(`❌ [${message.runtime.toUpperCase()}] oha error: ${message.message}`);
                    if (message.error) {
                        console.log(`   🔍 Error Details: ${message.error}`);
                    }
                    break;
                
                case 'ohaRawOutput':
                    console.log(`📟 [${message.runtime.toUpperCase()}] ${message.rawOutput}`);
                    break;
                
                case 'completed':
                    console.log('🏁 Comparison test completed!');
                    console.log(`   🏆 Winner: ${message.comparison.winner.toUpperCase()}`);
                    
                    if (message.comparison.nodeAdvantages?.length > 0) {
                        console.log(`   🟢 Node.js advantages: ${message.comparison.nodeAdvantages.join(', ')}`);
                    }
                    
                    if (message.comparison.bunAdvantages?.length > 0) {
                        console.log(`   🟠 Bun advantages: ${message.comparison.bunAdvantages.join(', ')}`);
                    }
                    
                    console.log(`   📊 Performance Gap:`);
                    console.log(`      Response Time: ${message.comparison.performanceGap.responseTime.toFixed(2)}ms`);
                    console.log(`      Throughput: ${message.comparison.performanceGap.throughput.toFixed(2)} RPS`);
                    console.log(`      Error Rate: ${message.comparison.performanceGap.errorRate.toFixed(2)}%`);
                    
                    console.log('');
                    console.log('🎉 Test completed successfully! Check the web interface for detailed results.');
                    process.exit(0);
                    break;
                
                case 'error':
                    console.error(`❌ Test Error: ${message.message}`);
                    if (message.error) {
                        console.error(`   🔍 Details: ${message.error}`);
                    }
                    process.exit(1);
                    break;
                
                default:
                    console.log(`📨 Unknown message type: ${message.type}`);
                    break;
            }
        } catch (error) {
            console.error('❌ Error parsing WebSocket message:', error.message);
        }
    });
    
    ws.on('close', () => {
        console.log('❌ WebSocket connection closed');
    });
    
    ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error.message);
    });
    
    async function startComparisonTest() {
        console.log('🚀 Starting comparison test...');
        
        // Use localhost URLs for testing - replace with actual service URLs
        const nodeUrl = process.env.NODE_URL || 'http://localhost:3001';
        const bunUrl = process.env.BUN_URL || 'http://localhost:3000';
        
        try {
            const response = await fetch(`${LOAD_TESTER_URL}/api/test/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    nodeUrl: nodeUrl,
                    bunUrl: bunUrl,
                    configName: 'light' // Use light config for testing
                })
            });
            
            const result = await response.json();
            
            if (response.ok) {
                console.log('✅ Comparison test started successfully');
                console.log(`   📋 Session ID: ${result.sessionId}`);
                console.log(`   🟢 Node.js URL: ${nodeUrl}`);
                console.log(`   🟠 Bun URL: ${bunUrl}`);
                console.log('');
                console.log('👀 Watching for real-time oha streaming updates...');
                console.log('');
            } else {
                console.error('❌ Failed to start comparison test:', result.error);
                console.log('');
                console.log('💡 Make sure:');
                console.log('   - The web-load-tester is running on port 4000');
                console.log('   - Node.js service is running (set NODE_URL env var)');
                console.log('   - Bun service is running (set BUN_URL env var)');
                console.log('   - oha is installed (cargo install oha)');
                process.exit(1);
            }
        } catch (error) {
            console.error('❌ Error starting comparison test:', error.message);
            console.log('');
            console.log('💡 Make sure the web-load-tester is running on port', 4000);
            process.exit(1);
        }
    }
}

// Check if web-load-tester is running first
async function checkService() {
    try {
        const response = await fetch(`${LOAD_TESTER_URL}/health`);
        if (response.ok) {
            console.log('✅ Web Load Tester is running');
            return true;
        }
    } catch (error) {
        console.error('❌ Web Load Tester is not running or not reachable');
        console.log('   Please start the web-load-tester first with: cd web-load-tester && npm start');
        return false;
    }
}

console.log('🔍 Checking web-load-tester status...');
if (await checkService()) {
    await testStreamingComparison();
    
    // Keep the script running to listen for WebSocket messages
    console.log('');
    console.log('⏳ Listening for streaming updates... (Press Ctrl+C to exit)');
} else {
    process.exit(1);
}