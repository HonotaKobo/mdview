use std::io::{Read, Write};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::state::WindowStates;

// --- Platform-specific transport ---

#[cfg(unix)]
mod transport {
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::path::PathBuf;

    pub type Stream = UnixStream;
    pub type Listener = UnixListener;
    pub const INSTANCE_EXT: &str = "sock";

    pub fn instance_dir() -> PathBuf {
        let uid = unsafe { libc::getuid() };
        let dir = std::env::temp_dir().join(format!("tsumugi-{}", uid));
        if !dir.exists() {
            std::fs::create_dir_all(&dir).ok();
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).ok();
        }
        dir
    }

    pub fn instance_file(id: &str) -> PathBuf {
        instance_dir().join(format!("{}.{}", id, INSTANCE_EXT))
    }

    pub fn connect(id: &str) -> std::io::Result<(Stream, Option<String>)> {
        let path = instance_file(id);
        let stream = UnixStream::connect(&path)?;
        stream.set_read_timeout(Some(std::time::Duration::from_secs(5)))?;
        stream.set_write_timeout(Some(std::time::Duration::from_secs(5)))?;
        Ok((stream, None))
    }

    pub fn bind(id: &str) -> std::io::Result<(Listener, Option<String>)> {
        let path = instance_file(id);
        std::fs::remove_file(&path).ok();
        Ok((UnixListener::bind(&path)?, None))
    }
}

#[cfg(windows)]
mod transport {
    use std::net::{TcpListener, TcpStream};
    use std::path::PathBuf;

    pub type Stream = TcpStream;
    pub type Listener = TcpListener;
    pub const INSTANCE_EXT: &str = "port";

    pub fn instance_dir() -> PathBuf {
        let username = std::env::var("USERNAME").unwrap_or_else(|_| "default".into());
        let dir = std::env::temp_dir().join(format!("tsumugi-{}", username));
        if !dir.exists() {
            std::fs::create_dir_all(&dir).ok();
        }
        dir
    }

    pub fn instance_file(id: &str) -> PathBuf {
        instance_dir().join(format!("{}.{}", id, INSTANCE_EXT))
    }

    pub fn connect(id: &str) -> std::io::Result<(Stream, Option<String>)> {
        let port_path = instance_file(id);
        let content = std::fs::read_to_string(&port_path)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e))?;
        let (port_str, token) = content.trim().split_once(':')
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid port file format"))?;
        let port: u16 = port_str
            .parse()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        let stream = TcpStream::connect(("127.0.0.1", port))?;
        stream.set_read_timeout(Some(std::time::Duration::from_secs(5)))?;
        stream.set_write_timeout(Some(std::time::Duration::from_secs(5)))?;
        Ok((stream, Some(token.to_string())))
    }

    pub fn bind(id: &str) -> std::io::Result<(Listener, Option<String>)> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        let mut buf = [0u8; 16];
        getrandom::getrandom(&mut buf).expect("failed to generate IPC token");
        let token: String = buf.iter().map(|b| format!("{:02x}", b)).collect();
        let port_path = instance_file(id);
        std::fs::write(&port_path, format!("{}:{}", port, token))?;
        Ok((listener, Some(token)))
    }
}

// --- Public API ---

pub fn instance_file(id: &str) -> PathBuf {
    transport::instance_file(id)
}

#[derive(Deserialize)]
#[serde(tag = "type")]
pub(crate) enum IpcRequest {
    Update { body: Option<String>, title: Option<String> },
    Query { properties: Vec<String> },
    Grep { pattern: String },
    Lines { start: usize, end: usize },
    Delete { ranges: Vec<(usize, usize)> },
    Insert { line: usize, content: String },
    Replace { start: usize, end: usize, content: String },
    CreateWindow { file: Option<String>, body: Option<String>, title: Option<String> },
}

#[derive(Serialize, Deserialize)]
pub(crate) struct IpcResponse {
    pub(crate) ok: bool,
    pub(crate) value: Option<String>,
}

