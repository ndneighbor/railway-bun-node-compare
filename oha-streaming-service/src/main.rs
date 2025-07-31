use axum::{
    extract::{Path, State, WebSocketUpgrade},
    http::Method,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{sync::broadcast, time::interval};
use tower_http::cors::{Any, CorsLayer};
use tracing::{info, warn, error};
use tracing_subscriber;
use uuid::Uuid;

mod load_tester;
use load_tester::{LoadTest, LoadTestConfig, LoadTestResult, LoadTestStatus};

// Application state
#[derive(Clone)]
pub struct AppState {
    pub active_tests: Arc<Mutex<HashMap<String, LoadTest>>>,
    pub broadcast_tx: broadcast::Sender<StreamMessage>,
}

// WebSocket message types
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum StreamMessage {
    TestStarted {
        test_id: String,
        config: LoadTestConfig,
        timestamp: chrono::DateTime<chrono::Utc>,
    },
    Progress {
        test_id: String,
        runtime: String,
        requests_sent: u64,
        responses_received: u64,
        errors: u64,
        current_rps: f64,
        avg_latency_ms: f64,
        p95_latency_ms: f64,
        elapsed_seconds: f64,
        progress_percent: f64,
        timestamp: chrono::DateTime<chrono::Utc>,
    },
    TestCompleted {
        test_id: String,
        runtime: String,
        results: LoadTestResult,
        timestamp: chrono::DateTime<chrono::Utc>,
    },
    TestError {
        test_id: String,
        runtime: String,
        error: String,
        timestamp: chrono::DateTime<chrono::Utc>,
    },
}

// HTTP API types
#[derive(Debug, Deserialize)]
pub struct StartTestRequest {
    pub node_url: String,
    pub bun_url: String,
    pub duration_seconds: Option<u64>,
    pub connections: Option<u64>,
    pub rate_per_second: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct StartTestResponse {
    pub test_id: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct TestStatusResponse {
    pub test_id: String,
    pub status: LoadTestStatus,
    pub started_at: chrono::DateTime<chrono::Utc>,
    pub elapsed_seconds: f64,
}

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "oha_streaming_service=debug,tower_http=debug".into()),
        )
        .init();

    // Create broadcast channel for WebSocket messages
    let (broadcast_tx, _) = broadcast::channel(1000);

    // Create application state
    let state = AppState {
        active_tests: Arc::new(Mutex::new(HashMap::new())),
        broadcast_tx: broadcast_tx.clone(),
    };

    // Start background task to clean up completed tests
    let cleanup_state = state.clone();
    tokio::spawn(async move {
        let mut interval = interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            cleanup_completed_tests(&cleanup_state).await;
        }
    });

    // Build the router
    let app = Router::new()
        .route("/", get(root))
        .route("/health", get(health))
        .route("/api/test/start", post(start_test))
        .route("/api/test/status/:test_id", get(get_test_status))
        .route("/api/test/stop/:test_id", post(stop_test))
        .route("/ws", get(websocket_handler))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([Method::GET, Method::POST])
                .allow_headers(Any),
        )
        .with_state(state);

    // Get port from environment or default to 3030
    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "3030".to_string())
        .parse::<u16>()
        .unwrap_or(3030);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("🚀 OHA Streaming Service listening on {}", addr);

    // Start the server
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

// Route handlers
async fn root() -> &'static str {
    "OHA Streaming Service - Real-time load testing with oha"
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "healthy",
        "timestamp": chrono::Utc::now(),
        "service": "oha-streaming-service",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

