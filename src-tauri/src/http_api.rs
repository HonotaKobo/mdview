use std::io::Read as _;

use serde::Deserialize;
use tauri::{AppHandle, Manager};
use tiny_http::{Header, Method, Response, Server};

use crate::ipc;
use crate::state::{LastFocusedDoc, WindowStates};

/// HTTPサーバー情報（全ウィンドウで共有）
pub struct HttpServerInfo {
    pub port: u16,
    pub token: String,
}

/// PDFエクスポート用のワンタイムHTMLコンテンツストア
pub type PdfContentStore = std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String, String>>>;

/// CSPRNGを使用してAPI認証用のランダムな16進トークンを生成する。
pub fn generate_token() -> String {
    let mut buf = [0u8; 16];
    getrandom::getrandom(&mut buf).expect("failed to generate random token");
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}

/// ランダムなlocalhostポートでHTTP APIサーバーを起動する。
/// (port, token)を返す。呼び出し元がウィンドウごとにポートファイルを書き込む。
pub fn start_http_server(app: AppHandle, pdf_store: PdfContentStore) -> (u16, String) {
    let server = Server::http("127.0.0.1:0").expect("failed to start HTTP API server");
    let port = server.server_addr().to_ip().unwrap().port();
    let token = generate_token();

    let expected_token = token.clone();

    std::thread::spawn(move || {
        for mut request in server.incoming_requests() {
            // /pdf-content/<token> エンドポイント: Bearer認証の前に処理
            // ワンタイムトークン自体が認証の役割を果たす
            let url = request.url().to_string();
            if let Some(pdf_token) = url.strip_prefix("/pdf-content/") {
                // クエリ文字列を除去
                let pdf_token = pdf_token.split('?').next().unwrap_or(pdf_token);
                let html = pdf_store.lock().unwrap().remove(pdf_token);
                if let Some(html) = html {
                    let ct: Header = "Content-Type: text/html; charset=utf-8".parse().unwrap();
                    let _ = request.respond(
                        Response::from_string(html).with_header(ct),
                    );
                } else {
                    let _ = request.respond(
                        Response::from_string("Not Found").with_status_code(404),
                    );
                }
                continue;
            }

            // トークン認証を確認
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

/// Authorizationヘッダーからのベアラートークンを検証する。
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

const MAX_BODY_SIZE: u64 = 50 * 1024 * 1024;

fn read_body(request: &mut tiny_http::Request) -> Result<String, String> {
    let mut body = String::new();
    request.as_reader().take(MAX_BODY_SIZE).read_to_string(&mut body)
        .map_err(|e| format!("Failed to read body: {}", e))?;
    Ok(body)
}

fn error_response(msg: &str) -> ipc::IpcResponse {
    ipc::IpcResponse {
        ok: false,
        value: Some(msg.to_string()),
    }
}

/// リクエストヘッダーからContent-Typeを取得する（charsetなどのパラメータは除く）。
fn get_content_type(request: &tiny_http::Request) -> String {
    for header in request.headers() {
        if header.field.as_str().to_ascii_lowercase() == "content-type" {
            let value = header.value.as_str();
            return value.split(';').next().unwrap_or(value).trim().to_lowercase();
        }
    }
    String::new()
}

/// URL文字列からクエリパラメータの値を取得する。
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

/// URLエンコードされた文字列をパーセントデコードする（+をスペースとして、%XXシーケンスを処理）。
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

/// 無効なJSONエスケープシーケンスを修正する（例: コードブロック内の正規表現による\d, \s, \w）。
/// 1文字ずつ走査し、有効なエスケープ（\n, \\, \"など）はそのまま保持する。
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
                        // 無効なJSONエスケープ: バックスラッシュを追加
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

/// JSONのパースを試み、失敗した場合は無効なエスケープシーケンスを修正して再試行する。
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

/// リクエストURLの`?id=`パラメータからウィンドウラベルを解決する。
/// `id`がWindowStates内のinstance_idに一致する場合、対応するウィンドウラベルを返す。
/// それ以外の場合は、最後にフォーカスされたドキュメントウィンドウにフォールバックする。
fn resolve_window_label(app: &AppHandle, url: &str) -> String {
    if let Some(id) = parse_query_param(url, "id") {
        let states = app.state::<WindowStates>();
        let states = states.lock().unwrap();
        if let Some((label, _)) = states.iter().find(|(_, s)| s.instance_id == id) {
            return label.clone();
        }
        // idをウィンドウラベルとして直接使用を試みる
        if states.contains_key(&id) {
            return id;
        }
    }
    // デフォルトで最後にフォーカスされたドキュメントを使用
    let focused = app.state::<LastFocusedDoc>();
    let label = focused.lock().unwrap().clone();
    label
}

fn handle_request(app: &AppHandle, request: &mut tiny_http::Request) -> ipc::IpcResponse {
    let url = request.url().to_string();
    let method = request.method().clone();

    // ルーティングのためクエリ文字列を除去
    let path = url.split('?').next().unwrap_or(&url);

    // 対象ウィンドウを解決
    let window_label = resolve_window_label(app, &url);

    match (method, path) {
        // パススルー: IpcRequest JSONを直接受け付ける
        (Method::Post, "/") => {
            let body = match read_body(request) {
                Ok(b) => b,
                Err(e) => return error_response(&e),
            };
            match parse_json_lenient::<ipc::IpcRequest>(&body) {
                Ok(req) => dispatch_ipc_request(app, &window_label, req),
                Err(e) => error_response(&e),
            }
        }

        // RESTスタイルのエンドポイント
        (Method::Post, "/update") => {
            let content_type = get_content_type(request);
            let body = match read_body(request) {
                Ok(b) => b,
                Err(e) => return error_response(&e),
            };

            if content_type == "text/markdown" || content_type == "text/plain" {
                // 生ボディモード: ボディはMarkdownテキスト、タイトルはクエリパラメータから取得
                let title = parse_query_param(&url, "title");
                ipc::handle_update(app, &window_label, Some(body), title)
            } else {
                // JSONモード（デフォルト、後方互換）
                match parse_json_lenient::<UpdateRequest>(&body) {
                    Ok(r) => ipc::handle_update(app, &window_label, r.body, r.title),
                    Err(e) => error_response(&e),
                }
            }
        }
        (Method::Post, "/query") => {
            let body = match read_body(request) {
                Ok(b) => b,
                Err(e) => return error_response(&e),
            };
            match parse_json_lenient::<QueryRequest>(&body) {
                Ok(r) => ipc::handle_query(app, &window_label, &r.properties),
                Err(e) => error_response(&e),
            }
        }
        (Method::Post, "/grep") => {
            let content_type = get_content_type(request);
            let body = match read_body(request) {
                Ok(b) => b,
                Err(e) => return error_response(&e),
            };

            if content_type == "text/plain" {
                // 生ボディモード: ボディは正規表現パターン
                ipc::handle_grep(app, &window_label, &body)
            } else {
                match parse_json_lenient::<GrepRequest>(&body) {
                    Ok(r) => ipc::handle_grep(app, &window_label, &r.pattern),
                    Err(e) => error_response(&e),
                }
            }
        }
        (Method::Post, "/lines") => {
            let body = match read_body(request) {
                Ok(b) => b,
                Err(e) => return error_response(&e),
            };
            match parse_json_lenient::<LinesRequest>(&body) {
                Ok(r) => ipc::handle_lines(app, &window_label, r.start, r.end),
                Err(e) => error_response(&e),
            }
        }
        (Method::Post, "/edit/delete") => {
            let body = match read_body(request) {
                Ok(b) => b,
                Err(e) => return error_response(&e),
            };
            match parse_json_lenient::<DeleteRequest>(&body) {
                Ok(r) => ipc::handle_delete(app, &window_label, r.ranges),
                Err(e) => error_response(&e),
            }
        }
        (Method::Post, "/edit/insert") => {
            let content_type = get_content_type(request);
            let body = match read_body(request) {
                Ok(b) => b,
                Err(e) => return error_response(&e),
            };

            if content_type == "text/markdown" || content_type == "text/plain" {
                // 生ボディモード: ボディはコンテンツ、行番号はクエリパラメータから取得
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
            let body = match read_body(request) {
                Ok(b) => b,
                Err(e) => return error_response(&e),
            };

            if content_type == "text/markdown" || content_type == "text/plain" {
                // 生ボディモード: ボディはコンテンツ、start/endはクエリパラメータから取得
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

// --- RESTエンドポイント用のリクエスト構造体 ---

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