/// "199-200" → (199, 200), "42" → (42, 42)
fn parse_single_range(s: &str) -> Result<(usize, usize), String> {
    if let Some((a, b)) = s.split_once('-') {
        let start = a.trim().parse::<usize>().map_err(|_| format!("Invalid range: {}", s))?;
        let end = b.trim().parse::<usize>().map_err(|_| format!("Invalid range: {}", s))?;
        Ok((start, end))
    } else {
        let n = s.trim().parse::<usize>().map_err(|_| format!("Invalid line number: {}", s))?;
        Ok((n, n))
    }
}

/// "199-200,203,210-215" → [(199,200),(203,203),(210,215)]
fn parse_ranges(s: &str) -> Result<Vec<(usize, usize)>, String> {
    s.split(',').map(|part| parse_single_range(part.trim())).collect()
}

pub fn send_to_existing(id: &str, args: &crate::cli::CliArgs) -> Result<(), Box<dyn std::error::Error>> {
    let (mut stream, ipc_token) = transport::connect(id)?;

    let request = if !args.query.is_empty() {
        let props: Vec<String> = args.query.iter().map(|q| format!("{:?}", q).to_lowercase()).collect();
        serde_json::json!({ "type": "Query", "properties": props })
    } else if let Some(ref pattern) = args.grep {
        serde_json::json!({ "type": "Grep", "pattern": pattern })
    } else if let Some(ref range) = args.lines {
        let (start, end) = parse_single_range(range)?;
        serde_json::json!({ "type": "Lines", "start": start, "end": end })
    } else if let Some(ref ranges) = args.delete {
        let parsed = parse_ranges(ranges)?;
        serde_json::json!({ "type": "Delete", "ranges": parsed })
    } else if let Some(line) = args.insert {
        let content = args.content.as_ref().ok_or("tsumugi: --content is required with --insert")?;
        serde_json::json!({ "type": "Insert", "line": line, "content": content })
    } else if let Some(ref range) = args.replace {
        let (start, end) = parse_single_range(range)?;
        let content = args.content.as_ref().ok_or("tsumugi: --content is required with --replace")?;
        serde_json::json!({ "type": "Replace", "start": start, "end": end, "content": content })
    } else {
        serde_json::json!({ "type": "Update", "body": args.body, "title": args.title })
    };

    if let Some(ref token) = ipc_token {
        stream.write_all(format!("{}\n", token).as_bytes())?;
    }
    stream.write_all(request.to_string().as_bytes())?;
    stream.shutdown(std::net::Shutdown::Write)?;

    let mut response_buf = String::new();
    stream.read_to_string(&mut response_buf)?;

    let resp = serde_json::from_str::<IpcResponse>(&response_buf)?;

    // Read operations: output result to stdout
    if !args.query.is_empty() || args.grep.is_some() || args.lines.is_some() {
        if resp.ok {
            if let Some(value) = resp.value {
                println!("{}", value);
            }
            std::process::exit(0);
        } else {
            if let Some(value) = resp.value {
                eprintln!("tsumugi: {}", value);
            }
            std::process::exit(1);
        }
    }

    // Write operations: exit code only
    if !resp.ok {
        if let Some(value) = resp.value {
            eprintln!("tsumugi: {}", value);
        }
        std::process::exit(1);
    }

    Ok(())
}

