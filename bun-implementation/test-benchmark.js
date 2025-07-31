#!/usr/bin/env bun

// Test script for the real-time benchmark functionality
import { WebSocket } from 'ws';

console.log('🔥 Testing Real-time Benchmark Functionality');
console.log('This script will:');
console.log('1. Connect to WebSocket endpoint');
console.log('2. Start a benchmark via API');
console.log('3. Listen for real-time updates');
console.log('');

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
const WS_URL = `ws://localhost:${process.env.PORT || 3000}/ws/metrics`;

async function testBenchmark() {
    console.log('📡 Connecting to WebSocket...');
    
    const ws = new WebSocket(WS_URL);
    
    ws.on('open', () => {
        console.log('✅ WebSocket connected successfully');
        startBenchmarkTest();
    });
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            
            if (message.type === 'benchmark') {
                console.log(`🏃 [${message.status.toUpperCase()}] ${message.message}`);
                
                if (message.result) {
                    console.log(`   📊 Summary: ${JSON.stringify(message.result.summary, null, 2)}`);
                }
                
                if (message.progress !== undefined) {
                    console.log(`   📈 Progress: ${message.progress.toFixed(1)}%`);
                }
            } else if (message.type === 'update') {
                console.log(`🔄 System update: Runtime ${message.data.runtime}, Memory: ${formatBytes(message.data.memory?.heapUsed)}`);
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
    
    async function startBenchmarkTest() {
        console.log('🚀 Starting benchmark test...');
        
        try {
            const response = await fetch(`${BASE_URL}/api/performance/benchmark`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    scenario: 'startup',
                    duration: 10
                })
            });
            
            const result = await response.json();
            
            if (response.ok) {
                console.log('✅ Benchmark started successfully');
                console.log(`   📋 Benchmark ID: ${result.id}`);
                console.log(`   ⏱️  Scenario: ${result.scenario}`);
                console.log(`   📝 Message: ${result.message}`);
                console.log('');
                console.log('👀 Watching for real-time updates...');
            } else {
                console.error('❌ Failed to start benchmark:', result.error);
                console.log('');
                console.log('💡 Make sure:');
                console.log('   - The server is running');
                console.log('   - oha is installed (cargo install oha)');
                console.log('   - DATABASE_URL is set');
            }
        } catch (error) {
            console.error('❌ Error starting benchmark:', error.message);
            console.log('');
            console.log('💡 Make sure the server is running on port', process.env.PORT || 3000);
        }
    }
}

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Check if server is running first
async function checkServer() {
    try {
        const response = await fetch(`${BASE_URL}/api/health`);
        if (response.ok) {
            console.log('✅ Server is running');
            return true;
        }
    } catch (error) {
        console.error('❌ Server is not running or not reachable');
        console.log('   Please start the server first with: bun run dev');
        return false;
    }
}

console.log('🔍 Checking server status...');
if (await checkServer()) {
    await testBenchmark();
    
    // Keep the script running to listen for WebSocket messages
    console.log('');
    console.log('⏳ Listening for updates... (Press Ctrl+C to exit)');
} else {
    process.exit(1);
}