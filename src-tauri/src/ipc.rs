use std::io::{Read, Write};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::cli::CliArgs;
use crate::state::AppState;

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
        let dir = std::env::temp_dir().join(format!("mdcast-{}", uid));
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

    pub fn connect(id: &str) -> std::io::Result<Stream> {
        let path = instance_file(id);
        let stream = UnixStream::connect(&path)?;
        stream.set_read_timeout(Some(std::time::Duration::from_secs(5)))?;
        stream.set_write_timeout(Some(std::time::Duration::from_secs(5)))?;
        Ok(stream)
    }

    pub fn bind(id: &str) -> std::io::Result<Listener> {
        let path = instance_file(id);
        std::fs::remove_file(&path).ok();
        UnixListener::bind(&path)
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
        let dir = std::env::temp_dir().join(format!("mdcast-{}", username));
        if !dir.exists() {
            std::fs::create_dir_all(&dir).ok();
        }
        dir
    }

    pub fn instance_file(id: &str) -> PathBuf {
        instance_dir().join(format!("{}.{}", id, INSTANCE_EXT))
    }

    pub fn connect(id: &str) -> std::io::Result<Stream> {
        let port_path = instance_file(id);
        let port_str = std::fs::read_to_string(&port_path)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e))?;
        let port: u16 = port_str
            .trim()
            .parse()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        let stream = TcpStream::connect(("127.0.0.1", port))?;
        stream.set_read_timeout(Some(std::time::Duration::from_secs(5)))?;
        stream.set_write_timeout(Some(std::time::Duration::from_secs(5)))?;
        Ok(stream)
    }

    pub fn bind(id: &str) -> std::io::Result<Listener> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        let port_path = instance_file(id);
        std::fs::write(&port_path, port.to_string())?;
        Ok(listener)
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

pub fn send_to_existing(id: &str, args: &CliArgs) -> Result<(), Box<dyn std::error::Error>> {
    let mut stream = transport::connect(id)?;

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
        let content = args.content.as_ref().ok_or("mdcast: --content is required with --insert")?;
        serde_json::json!({ "type": "Insert", "line": line, "content": content })
    } else if let Some(ref range) = args.replace {
        let (start, end) = parse_single_range(range)?;
        let content = args.content.as_ref().ok_or("mdcast: --content is required with --replace")?;
        serde_json::json!({ "type": "Replace", "start": start, "end": end, "content": content })
    } else {
        serde_json::json!({ "type": "Update", "body": args.body, "title": args.title })
    };

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
                eprintln!("mdcast: {}", value);
            }
            std::process::exit(1);
        }
    }

    // Write operations: exit code only
    if !resp.ok {
        if let Some(value) = resp.value {
            eprintln!("mdcast: {}", value);
        }
        std::process::exit(1);
    }

    Ok(())
}

pub fn start_listener(id: String, app: AppHandle) {
    std::thread::spawn(move || {
        let listener = match transport::bind(&id) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("mdcast: Failed to start IPC listener: {}", e);
                return;
            }
        };

        for stream in listener.incoming() {
            if let Ok(mut stream) = stream {
                handle_stream(&app, &mut stream);
            }
        }
    });
}