/// Send a CreateWindow request to the primary process.
/// Returns Ok(()) if the primary handled it, Err if no primary exists.
pub fn send_create_window(
    file: Option<String>,
    body: Option<String>,
    title: Option<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    let (mut stream, ipc_token) = transport::connect("tsumugi-primary")?;

    let request = serde_json::json!({
        "type": "CreateWindow",
        "file": file,
        "body": body,
        "title": title,
    });

    if let Some(ref token) = ipc_token {
        stream.write_all(format!("{}\n", token).as_bytes())?;
    }
    stream.write_all(request.to_string().as_bytes())?;
    stream.shutdown(std::net::Shutdown::Write)?;

    let mut response_buf = String::new();
    stream.read_to_string(&mut response_buf)?;

    let resp = serde_json::from_str::<IpcResponse>(&response_buf)?;
    if resp.ok {
        if let Some(instance_id) = resp.value {
            println!("{}", instance_id);
        }
    } else {
        if let Some(value) = resp.value {
            eprintln!("tsumugi: {}", value);
        }
        std::process::exit(1);
    }

    Ok(())
}

/// Per-window IPC listener
pub fn start_listener(instance_id: String, window_label: String, app: AppHandle) {
    std::thread::spawn(move || {
        let (listener, ipc_token) = match transport::bind(&instance_id) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("tsumugi: Failed to start IPC listener for {}: {}", instance_id, e);
                return;
            }
        };

        for stream in listener.incoming() {
            if let Ok(mut stream) = stream {
                handle_stream(&app, &window_label, &mut stream, ipc_token.as_deref());
            }
        }
    });
}

/// Primary socket listener — only handles CreateWindow requests
pub fn start_primary_listener(app: AppHandle) {
    std::thread::spawn(move || {
        let (listener, ipc_token) = match transport::bind("tsumugi-primary") {
            Ok(l) => l,
            Err(e) => {
                eprintln!("tsumugi: Failed to start primary listener: {}", e);
                return;
            }
        };

        for stream in listener.incoming() {
            if let Ok(mut stream) = stream {
                handle_primary_stream(&app, &mut stream, ipc_token.as_deref());
            }
        }
    });
}

const MAX_IPC_SIZE: u64 = 50 * 1024 * 1024;

fn handle_stream(app: &AppHandle, window_label: &str, stream: &mut (impl Read + Write), expected_token: Option<&str>) {
    let mut buf = String::new();
    let read_ok = {
        let mut limited = (&mut *stream).take(MAX_IPC_SIZE);
        limited.read_to_string(&mut buf).is_ok()
    };
    if read_ok {
        // Verify IPC token (Windows)
        if let Some(token) = expected_token {
            match buf.split_once('\n') {
                Some((received, rest)) if received == token => {
                    buf = rest.to_string();
                }
                _ => {
                    let resp = IpcResponse { ok: false, value: Some("Unauthorized".to_string()) };
                    let _ = stream.write_all(serde_json::to_string(&resp).unwrap_or_default().as_bytes());
                    return;
                }
            }
        }

        if let Ok(req) = serde_json::from_str::<IpcRequest>(&buf) {
            let response = match req {
                IpcRequest::Update { body, title } => handle_update(app, window_label, body, title),
                IpcRequest::Query { properties } => handle_query(app, window_label, &properties),
                IpcRequest::Grep { pattern } => handle_grep(app, window_label, &pattern),
                IpcRequest::Lines { start, end } => handle_lines(app, window_label, start, end),
                IpcRequest::Delete { ranges } => handle_delete(app, window_label, ranges),
                IpcRequest::Insert { line, content } => handle_insert(app, window_label, line, &content),
                IpcRequest::Replace { start, end, content } => handle_replace(app, window_label, start, end, &content),
                IpcRequest::CreateWindow { file, body, title } => {
                    match crate::open_document_window(app, file, body, title) {
                        Ok(id) => IpcResponse { ok: true, value: Some(id) },
                        Err(e) => IpcResponse { ok: false, value: Some(e) },
                    }
                }
            };

            let resp_json = serde_json::to_string(&response).unwrap_or_default();
            stream.write_all(resp_json.as_bytes()).ok();
        }
    }
}

