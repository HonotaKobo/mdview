use serde::Deserialize;
use tauri::AppHandle;
use tiny_http::{Header, Method, Response, Server};

use crate::ipc;

/// Generate a random hex token for API authentication.
fn generate_token() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let seed = t.as_nanos();
    // Mix bits for better randomness from time-based seed
    let hash = seed
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    format!("{:016x}", hash)
}

/// Start HTTP API server on a random localhost port.
/// Returns the port number. The port and token are written to a file for client discovery.
pub fn start_http_server(id: String, app: AppHandle) -> u16 {
    let server = Server::http("127.0.0.1:0").expect("failed to start HTTP API server");
    let port = server.server_addr().to_ip().unwrap().port();
    let token = generate_token();

    // Write port file for discovery: "port:token"
    let port_path = ipc::instance_file(&id).with_extension("http");
    std::fs::write(&port_path, format!("{}:{}", port, token)).ok();

    let expected_token = token.clone();

    std::thread::spawn(move || {
        for mut request in server.incoming_requests() {
            // Check token authentication
            let response = if !verify_token(&request, &expected_token) {
                ipc::IpcResponse {
                    ok: false,
                    value: Some("Unauthorized".to_string()),
                }
            } else {
                handle_request(&app, &mut request)
            };

            let status = if !verify_token(&request, &expected_token) {
                401
            } else if response.ok {
                200
            } else {
                400
            };
            let json = serde_json::to_string(&response).unwrap_or_default();

            let content_type: Header = "Content-Type: application/json".parse().unwrap();
            let _ = request.respond(
                Response::from_string(json)
                    .with_status_code(status)
                    .with_header(content_type),
            );
        }
    });

    port
}

/// Verify the Bearer token from the Authorization header.
fn verify_token(request: &tiny_http::Request, expected: &str) -> bool {
    for header in request.headers() {
        if header.field.as_str().to_ascii_lowercase() == "authorization" {
            let value = header.value.as_str();
            if let Some(token) = value.strip_prefix("Bearer ") {
                return token == expected;
            }
        }
    }
    false
}

fn read_body(request: &mut tiny_http::Request) -> String {
    let mut body = String::new();
    request.as_reader().read_to_string(&mut body).ok();
    body
}

fn error_response(msg: &str) -> ipc::IpcResponse {
    ipc::IpcResponse {
        ok: false,
        value: Some(msg.to_string()),
    }
}

fn handle_request(app: &AppHandle, request: &mut tiny_http::Request) -> ipc::IpcResponse {
    let url = request.url().to_string();
    let method = request.method().clone();

    // Strip query string for routing
    let path = url.split('?').next().unwrap_or(&url);

    match (method, path) {
        // Pass-through: accept IpcRequest JSON directly
        (Method::Post, "/") => {
            let body = read_body(request);
            match serde_json::from_str::<ipc::IpcRequest>(&body) {
                Ok(req) => dispatch_ipc_request(app, req),
                Err(e) => error_response(&format!("Invalid JSON: {}", e)),
            }
        }

        // REST-style endpoints
        (Method::Post, "/update") => {
            let body = read_body(request);
            match serde_json::from_str::<UpdateRequest>(&body) {
                Ok(r) => ipc::handle_update(app, r.body, r.title),
                Err(e) => error_response(&format!("Invalid JSON: {}", e)),
            }
        }
        (Method::Post, "/query") => {
            let body = read_body(request);
            match serde_json::from_str::<QueryRequest>(&body) {
                Ok(r) => ipc::handle_query(app, &r.properties),
                Err(e) => error_response(&format!("Invalid JSON: {}", e)),
            }
        }
        (Method::Post, "/grep") => {
            let body = read_body(request);
            match serde_json::from_str::<GrepRequest>(&body) {
                Ok(r) => ipc::handle_grep(app, &r.pattern),
                Err(e) => error_response(&format!("Invalid JSON: {}", e)),
            }
        }
        (Method::Post, "/lines") => {
            let body = read_body(request);
            match serde_json::from_str::<LinesRequest>(&body) {
                Ok(r) => ipc::handle_lines(app, r.start, r.end),
                Err(e) => error_response(&format!("Invalid JSON: {}", e)),
            }
        }
        (Method::Post, "/edit/delete") => {
            let body = read_body(request);
            match serde_json::from_str::<DeleteRequest>(&body) {
                Ok(r) => ipc::handle_delete(app, r.ranges),
                Err(e) => error_response(&format!("Invalid JSON: {}", e)),
            }
        }
        (Method::Post, "/edit/insert") => {
            let body = read_body(request);
            match serde_json::from_str::<InsertRequest>(&body) {
                Ok(r) => ipc::handle_insert(app, r.line, &r.content),
                Err(e) => error_response(&format!("Invalid JSON: {}", e)),
            }
        }
        (Method::Post, "/edit/replace") => {
            let body = read_body(request);
            match serde_json::from_str::<ReplaceRequest>(&body) {
                Ok(r) => ipc::handle_replace(app, r.start, r.end, &r.content),
                Err(e) => error_response(&format!("Invalid JSON: {}", e)),
            }
        }
        (Method::Get, "/list") => {
            let instances = ipc::get_instances();
            let list: Vec<serde_json::Value> = instances
                .into_iter()
                .map(|(id, title)| serde_json::json!({ "id": id, "title": title }))
                .collect();
            ipc::IpcResponse {
                ok: true,
                value: Some(serde_json::to_string(&list).unwrap_or_default()),
            }
        }
        (Method::Get, "/health") => ipc::IpcResponse {
            ok: true,
            value: Some(env!("CARGO_PKG_VERSION").to_string()),
        },

        _ => ipc::IpcResponse {
            ok: false,
            value: Some(format!("Not found: {} {}", request.method(), path)),
        },
    }
}

fn dispatch_ipc_request(app: &AppHandle, req: ipc::IpcRequest) -> ipc::IpcResponse {
    match req {
        ipc::IpcRequest::Update { body, title } => ipc::handle_update(app, body, title),
        ipc::IpcRequest::Query { properties } => ipc::handle_query(app, &properties),
        ipc::IpcRequest::Grep { pattern } => ipc::handle_grep(app, &pattern),
        ipc::IpcRequest::Lines { start, end } => ipc::handle_lines(app, start, end),
        ipc::IpcRequest::Delete { ranges } => ipc::handle_delete(app, ranges),
        ipc::IpcRequest::Insert { line, content } => ipc::handle_insert(app, line, &content),
        ipc::IpcRequest::Replace { start, end, content } => {
            ipc::handle_replace(app, start, end, &content)
        }
    }
}

// --- Request structs for REST endpoints ---

#[derive(Deserialize)]
struct UpdateRequest {
    body: Option<String>,
    title: Option<String>,
}

#[derive(Deserialize)]
struct QueryRequest {
    properties: Vec<String>,
}

#[derive(Deserialize)]
struct GrepRequest {
    pattern: String,
}

#[derive(Deserialize)]
struct LinesRequest {
    start: usize,
    end: usize,
}

#[derive(Deserialize)]
struct DeleteRequest {
    ranges: Vec<(usize, usize)>,
}

#[derive(Deserialize)]
struct InsertRequest {
    line: usize,
    content: String,
}

#[derive(Deserialize)]
struct ReplaceRequest {
    start: usize,
    end: usize,
    content: String,
}