fn handle_stream(app: &AppHandle, stream: &mut (impl Read + Write)) {
    let mut buf = String::new();
    if stream.read_to_string(&mut buf).is_ok() {
        if let Ok(req) = serde_json::from_str::<IpcRequest>(&buf) {
            let response = match req {
                IpcRequest::Update { body, title } => handle_update(app, body, title),
                IpcRequest::Query { properties } => handle_query(app, &properties),
                IpcRequest::Grep { pattern } => handle_grep(app, &pattern),
                IpcRequest::Lines { start, end } => handle_lines(app, start, end),
                IpcRequest::Delete { ranges } => handle_delete(app, ranges),
                IpcRequest::Insert { line, content } => handle_insert(app, line, &content),
                IpcRequest::Replace { start, end, content } => handle_replace(app, start, end, &content),
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
                if let Ok(mut stream) = transport::connect(id) {
                    let req = r#"{"type":"Query","properties":["title"]}"#;
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
                if let Ok(mut stream) = transport::connect(id) {
                    let req = r#"{"type":"Query","properties":["title"]}"#;
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

pub(crate) fn handle_update(app: &AppHandle, body: Option<String>, title: Option<String>) -> IpcResponse {
    let _ = app.emit("content-update", serde_json::json!({ "body": body, "title": title }));
    {
        let state = app.state::<AppState>();
        let mut state = state.lock().unwrap();
        if let Some(ref b) = body {
            state.current_content = b.clone();
            state.dirty = true;
        }
        if let Some(ref t) = title {
            state.title = t.clone();
        }
    }
    IpcResponse { ok: true, value: None }
}

fn query_single(state: &crate::state::AppStateInner, property: &str) -> Option<serde_json::Value> {
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

pub(crate) fn handle_query(app: &AppHandle, properties: &[String]) -> IpcResponse {
    let state = app.state::<AppState>();
    let state = state.lock().unwrap();

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
            if let Some(val) = query_single(&state, prop) {
                return IpcResponse { ok: true, value: Some(val.to_string()) };
            }
            return IpcResponse { ok: false, value: None };
        }
        return match query_single(&state, prop) {
            Some(serde_json::Value::String(s)) => IpcResponse { ok: true, value: Some(s) },
            Some(val) => IpcResponse { ok: true, value: Some(val.to_string()) },
            None => IpcResponse { ok: false, value: None },
        };
    }

    // Multiple properties: return JSON object
    let mut map = serde_json::Map::new();
    for prop in &expanded {
        if let Some(val) = query_single(&state, prop) {
            map.insert(prop.to_string(), val);
        } else {
            map.insert(prop.to_string(), serde_json::Value::Null);
        }
    }
    IpcResponse { ok: true, value: Some(serde_json::Value::Object(map).to_string()) }
}

pub(crate) fn handle_grep(app: &AppHandle, pattern: &str) -> IpcResponse {
    let state = app.state::<AppState>();
    let state = state.lock().unwrap();

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

pub(crate) fn handle_lines(app: &AppHandle, start: usize, end: usize) -> IpcResponse {
    let state = app.state::<AppState>();
    let state = state.lock().unwrap();

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
fn apply_edit(app: &AppHandle, editor: impl FnOnce(&mut Vec<String>) -> Result<(), String>) -> IpcResponse {
    let state = app.state::<AppState>();
    let mut state = state.lock().unwrap();

    let mut lines: Vec<String> = state.current_content.split('\n').map(String::from).collect();

    if let Err(e) = editor(&mut lines) {
        return IpcResponse { ok: false, value: Some(e) };
    }

    let new_content = lines.join("\n");
    state.current_content = new_content.clone();
    state.dirty = true;

    let _ = app.emit("content-update", serde_json::json!({ "body": new_content }));

    IpcResponse { ok: true, value: None }
}

pub(crate) fn handle_delete(app: &AppHandle, mut ranges: Vec<(usize, usize)>) -> IpcResponse {
    ranges.sort_by(|a, b| b.0.cmp(&a.0));

    apply_edit(app, |lines| {
        for (start, end) in &ranges {
            if *start < 1 || *end > lines.len() || *start > *end {
                return Err(format!("Range {}-{} out of bounds (1-{})", start, end, lines.len()));
            }
            lines.drain((start - 1)..*end);
        }
        Ok(())
    })
}

pub(crate) fn handle_insert(app: &AppHandle, line: usize, content: &str) -> IpcResponse {
    let new_lines: Vec<String> = content.split('\n').map(String::from).collect();

    apply_edit(app, |lines| {
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

pub(crate) fn handle_replace(app: &AppHandle, start: usize, end: usize, content: &str) -> IpcResponse {
    let new_lines: Vec<String> = if content.is_empty() {
        Vec::new()
    } else {
        content.split('\n').map(String::from).collect()
    };

    apply_edit(app, |lines| {
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
