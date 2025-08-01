use crate::StreamMessage;
use chrono::{DateTime, Utc};
use hdrhistogram::Histogram;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tokio::{sync::broadcast, time::interval};
use tracing::{debug, info};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadTestConfig {
    pub duration_seconds: u64,
    pub connections: u64,
    pub rate_per_second: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LoadTestResult {
    pub runtime: String,
    pub total_requests: u64,
    pub successful_requests: u64,
    pub failed_requests: u64,
    pub total_duration_seconds: f64,
    pub requests_per_second: f64,
    pub avg_latency_ms: f64,
    pub min_latency_ms: f64,
    pub max_latency_ms: f64,
    pub p50_latency_ms: f64,
    pub p95_latency_ms: f64,
    pub p99_latency_ms: f64,
    pub error_types: std::collections::HashMap<String, u64>,
}

#[derive(Debug, Clone, Serialize)]
pub enum LoadTestStatus {
    Running,
    Completed,
    Failed,
    Stopped,
}

#[derive(Debug, Clone)]
pub struct LoadTest {
    pub test_id: String,
    pub runtime: String,
    pub target_url: String,
    pub config: LoadTestConfig,
    pub started_at: DateTime<Utc>,
    
    // Statistics
    pub requests_sent: Arc<AtomicU64>,
    pub responses_received: Arc<AtomicU64>,
    pub errors: Arc<AtomicU64>,
    pub latency_histogram: Arc<Mutex<Histogram<u64>>>,
    pub error_types: Arc<Mutex<std::collections::HashMap<String, u64>>>,
    
    // Control
    pub should_stop: Arc<AtomicBool>,
    pub status: Arc<Mutex<LoadTestStatus>>,
    
    // Communication
    pub broadcast_tx: broadcast::Sender<StreamMessage>,
}

impl LoadTest {
    pub fn new(
        test_id: String,
        runtime: String,
        target_url: String,
        config: LoadTestConfig,
        broadcast_tx: broadcast::Sender<StreamMessage>,
    ) -> Self {
        Self {
            test_id,
            runtime,
            target_url,
            config,
            started_at: Utc::now(),
            requests_sent: Arc::new(AtomicU64::new(0)),
            responses_received: Arc::new(AtomicU64::new(0)),
            errors: Arc::new(AtomicU64::new(0)),
            latency_histogram: Arc::new(Mutex::new(
                Histogram::new_with_bounds(1, 60_000, 3).unwrap()
            )),
            error_types: Arc::new(Mutex::new(std::collections::HashMap::new())),
            should_stop: Arc::new(AtomicBool::new(false)),
            status: Arc::new(Mutex::new(LoadTestStatus::Running)),
            broadcast_tx,
        }
    }

    pub fn status(&self) -> LoadTestStatus {
        self.status.lock().unwrap().clone()
    }

    pub fn started_at(&self) -> DateTime<Utc> {
        self.started_at
    }

    pub fn elapsed_seconds(&self) -> f64 {
        (Utc::now() - self.started_at).num_milliseconds() as f64 / 1000.0
    }

    pub fn stop(&mut self) {
        self.should_stop.store(true, Ordering::Relaxed);
        *self.status.lock().unwrap() = LoadTestStatus::Stopped;
    }

    pub async fn run(&self) -> LoadTestResult {
        info!("Starting load test for {} runtime: {}", self.runtime, self.target_url);

        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .pool_idle_timeout(Duration::from_secs(90))
            .pool_max_idle_per_host(self.config.connections as usize)
            .build()
            .unwrap();

        let test_start = Instant::now();
        let test_duration = Duration::from_secs(self.config.duration_seconds);

        // Start progress reporting task
        let progress_task = self.start_progress_reporting();

        // Calculate request timing
        let requests_per_second = self.config.rate_per_second
            .unwrap_or(self.config.connections * 10);
        let request_interval = Duration::from_millis(1000 / requests_per_second.max(1));

        // Start worker tasks
        let mut worker_handles = Vec::new();
        
        for worker_id in 0..self.config.connections {
            let worker = LoadTestWorker {
                worker_id,
                client: client.clone(),
                target_url: self.target_url.clone(),
                request_interval,
                requests_sent: self.requests_sent.clone(),
                responses_received: self.responses_received.clone(),
                errors: self.errors.clone(),
                latency_histogram: self.latency_histogram.clone(),
                error_types: self.error_types.clone(),
                should_stop: self.should_stop.clone(),
            };

            let handle = tokio::spawn(async move {
                worker.run(test_duration).await;
            });

            worker_handles.push(handle);
        }

        // Wait for test completion or stop signal
        for handle in worker_handles {
            let _ = handle.await;
        }

        // Stop progress reporting
        progress_task.abort();

        let elapsed = test_start.elapsed();
        *self.status.lock().unwrap() = LoadTestStatus::Completed;

        // Calculate final results
        let total_requests = self.requests_sent.load(Ordering::Relaxed);
        let successful_requests = self.responses_received.load(Ordering::Relaxed);
        let failed_requests = self.errors.load(Ordering::Relaxed);

        let histogram = self.latency_histogram.lock().unwrap();
        
        let result = LoadTestResult {
            runtime: self.runtime.clone(),
            total_requests,
            successful_requests,
            failed_requests,
            total_duration_seconds: elapsed.as_secs_f64(),
            requests_per_second: total_requests as f64 / elapsed.as_secs_f64(),
            avg_latency_ms: histogram.mean(),
            min_latency_ms: histogram.min() as f64,
            max_latency_ms: histogram.max() as f64,
            p50_latency_ms: histogram.value_at_quantile(0.5) as f64,
            p95_latency_ms: histogram.value_at_quantile(0.95) as f64,
            p99_latency_ms: histogram.value_at_quantile(0.99) as f64,
            error_types: self.error_types.lock().unwrap().clone(),
        };

        // Broadcast completion
        let completion_message = StreamMessage::TestCompleted {
            test_id: self.test_id.clone(),
            runtime: self.runtime.clone(),
            results: result.clone(),
            timestamp: Utc::now(),
        };

        let _ = self.broadcast_tx.send(completion_message);

        info!("Load test completed for {}: {} requests in {:.2}s ({:.2} RPS)",
            self.runtime, total_requests, elapsed.as_secs_f64(), result.requests_per_second);

        result
    }

    fn start_progress_reporting(&self) -> tokio::task::JoinHandle<()> {
        let test_id = self.test_id.clone();
        let runtime = self.runtime.clone();
        let started_at = self.started_at;
        let requests_sent = self.requests_sent.clone();
        let responses_received = self.responses_received.clone();
        let errors = self.errors.clone();
        let latency_histogram = self.latency_histogram.clone();
        let should_stop = self.should_stop.clone();
        let broadcast_tx = self.broadcast_tx.clone();
        let duration = self.config.duration_seconds;

        tokio::spawn(async move {
            let mut interval = interval(Duration::from_secs(1));
            
            loop {
                interval.tick().await;
                
                if should_stop.load(Ordering::Relaxed) {
                    break;
                }

                let elapsed = (Utc::now() - started_at).num_milliseconds() as f64 / 1000.0;
                let progress_percent = (elapsed / duration as f64 * 100.0).min(100.0);

                let requests = requests_sent.load(Ordering::Relaxed);
                let responses = responses_received.load(Ordering::Relaxed);
                let error_count = errors.load(Ordering::Relaxed);

                let current_rps = requests as f64 / elapsed.max(0.1);

                let (avg_latency, p95_latency) = {
                    let histogram = latency_histogram.lock().unwrap();
                    (histogram.mean(), histogram.value_at_quantile(0.95) as f64)
                };

                let progress_message = StreamMessage::Progress {
                    test_id: test_id.clone(),
                    runtime: runtime.clone(),
                    requests_sent: requests,
                    responses_received: responses,
                    errors: error_count,
                    current_rps,
                    avg_latency_ms: avg_latency,
                    p95_latency_ms: p95_latency,
                    elapsed_seconds: elapsed,
                    progress_percent,
                    timestamp: Utc::now(),
                };

                let _ = broadcast_tx.send(progress_message);

                // Stop reporting if test duration exceeded
                if elapsed >= duration as f64 {
                    break;
                }
            }
        })
    }
}

struct LoadTestWorker {
    worker_id: u64,
    client: Client,
    target_url: String,
    request_interval: Duration,
    requests_sent: Arc<AtomicU64>,
    responses_received: Arc<AtomicU64>,
    errors: Arc<AtomicU64>,
    latency_histogram: Arc<Mutex<Histogram<u64>>>,
    error_types: Arc<Mutex<std::collections::HashMap<String, u64>>>,
    should_stop: Arc<AtomicBool>,
}

impl LoadTestWorker {
    async fn run(&self, test_duration: Duration) {
        let start_time = Instant::now();
        let mut last_request = Instant::now();

        debug!("Worker {} starting for URL: {}", self.worker_id, self.target_url);

        while start_time.elapsed() < test_duration && !self.should_stop.load(Ordering::Relaxed) {
            // Rate limiting
            let time_since_last = last_request.elapsed();
            if time_since_last < self.request_interval {
                tokio::time::sleep(self.request_interval - time_since_last).await;
            }
            last_request = Instant::now();

            // Make request
            let request_start = Instant::now();
            self.requests_sent.fetch_add(1, Ordering::Relaxed);

            match self.client.get(&self.target_url).send().await {
                Ok(response) => {
                    let latency = request_start.elapsed();
                    let latency_ms = latency.as_millis() as u64;

                    if response.status().is_success() {
                        self.responses_received.fetch_add(1, Ordering::Relaxed);
                        
                        // Record latency
                        if let Ok(mut histogram) = self.latency_histogram.lock() {
                            let _ = histogram.record(latency_ms);
                        }
                    } else {
                        self.errors.fetch_add(1, Ordering::Relaxed);
                        let status = response.status();
                        let error_detail = match status.as_u16() {
                            400 => "HTTP_400_Bad_Request",
                            401 => "HTTP_401_Unauthorized",
                            403 => "HTTP_403_Forbidden",
                            404 => "HTTP_404_Not_Found",
                            429 => "HTTP_429_Too_Many_Requests",
                            500 => "HTTP_500_Internal_Server_Error",
                            502 => "HTTP_502_Bad_Gateway",
                            503 => "HTTP_503_Service_Unavailable",
                            504 => "HTTP_504_Gateway_Timeout",
                            _ => &format!("HTTP_{}_{}",
                                status.as_u16(),
                                status.canonical_reason().unwrap_or("Unknown")
                            ),
                        };
                        self.record_error(error_detail);
                    }
                }
                Err(e) => {
                    self.errors.fetch_add(1, Ordering::Relaxed);
                    
                    let error_type = if e.is_timeout() {
                        "Timeout".to_string()
                    } else if e.is_connect() {
                        // Try to get more specific connection error info
                        if let Some(source) = e.source() {
                            format!("Connection: {}", source)
                        } else {
                            "Connection: Failed to establish connection".to_string()
                        }
                    } else if e.is_request() {
                        format!("Request: {}", e)
                    } else if e.is_body() {
                        "Body: Failed to read response body".to_string()
                    } else if e.is_decode() {
                        "Decode: Failed to decode response".to_string()
                    } else if e.is_redirect() {
                        "Redirect: Too many redirects".to_string()
                    } else if e.is_builder() {
                        "Builder: Invalid request".to_string()
                    } else {
                        format!("Unknown: {}", e)
                    };
                    
                    self.record_error(&error_type);
                    
                    // Log detailed error for debugging
                    debug!("Worker {} error: {} - Full error: {:?}", self.worker_id, error_type, e);
                }
            }
        }

        debug!("Worker {} completed", self.worker_id);
    }

    fn record_error(&self, error_type: &str) {
        if let Ok(mut error_types) = self.error_types.lock() {
            *error_types.entry(error_type.to_string()).or_insert(0) += 1;
        }
    }
}