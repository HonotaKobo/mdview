use serde::Deserialize;
use tauri::{AppHandle, Manager};
use tiny_http::{Header, Method, Response, Server};

use crate::ipc;
use crate::state::{LastFocusedDoc, WindowStates};

/// HTTP server info (shared across all windows)
pub struct HttpServerInfo {
    pub port: u16,
    pub token: String,
}

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
/// Returns (port, token). The caller writes port files per window.
pub fn start_http_server(app: AppHandle) -> (u16, String) {
    let server = Server::http("127.0.0.1:0").expect("failed to start HTTP API server");
    let port = server.server_addr().to_ip().unwrap().port();
    let token = generate_token();

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

    (port, token)
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

/// Extract Content-Type (without parameters like charset) from request headers.
fn get_content_type(request: &tiny_http::Request) -> String {
    for header in request.headers() {
        if header.field.as_str().to_ascii_lowercase() == "content-type" {
            let value = header.value.as_str();
            return value.split(';').next().unwrap_or(value).trim().to_lowercase();
        }
    }
    String::new()
}

/// Extract a query parameter value from a URL string.
fn parse_query_param(url: &str, key: &str) -> Option<String> {
    let query = url.split('?').nth(1)?;
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if k == key {
                return Some(url_decode(v));
            }
        }
    }
    None
}

/// Percent-decode a URL-encoded string (handles + as space, %XX sequences).
fn url_decode(s: &str) -> String {
    let mut bytes = Vec::new();
    let mut iter = s.bytes();
    while let Some(b) = iter.next() {
        match b {
            b'+' => bytes.push(b' '),
            b'%' => {
                let h1 = iter.next();
                let h2 = iter.next();
                if let (Some(h1), Some(h2)) = (h1, h2) {
                    if let Ok(byte) = u8::from_str_radix(
                        std::str::from_utf8(&[h1, h2]).unwrap_or(""),
                        16,
                    ) {
                        bytes.push(byte);
                    } else {
                        bytes.extend_from_slice(&[b'%', h1, h2]);
                    }
                } else {
                    bytes.push(b'%');
                    if let Some(h1) = h1 {
                        bytes.push(h1);
                    }
                }
            }
            _ => bytes.push(b),
        }
    }
    String::from_utf8(bytes).unwrap_or_else(|_| s.to_string())
}

/// Fix invalid JSON escape sequences (e.g. \d, \s, \w from regex in code blocks).
/// Scans character by character so that valid escapes (\n, \\, \", etc.) are preserved.
fn fix_json_escapes(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.peek() {
                Some(&next) => match next {
                    '"' | '\\' | '/' | 'b' | 'f' | 'n' | 'r' | 't' | 'u' => {
                        result.push('\\');
                        result.push(next);
                        chars.next();
                    }
                    _ => {
                        // Invalid JSON escape: add extra backslash
                        result.push('\\');
                        result.push('\\');
                        result.push(next);
                        chars.next();
                    }
                },
                None => result.push('\\'),
            }
        } else {
            result.push(c);
        }
    }
    result
}

/// Try parsing JSON, and on failure retry after fixing invalid escape sequences.
fn parse_json_lenient<T: serde::de::DeserializeOwned>(body: &str) -> Result<T, String> {
    match serde_json::from_str::<T>(body) {
        Ok(v) => Ok(v),
        Err(_) => {
            let fixed = fix_json_escapes(body);
            serde_json::from_str::<T>(&fixed)
                .map_err(|e| format!("Invalid JSON: {}", e))
        }
    }
}

/// Resolve the window label from the request URL's `?id=` parameter.
/// If `id` matches an instance_id in WindowStates, returns the corresponding window label.
/// Otherwise falls back to the last focused document window.
fn resolve_window_label(app: &AppHandle, url: &str) -> String {
    if let Some(id) = parse_query_param(url, "id") {
        let states = app.state::<WindowStates>();
        let states = states.lock().unwrap();
        if let Some((label, _)) = states.iter().find(|(_, s)| s.instance_id == id) {
            return label.clone();
        }
        // Try using id as a window label directly
        if states.contains_key(&id) {
            return id;
        }
    }
    // Default to last focused document
    let focused = app.state::<LastFocusedDoc>();
    let label = focused.lock().unwrap().clone();
    label
}