fn handle_primary_stream(app: &AppHandle, stream: &mut (impl Read + Write), expected_token: Option<&str>) {
    let mut buf = String::new();
    let read_ok = {
        let mut limited = (&mut *stream).take(MAX_IPC_SIZE);
        limited.read_to_string(&mut buf).is_ok()
    };
    if read_ok {
        // Verify IPC token (Windows)
        if let Some(token) = expected_token {
            match buf.split_once('\n') {
                Some((received, rest)) if received == token => {
                    buf = rest.to_string();
                }
                _ => {
                    let resp = IpcResponse { ok: false, value: Some("Unauthorized".to_string()) };
                    let _ = stream.write_all(serde_json::to_string(&resp).unwrap_or_default().as_bytes());
                    return;
                }
            }
        }

        if let Ok(req) = serde_json::from_str::<IpcRequest>(&buf) {
            let response = match req {
                IpcRequest::CreateWindow { file, body, title } => {
                    match crate::open_document_window(app, file, body, title) {
                        Ok(id) => IpcResponse { ok: true, value: Some(id) },
                        Err(e) => IpcResponse { ok: false, value: Some(e) },
                    }
                }
                _ => IpcResponse { ok: false, value: Some("Primary socket only accepts CreateWindow".to_string()) },
            };

            let resp_json = serde_json::to_string(&response).unwrap_or_default();
            stream.write_all(resp_json.as_bytes()).ok();
        }
    }
}

pub fn list_instances() {
    let dir = transport::instance_dir();
    if !dir.exists() {
        std::process::exit(1);
    }

    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => {
            std::process::exit(1);
        }
    };

    let mut found = false;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e == transport::INSTANCE_EXT).unwrap_or(false) {
            if let Some(id) = path.file_stem().and_then(|s| s.to_str()) {
                // Skip the primary socket
                if id == "tsumugi-primary" {
                    continue;
                }
                if let Ok((mut stream, ipc_token)) = transport::connect(id) {
                    let req = r#"{"type":"Query","properties":["title"]}"#;
                    if let Some(ref token) = ipc_token {
                        stream.write_all(format!("{}\n", token).as_bytes()).ok();
                    }
                    if stream.write_all(req.as_bytes()).is_ok()
                        && stream.shutdown(std::net::Shutdown::Write).is_ok()
                    {
                        let mut buf = String::new();
                        if stream.read_to_string(&mut buf).is_ok() {
                            if let Ok(resp) =
                                serde_json::from_str::<serde_json::Value>(&buf)
                            {
                                let title = resp
                                    .get("value")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Untitled");
                                println!("{}\t{}", id, title);
                                found = true;
                                continue;
                            }
                        }
                    }
                }
                // Stale entry — skip
            }
        }
    }

    if !found {
        std::process::exit(1);
    }
}

/// Returns list of instances as Vec<(id, title)> for API use
pub(crate) fn get_instances() -> Vec<(String, String)> {
    let dir = transport::instance_dir();
    if !dir.exists() {
        return Vec::new();
    }
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };
    let mut result = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e == transport::INSTANCE_EXT).unwrap_or(false) {
            if let Some(id) = path.file_stem().and_then(|s| s.to_str()) {
                // Skip the primary socket
                if id == "tsumugi-primary" {
                    continue;
                }
                if let Ok((mut stream, ipc_token)) = transport::connect(id) {
                    let req = r#"{"type":"Query","properties":["title"]}"#;
                    if let Some(ref token) = ipc_token {
                        stream.write_all(format!("{}\n", token).as_bytes()).ok();
                    }
                    if stream.write_all(req.as_bytes()).is_ok()
                        && stream.shutdown(std::net::Shutdown::Write).is_ok()
                    {
                        let mut buf = String::new();
                        if stream.read_to_string(&mut buf).is_ok() {
                            if let Ok(resp) = serde_json::from_str::<serde_json::Value>(&buf) {
                                let title = resp
                                    .get("value")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Untitled")
                                    .to_string();
                                result.push((id.to_string(), title));
                            }
                        }
                    }
                }
            }
        }
    }
    result
}

// --- Handler functions ---