async fn start_test(
    State(state): State<AppState>,
    Json(request): Json<StartTestRequest>,
) -> Result<Json<StartTestResponse>, axum::http::StatusCode> {
    let test_id = Uuid::new_v4().to_string();
    
    info!("Starting new load test: {}", test_id);

    let config = LoadTestConfig {
        duration_seconds: request.duration_seconds.unwrap_or(60),
        connections: request.connections.unwrap_or(10),
        rate_per_second: request.rate_per_second,
    };

    // Start both tests
    let test_id_clone = test_id.clone();
    let config_clone = config.clone();
    let node_url = request.node_url;
    let bun_url = request.bun_url;
    let broadcast_tx = state.broadcast_tx.clone();
    let active_tests = state.active_tests.clone();
    
    tokio::spawn(async move {
        // Create load tests for both runtimes
        let node_test = LoadTest::new(
            test_id_clone.clone(),
            "node".to_string(),
            node_url,
            config_clone.clone(),
            broadcast_tx.clone(),
        );

        let bun_test = LoadTest::new(
            test_id_clone.clone(),
            "bun".to_string(), 
            bun_url,
            config_clone.clone(),
            broadcast_tx.clone(),
        );

        // Store tests
        {
            let mut tests = active_tests.lock().unwrap();
            tests.insert(format!("{}-node", test_id_clone), node_test.clone());
            tests.insert(format!("{}-bun", test_id_clone), bun_test.clone());
        }
        
        let node_handle = tokio::spawn(async move { node_test.run().await });
        let bun_handle = tokio::spawn(async move { bun_test.run().await });

        // Wait for both to complete
        let _ = tokio::join!(node_handle, bun_handle);
    });

    // Broadcast test started message
    let start_message = StreamMessage::TestStarted {
        test_id: test_id.clone(),
        config,
        timestamp: chrono::Utc::now(),
    };

    let _ = state.broadcast_tx.send(start_message);

    Ok(Json(StartTestResponse {
        test_id,
        message: "Load test started successfully".to_string(),
    }))
}

async fn get_test_status(
    Path(test_id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<TestStatusResponse>, axum::http::StatusCode> {
    let tests = state.active_tests.lock().unwrap();
    
    // Look for either node or bun variant of the test
    let test_key = format!("{}-node", test_id);
    if let Some(test) = tests.get(&test_key) {
        Ok(Json(TestStatusResponse {
            test_id,
            status: test.status(),
            started_at: test.started_at(),
            elapsed_seconds: test.elapsed_seconds(),
        }))
    } else {
        Err(axum::http::StatusCode::NOT_FOUND)
    }
}

async fn stop_test(
    Path(test_id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, axum::http::StatusCode> {
    let mut tests = state.active_tests.lock().unwrap();
    
    // Stop both node and bun tests
    let node_key = format!("{}-node", test_id);
    let bun_key = format!("{}-bun", test_id);
    
    let mut stopped = false;
    
    if let Some(test) = tests.get_mut(&node_key) {
        test.stop();
        stopped = true;
    }
    
    if let Some(test) = tests.get_mut(&bun_key) {
        test.stop();
        stopped = true;
    }

    if stopped {
        Ok(Json(serde_json::json!({
            "message": "Test stopped successfully",
            "test_id": test_id
        })))
    } else {
        Err(axum::http::StatusCode::NOT_FOUND)
    }
}

async fn websocket_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| websocket_connection(socket, state))
}

async fn websocket_connection(
    socket: axum::extract::ws::WebSocket,
    state: AppState,
) {
    use axum::extract::ws::Message;
    use futures_util::{sink::SinkExt, stream::StreamExt};
    
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.broadcast_tx.subscribe();

    info!("New WebSocket connection established");

    // Spawn task to send messages to client
    let send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            let json_msg = serde_json::to_string(&msg).unwrap_or_else(|e| {
                error!("Failed to serialize message: {}", e);
                r#"{"type":"error","message":"Serialization error"}"#.to_string()
            });
            
            if sender
                .send(Message::Text(json_msg))
                .await
                .is_err()
            {
                break;
            }
        }
    });

    // Spawn task to handle incoming messages (if needed)
    let recv_task = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            match msg {
                Ok(Message::Close(_)) => break,
                Ok(Message::Pong(_)) => {
                    // Handle pong if needed
                }
                Err(e) => {
                    warn!("WebSocket error: {}", e);
                    break;
                }
                _ => {}
            }
        }
    });

    // Wait for either task to complete
    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }

    info!("WebSocket connection closed");
}

async fn cleanup_completed_tests(state: &AppState) {
    let mut tests = state.active_tests.lock().unwrap();
    tests.retain(|_, test| !matches!(test.status(), LoadTestStatus::Completed | LoadTestStatus::Failed));
}