fn handle_request(app: &AppHandle, request: &mut tiny_http::Request) -> ipc::IpcResponse {
    let url = request.url().to_string();
    let method = request.method().clone();

    // Strip query string for routing
    let path = url.split('?').next().unwrap_or(&url);

    // Resolve target window
    let window_label = resolve_window_label(app, &url);

    match (method, path) {
        // Pass-through: accept IpcRequest JSON directly
        (Method::Post, "/") => {
            let body = read_body(request);
            match parse_json_lenient::<ipc::IpcRequest>(&body) {
                Ok(req) => dispatch_ipc_request(app, &window_label, req),
                Err(e) => error_response(&e),
            }
        }

        // REST-style endpoints
        (Method::Post, "/update") => {
            let content_type = get_content_type(request);
            let body = read_body(request);

            if content_type == "text/markdown" || content_type == "text/plain" {
                // Raw body mode: body is markdown text, title from query param
                let title = parse_query_param(&url, "title");
                ipc::handle_update(app, &window_label, Some(body), title)
            } else {
                // JSON mode (default, backward compatible)
                match parse_json_lenient::<UpdateRequest>(&body) {
                    Ok(r) => ipc::handle_update(app, &window_label, r.body, r.title),
                    Err(e) => error_response(&e),
                }
            }
        }
        (Method::Post, "/query") => {
            let body = read_body(request);
            match parse_json_lenient::<QueryRequest>(&body) {
                Ok(r) => ipc::handle_query(app, &window_label, &r.properties),
                Err(e) => error_response(&e),
            }
        }
        (Method::Post, "/grep") => {
            let content_type = get_content_type(request);
            let body = read_body(request);

            if content_type == "text/plain" {
                // Raw body mode: body is the regex pattern
                ipc::handle_grep(app, &window_label, &body)
            } else {
                match parse_json_lenient::<GrepRequest>(&body) {
                    Ok(r) => ipc::handle_grep(app, &window_label, &r.pattern),
                    Err(e) => error_response(&e),
                }
            }
        }
        (Method::Post, "/lines") => {
            let body = read_body(request);
            match parse_json_lenient::<LinesRequest>(&body) {
                Ok(r) => ipc::handle_lines(app, &window_label, r.start, r.end),
                Err(e) => error_response(&e),
            }
        }
        (Method::Post, "/edit/delete") => {
            let body = read_body(request);
            match parse_json_lenient::<DeleteRequest>(&body) {
                Ok(r) => ipc::handle_delete(app, &window_label, r.ranges),
                Err(e) => error_response(&e),
            }
        }
        (Method::Post, "/edit/insert") => {
            let content_type = get_content_type(request);
            let body = read_body(request);

            if content_type == "text/markdown" || content_type == "text/plain" {
                // Raw body mode: body is the content, line from query param
                match parse_query_param(&url, "line").and_then(|v| v.parse::<usize>().ok()) {
                    Some(line) => ipc::handle_insert(app, &window_label, line, &body),
                    None => error_response("Missing or invalid query parameter: line"),
                }
            } else {
                match parse_json_lenient::<InsertRequest>(&body) {
                    Ok(r) => ipc::handle_insert(app, &window_label, r.line, &r.content),
                    Err(e) => error_response(&e),
                }
            }
        }
        (Method::Post, "/edit/replace") => {
            let content_type = get_content_type(request);
            let body = read_body(request);

            if content_type == "text/markdown" || content_type == "text/plain" {
                // Raw body mode: body is the content, start/end from query params
                let start = parse_query_param(&url, "start").and_then(|v| v.parse::<usize>().ok());
                let end = parse_query_param(&url, "end").and_then(|v| v.parse::<usize>().ok());
                match (start, end) {
                    (Some(s), Some(e)) => ipc::handle_replace(app, &window_label, s, e, &body),
                    _ => error_response("Missing or invalid query parameters: start, end"),
                }
            } else {
                match parse_json_lenient::<ReplaceRequest>(&body) {
                    Ok(r) => ipc::handle_replace(app, &window_label, r.start, r.end, &r.content),
                    Err(e) => error_response(&e),
                }
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

fn dispatch_ipc_request(app: &AppHandle, window_label: &str, req: ipc::IpcRequest) -> ipc::IpcResponse {
    match req {
        ipc::IpcRequest::Update { body, title } => ipc::handle_update(app, window_label, body, title),
        ipc::IpcRequest::Query { properties } => ipc::handle_query(app, window_label, &properties),
        ipc::IpcRequest::Grep { pattern } => ipc::handle_grep(app, window_label, &pattern),
        ipc::IpcRequest::Lines { start, end } => ipc::handle_lines(app, window_label, start, end),
        ipc::IpcRequest::Delete { ranges } => ipc::handle_delete(app, window_label, ranges),
        ipc::IpcRequest::Insert { line, content } => ipc::handle_insert(app, window_label, line, &content),
        ipc::IpcRequest::Replace { start, end, content } => {
            ipc::handle_replace(app, window_label, start, end, &content)
        }
        ipc::IpcRequest::CreateWindow { file, body, title } => {
            match crate::open_document_window(app, file, body, title) {
                Ok(id) => ipc::IpcResponse { ok: true, value: Some(id) },
                Err(e) => ipc::IpcResponse { ok: false, value: Some(e) },
            }
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