pub(crate) fn handle_update(app: &AppHandle, window_label: &str, body: Option<String>, title: Option<String>) -> IpcResponse {
    let _ = app.emit_to(window_label, "content-update", serde_json::json!({ "body": body, "title": title }));
    {
        let states = app.state::<WindowStates>();
        let mut states = states.lock().unwrap();
        if let Some(state) = states.get_mut(window_label) {
            if let Some(ref b) = body {
                state.current_content = b.clone();
                state.dirty = true;
            }
            if let Some(ref t) = title {
                state.title = t.clone();
            }
        }
    }
    IpcResponse { ok: true, value: None }
}

fn query_single(state: &crate::state::WindowState, property: &str) -> Option<serde_json::Value> {
    match property {
        "path" => {
            if !state.path_disclosure {
                return None;
            }
            state.saved_path.as_ref().map(|p| serde_json::Value::String(p.clone()))
        }
        "body" => Some(serde_json::Value::String(state.current_content.clone())),
        "title" => Some(serde_json::Value::String(state.title.clone())),
        "status" => {
            Some(serde_json::json!({
                "path": if state.path_disclosure { state.saved_path.clone() } else { None::<String> },
                "title": state.title,
                "saved": state.saved_path.is_some(),
                "dirty": state.dirty,
                "path_disclosure": state.path_disclosure,
            }))
        }
        "linecount" => {
            let count = state.current_content.split('\n').count();
            let count = if state.current_content.ends_with('\n') { count - 1 } else { count };
            Some(serde_json::json!(count))
        }
        _ => None,
    }
}

const ALL_PROPERTIES: &[&str] = &["path", "body", "title", "linecount"];

pub(crate) fn handle_query(app: &AppHandle, window_label: &str, properties: &[String]) -> IpcResponse {
    let states = app.state::<WindowStates>();
    let states = states.lock().unwrap();

    let state = match states.get(window_label) {
        Some(s) => s,
        None => return IpcResponse { ok: false, value: Some(format!("Window not found: {}", window_label)) },
    };

    // Expand "all" into all properties
    let expanded: Vec<&str> = if properties.iter().any(|p| p == "all") {
        ALL_PROPERTIES.to_vec()
    } else {
        properties.iter().map(|s| s.as_str()).collect()
    };

    // Single property: return plain value for backward compatibility
    if expanded.len() == 1 {
        let prop = expanded[0];
        // "status" is already JSON, keep its original behavior
        if prop == "status" {
            if let Some(val) = query_single(state, prop) {
                return IpcResponse { ok: true, value: Some(val.to_string()) };
            }
            return IpcResponse { ok: false, value: None };
        }
        return match query_single(state, prop) {
            Some(serde_json::Value::String(s)) => IpcResponse { ok: true, value: Some(s) },
            Some(val) => IpcResponse { ok: true, value: Some(val.to_string()) },
            None => IpcResponse { ok: false, value: None },
        };
    }

    // Multiple properties: return JSON object
    let mut map = serde_json::Map::new();
    for prop in &expanded {
        if let Some(val) = query_single(state, prop) {
            map.insert(prop.to_string(), val);
        } else {
            map.insert(prop.to_string(), serde_json::Value::Null);
        }
    }
    IpcResponse { ok: true, value: Some(serde_json::Value::Object(map).to_string()) }
}

pub(crate) fn handle_grep(app: &AppHandle, window_label: &str, pattern: &str) -> IpcResponse {
    let states = app.state::<WindowStates>();
    let states = states.lock().unwrap();

    let state = match states.get(window_label) {
        Some(s) => s,
        None => return IpcResponse { ok: false, value: Some(format!("Window not found: {}", window_label)) },
    };

    let regex = match regex::Regex::new(pattern) {
        Ok(r) => r,
        Err(e) => return IpcResponse { ok: false, value: Some(format!("Invalid regex: {}", e)) },
    };

    let mut results = Vec::new();
    for (i, line) in state.current_content.split('\n').enumerate() {
        if regex.is_match(line) {
            results.push(format!("{}:{}", i + 1, line));
        }
    }

    if results.is_empty() {
        IpcResponse { ok: false, value: None }
    } else {
        IpcResponse { ok: true, value: Some(results.join("\n")) }
    }
}

