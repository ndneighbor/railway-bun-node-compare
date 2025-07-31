import React, { useState, useEffect } from 'react';

export function PerformanceDashboard({ runtime }) {
    const [metrics, setMetrics] = useState(null);
    const [history, setHistory] = useState([]);
    const [comparison, setComparison] = useState(null);
    const [loading, setLoading] = useState(true);
    const [wsConnected, setWsConnected] = useState(false);
    const [liveStats, setLiveStats] = useState(null);

    useEffect(() => {
        fetchMetrics();
        fetchHistory();
        fetchComparison();
        connectWebSocket();
    }, []);

    const fetchMetrics = async () => {
        try {
            const response = await fetch('/api/performance/metrics');
            const data = await response.json();
            setMetrics(data);
        } catch (error) {
            console.error('Error fetching metrics:', error);
        }
    };

    const fetchHistory = async () => {
        try {
            const response = await fetch('/api/performance/history?hours=24');
            const data = await response.json();
            setHistory(data);
        } catch (error) {
            console.error('Error fetching history:', error);
        }
    };

    const fetchComparison = async () => {
        try {
            const response = await fetch('/api/performance/compare');
            const data = await response.json();
            setComparison(data);
        } catch (error) {
            console.error('Error fetching comparison:', error);
        } finally {
            setLoading(false);
        }
    };

    const connectWebSocket = () => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws/metrics`);

        ws.onopen = () => {
            setWsConnected(true);
            console.log('WebSocket connected');
        };

        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'update' || message.type === 'initial') {
                setLiveStats(message.data);
            }
        };

        ws.onclose = () => {
            setWsConnected(false);
            console.log('WebSocket disconnected');
            // Reconnect after 5 seconds
            setTimeout(connectWebSocket, 5000);
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            setWsConnected(false);
        };
    };

    const runBenchmark = async (scenario) => {
        try {
            const response = await fetch('/api/performance/benchmark', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scenario })
            });
            const data = await response.json();
            alert(`Benchmark "${scenario}" initiated. ${data.message}`);
        } catch (error) {
            console.error('Error running benchmark:', error);
            alert('Error running benchmark');
        }
    };

    if (loading) {
        return (
            <div className="performance-dashboard">
                <div className="loading">Loading performance data...</div>
            </div>
        );
    }

    return (
        <div className="performance-dashboard">
            <div className="dashboard-header">
                <h1>Performance Dashboard</h1>
                <div className="runtime-info">
                    <span className={`runtime-badge ${runtime}`}>
                        {runtime.toUpperCase()} Runtime
                    </span>
                    <span className={`ws-status ${wsConnected ? 'connected' : 'disconnected'}`}>
                        WebSocket: {wsConnected ? 'Connected' : 'Disconnected'}
                    </span>
                </div>
            </div>

            {/* Live Stats */}
            {liveStats && (
                <div className="live-stats">
                    <h2>Live Performance Metrics</h2>
                    <div className="stats-grid">
                        <div className="stat-card">
                            <h3>Memory Usage</h3>
                            <div className="stat-value">
                                {liveStats.memory.heapUsed}MB
                            </div>
                            <div className="stat-detail">
                                RSS: {liveStats.memory.rss}MB | 
                                Heap Total: {liveStats.memory.heapTotal}MB
                            </div>
                        </div>
                        <div className="stat-card">
                            <h3>Uptime</h3>
                            <div className="stat-value">
                                {Math.floor(liveStats.uptime / 3600)}h {Math.floor((liveStats.uptime % 3600) / 60)}m
                            </div>
                        </div>
                        <div className="stat-card">
                            <h3>Process ID</h3>
                            <div className="stat-value">{liveStats.pid}</div>
                        </div>
                    </div>
                </div>
            )}

            {/* Historical Metrics */}
            {metrics && (
                <div className="historical-metrics">
                    <h2>Average Performance (Last Hour)</h2>
                    <div className="metrics-grid">
                        {metrics.metrics.map((metric, index) => (
                            <div key={index} className="metric-card">
                                <h3>{metric.endpoint}</h3>
                                <div className="metric-stats">
                                    <div className="metric-row">
                                        <span>Avg Response Time:</span>
                                        <span>{parseFloat(metric.avg_response_time).toFixed(2)}ms</span>
                                    </div>
                                    <div className="metric-row">
                                        <span>Request Count:</span>
                                        <span>{metric.request_count}</span>
                                    </div>
                                    <div className="metric-row">
                                        <span>Memory Usage:</span>
                                        <span>{parseFloat(metric.avg_memory_usage).toFixed(2)}MB</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Runtime Comparison */}
            {comparison && comparison.remote && (
                <div className="runtime-comparison">
                    <h2>Runtime Comparison</h2>
                    <div className="comparison-grid">
                        <div className="comparison-card local">
                            <h3>{comparison.local.runtime.toUpperCase()} (Current)</h3>
                            <div className="comparison-stats">
                                {comparison.local.metrics.map((metric, index) => (
                                    <div key={index} className="comparison-metric">
                                        <span>{metric.endpoint}:</span>
                                        <span>{parseFloat(metric.avg_response_time).toFixed(2)}ms</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="comparison-card remote">
                            <h3>{comparison.remote.runtime.toUpperCase()} (Remote)</h3>
                            <div className="comparison-stats">
                                {comparison.remote.metrics.map((metric, index) => (
                                    <div key={index} className="comparison-metric">
                                        <span>{metric.endpoint}:</span>
                                        <span>{parseFloat(metric.avg_response_time).toFixed(2)}ms</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                    {comparison.summary && (
                        <div className="comparison-summary">
                            <h3>Performance Summary</h3>
                            <p>
                                <strong>{comparison.summary.faster_runtime.toUpperCase()}</strong> is faster by{' '}
                                <strong>{Math.abs(comparison.summary.performance_improvement)}%</strong>
                            </p>
                            <p>
                                Average response time difference:{' '}
                                <strong>{Math.abs(comparison.summary.response_time_difference).toFixed(2)}ms</strong>
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* Benchmark Controls */}
            <div className="benchmark-controls">
                <h2>Load Testing</h2>
                <div className="benchmark-buttons">
                    <button 
                        onClick={() => runBenchmark('light')} 
                        className="btn btn-outline"
                    >
                        Light Load (10 users)
                    </button>
                    <button 
                        onClick={() => runBenchmark('medium')} 
                        className="btn btn-outline"
                    >
                        Medium Load (50 users)
                    </button>
                    <button 
                        onClick={() => runBenchmark('heavy')} 
                        className="btn btn-outline"
                    >
                        Heavy Load (100 users)
                    </button>
                    <button 
                        onClick={() => runBenchmark('database')} 
                        className="btn btn-outline"
                    >
                        Database Test
                    </button>
                </div>
                <p className="benchmark-note">
                    Note: Use external tools like wrk, artillery, or k6 for actual load testing.
                    These buttons provide suggested configurations.
                </p>
            </div>

            {/* Historical Chart Placeholder */}
            {history.length > 0 && (
                <div className="historical-chart">
                    <h2>Performance Trends (24 Hours)</h2>
                    <div className="chart-placeholder">
                        <p>Historical performance data available ({history.length} data points)</p>
                        <p>Integrate with Chart.js or similar library for visualization</p>
                        {/* In a real implementation, you would render a chart here */}
                        <div className="simple-timeline">
                            {history.slice(0, 10).map((point, index) => (
                                <div key={index} className="timeline-point">
                                    <span>{new Date(point.hour).toLocaleTimeString()}</span>
                                    <span>{parseFloat(point.avg_response_time).toFixed(2)}ms avg</span>
                                    <span>{point.request_count} requests</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}