pub(crate) fn handle_lines(app: &AppHandle, window_label: &str, start: usize, end: usize) -> IpcResponse {
    let states = app.state::<WindowStates>();
    let states = states.lock().unwrap();

    let state = match states.get(window_label) {
        Some(s) => s,
        None => return IpcResponse { ok: false, value: Some(format!("Window not found: {}", window_label)) },
    };

    let lines: Vec<&str> = state.current_content.split('\n').collect();
    let total = lines.len();

    if start < 1 || start > total || end < start || end > total {
        return IpcResponse {
            ok: false,
            value: Some(format!("Line range {}-{} out of bounds (1-{})", start, end, total)),
        };
    }

    let mut results = Vec::new();
    for i in (start - 1)..end {
        results.push(format!("{}:{}", i + 1, lines[i]));
    }

    IpcResponse { ok: true, value: Some(results.join("\n")) }
}

/// Apply an edit to current_content and notify frontend
fn apply_edit(app: &AppHandle, window_label: &str, editor: impl FnOnce(&mut Vec<String>) -> Result<(), String>) -> IpcResponse {
    let states = app.state::<WindowStates>();
    let mut states = states.lock().unwrap();

    let state = match states.get_mut(window_label) {
        Some(s) => s,
        None => return IpcResponse { ok: false, value: Some(format!("Window not found: {}", window_label)) },
    };

    let mut lines: Vec<String> = state.current_content.split('\n').map(String::from).collect();

    if let Err(e) = editor(&mut lines) {
        return IpcResponse { ok: false, value: Some(e) };
    }

    let new_content = lines.join("\n");
    state.current_content = new_content.clone();
    state.dirty = true;

    let _ = app.emit_to(window_label, "content-update", serde_json::json!({ "body": new_content }));

    IpcResponse { ok: true, value: None }
}

pub(crate) fn handle_delete(app: &AppHandle, window_label: &str, mut ranges: Vec<(usize, usize)>) -> IpcResponse {
    ranges.sort_by(|a, b| b.0.cmp(&a.0));

    apply_edit(app, window_label, |lines| {
        for (start, end) in &ranges {
            if *start < 1 || *end > lines.len() || *start > *end {
                return Err(format!("Range {}-{} out of bounds (1-{})", start, end, lines.len()));
            }
            lines.drain((start - 1)..*end);
        }
        Ok(())
    })
}

pub(crate) fn handle_insert(app: &AppHandle, window_label: &str, line: usize, content: &str) -> IpcResponse {
    let new_lines: Vec<String> = content.split('\n').map(String::from).collect();

    apply_edit(app, window_label, |lines| {
        if line < 1 || line > lines.len() + 1 {
            return Err(format!("Line {} out of bounds (1-{})", line, lines.len() + 1));
        }
        let insert_pos = line - 1;
        for (i, new_line) in new_lines.iter().enumerate() {
            lines.insert(insert_pos + i, new_line.clone());
        }
        Ok(())
    })
}

pub(crate) fn handle_replace(app: &AppHandle, window_label: &str, start: usize, end: usize, content: &str) -> IpcResponse {
    let new_lines: Vec<String> = if content.is_empty() {
        Vec::new()
    } else {
        content.split('\n').map(String::from).collect()
    };

    apply_edit(app, window_label, |lines| {
        if start < 1 || end > lines.len() || start > end {
            return Err(format!("Range {}-{} out of bounds (1-{})", start, end, lines.len()));
        }
        lines.drain((start - 1)..end);
        for (i, new_line) in new_lines.iter().enumerate() {
            lines.insert(start - 1 + i, new_line.clone());
        }
        Ok(())
    })
}
