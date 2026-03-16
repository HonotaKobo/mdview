mod cli;
mod commands;
mod http_api;
mod i18n;
mod ipc;
mod menu;
pub(crate) mod recent;
mod state;
mod tags;
mod update_checker;
mod watcher;

use std::collections::HashMap;
use std::sync::Mutex;

use clap::Parser;
use tauri::Manager as _;
use recent::{RecentState, RecentStore};
use state::{LastFocusedDoc, WindowMode, WindowState, WindowStates};
use tags::{TagState, TagStore};
use watcher::{FileWatcher, FileWatchers};

/// Strip Windows extended-length path prefix (`\\?\`) from canonicalized paths.
pub(crate) fn normalize_path(path: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        if let Some(stripped) = path.strip_prefix(r"\\?\") {
            return stripped.to_string();
        }
    }
    path.to_string()
}

/// Create a new document window in the current process.
/// Returns the instance_id of the new window.
pub(crate) fn open_document_window(
    app: &tauri::AppHandle,
    file: Option<String>,
    body: Option<String>,
    title: Option<String>,
) -> Result<String, String> {
    // Generate unique label
    let label = format!("doc-{:04x}", rand_u16());

    // Generate instance ID
    let instance_id = if let Some(ref f) = file {
        file_to_id(f)
    } else if body.is_some() {
        format!("body-{:04x}", rand_u16())
    } else {
        format!("gui-{:04x}", rand_u16())
    };

    // Resolve content
    let (content, doc_title, file_path) = if let Some(ref f) = file {
        let abs_path = std::fs::canonicalize(f)
            .unwrap_or_else(|_| std::path::PathBuf::from(f));
        let abs_str = normalize_path(&abs_path.to_string_lossy());
        match std::fs::read_to_string(&abs_path) {
            Ok(c) => {
                let t = abs_path
                    .file_name()
                    .map(|f| f.to_string_lossy().to_string())
                    .unwrap_or_else(|| "Untitled".to_string());
                (c, t, Some(abs_str))
            }
            Err(e) => return Err(format!("Failed to read file: {}", e)),
        }
    } else if let Some(ref b) = body {
        (b.clone(), title.clone().unwrap_or_else(|| "Untitled".to_string()), None)
    } else {
        (String::new(), title.clone().unwrap_or_else(|| "Untitled".to_string()), None)
    };

    // Create window state
    let mut ws = WindowState::new(instance_id.clone(), doc_title.clone(), content);
    ws.content_explicitly_set = file.is_some() || body.is_some();
    if let Some(ref fp) = file_path {
        ws.saved_path = Some(fp.clone());
    }

    // Insert into WindowStates
    {
        let states = app.state::<WindowStates>();
        states.lock().unwrap().insert(label.clone(), ws);
    }

    // Create the window
    let builder = tauri::WebviewWindowBuilder::new(
        app,
        &label,
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title(format!("{} — tsumugi", doc_title))
    .inner_size(900.0, 700.0)
    .min_inner_size(400.0, 300.0);

    #[cfg(target_os = "windows")]
    let builder = builder.decorations(false);

    let _window = builder.build().map_err(|e| e.to_string())?;

    // Start per-window IPC listener
    ipc::start_listener(instance_id.clone(), label.clone(), app.clone());

    // Write HTTP port file (same port as shared server)
    {
        let http_info = app.state::<http_api::HttpServerInfo>();
        let port_path = ipc::instance_file(&instance_id).with_extension("http");
        std::fs::write(&port_path, format!("{}:{}", http_info.port, http_info.token)).ok();
    }

    // Start file watcher if needed
    if let Some(ref fp) = file_path {
        let mut fw = FileWatcher::new();
        fw.watch(app.clone(), label.clone(), fp.clone());
        let watchers = app.state::<FileWatchers>();
        watchers.lock().unwrap().insert(label.clone(), fw);

        // Track in recent files
        let recent = app.state::<RecentState>();
        let mut store = recent.lock().unwrap();
        store.add(fp, &doc_title);
    }

    eprintln!("tsumugi: new window {} (instance: {})", label, instance_id);

    Ok(instance_id)
}

pub fn run() {
    // Set AppUserModelID so all instances share one taskbar button
    #[cfg(target_os = "windows")]
    set_app_user_model_id();

    let mut args = cli::CliArgs::parse();

    // --body - : read from stdin (must happen before daemonize)
    let stdin_read = if args.body.as_deref() == Some("-") {
        use std::io::Read as _;
        let mut input = String::new();
        std::io::stdin()
            .read_to_string(&mut input)
            .expect("tsumugi: failed to read stdin");
        args.body = Some(input);
        true
    } else {
        false
    };

    // Determine the instance ID for the first window
    let id = args.id.clone().unwrap_or_else(|| {
        if args.body.is_some() {
            let auto_id = format!("body-{:04x}", rand_u16());
            println!("{}", auto_id);
            auto_id
        } else if let Some(ref file) = args.file {
            file_to_id(file)
        } else if let Some(ref file) = args.file_pos {
            file_to_id(file)
        } else {
            format!("gui-{:04x}", rand_u16())
        }
    });

    // If --id is specified, try to reach an existing instance
    if args.id.is_some() {
        if ipc::send_to_existing(&id, &args).is_ok() {
            return;
        }
        // Existing instance not found — fall through to launch
    }

    // If this is a read/write operation requiring an existing instance, error out
    if !args.query.is_empty() || args.grep.is_some() || args.lines.is_some()
        || args.delete.is_some() || args.insert.is_some() || args.replace.is_some()
    {
        eprintln!("tsumugi: No instance found with id: {}", id);
        std::process::exit(2);
    }
    if args.list {
        ipc::list_instances();
        return;
    }

    // Try to delegate to an existing primary process (create window there)
    if args.id.is_none() {
        let file_arg = args.file.clone().or_else(|| args.file_pos.clone());
        if ipc::send_create_window(file_arg, args.body.clone(), args.title.clone()).is_ok() {
            return;
        }
        // No primary process — fall through to become one
    }

    // Daemonize: re-launch self in background so the terminal is freed immediately
    #[cfg(target_os = "macos")]
    let should_daemonize = !args.foreground && {
        use std::io::IsTerminal;
        std::io::stdin().is_terminal()
            || args.body.is_some()
            || args.file.is_some()
            || args.file_pos.is_some()
    };
    #[cfg(not(target_os = "macos"))]
    let should_daemonize = !args.foreground && {
        use std::io::IsTerminal;
        std::io::stdin().is_terminal()
    };

    if should_daemonize {
        let exe = std::env::current_exe().expect("failed to get executable path");
        let mut child_args: Vec<String> = std::env::args().skip(1).collect();
        child_args.push("--_foreground".to_string());
        // Pass auto-generated ID explicitly so the child doesn't regenerate it
        if args.id.is_none() {
            child_args.push("--id".to_string());
            child_args.push(id.clone());
        }
        use std::process::{Command, Stdio};

        // On macOS, launch through the .app bundle via `open` so that
        // the Dock shows the proper app icon.
        #[cfg(target_os = "macos")]
        let use_open = !stdin_read && find_app_bundle(&exe).is_some();
        #[cfg(not(target_os = "macos"))]
        let use_open = false;

        if use_open {
            #[cfg(target_os = "macos")]
            {
                let bundle = find_app_bundle(&exe).unwrap();
                let mut cmd = Command::new("open");
                cmd.arg("-n")
                    .arg("-a")
                    .arg(&bundle)
                    .arg("--args");
                cmd.args(&child_args);
                cmd.stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .stdin(Stdio::null());
                cmd.spawn().expect("failed to launch tsumugi via open");
            }
        } else {
            let mut cmd = Command::new(&exe);
            cmd.args(&child_args)
                .stdout(Stdio::null())
                .stderr(Stdio::inherit());

            if stdin_read {
                // Pipe the stdin content to the child process (which will read it via --body -)
                cmd.stdin(Stdio::piped());
                let mut child = cmd.spawn().expect("failed to launch tsumugi");
                if let Some(mut child_stdin) = child.stdin.take() {
                    use std::io::Write as _;
                    child_stdin
                        .write_all(args.body.as_deref().unwrap_or("").as_bytes())
                        .ok();
                }
            } else {
                cmd.stdin(Stdio::null());
                cmd.spawn().expect("failed to launch tsumugi");
            }
        }
        return;
    }

    let initial_content = args.body.clone().unwrap_or_default();
    let initial_title = args.title.clone().unwrap_or_else(|| "Untitled".to_string());
    let initial_file = args.file.clone().or_else(|| args.file_pos.clone());

    // For file mode: read content upfront and store in state
    let (resolved_content, resolved_title, resolved_file_path) = if !initial_content.is_empty() {
        (initial_content.clone(), initial_title.clone(), None)
    } else if let Some(ref file_path) = initial_file {
        let abs_path = std::fs::canonicalize(file_path)
            .unwrap_or_else(|_| std::path::PathBuf::from(file_path));
        let abs_path_str = normalize_path(&abs_path.to_string_lossy());
        match std::fs::read_to_string(&abs_path) {
            Ok(content) => {
                let title = abs_path
                    .file_name()
                    .map(|f| f.to_string_lossy().to_string())
                    .unwrap_or_else(|| "Untitled".to_string());
                (content, title, Some(abs_path_str))
            }
            Err(e) => {
                eprintln!("tsumugi: Failed to read file: {}", e);
                (String::new(), initial_title.clone(), None)
            }
        }
    } else {
        (String::new(), initial_title.clone(), None)
    };

    let content_explicitly_set = args.body.is_some() || initial_file.is_some();
    let is_home_mode = initial_file.is_none() && args.body.is_none();
    let mut app_state = WindowState::new(id.clone(), resolved_title, resolved_content);
    app_state.content_explicitly_set = content_explicitly_set;
    if is_home_mode {
        app_state.window_mode = WindowMode::Home;
    }
    if let Some(ref fp) = resolved_file_path {
        app_state.saved_path = Some(fp.clone());
    }

    // Prepare initial states
    let mut initial_states = HashMap::new();
    initial_states.insert("main".to_string(), app_state);

    let id_for_setup = id.clone();
    let resolved_file_path_for_setup = resolved_file_path.clone();

    let i18n = i18n::I18n::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(initial_states) as WindowStates)
        .manage(Mutex::new(HashMap::<String, FileWatcher>::new()) as FileWatchers)
        .manage(Mutex::new("main".to_string()) as LastFocusedDoc)
        .manage(TagState::new(TagStore::load()))
        .manage(RecentState::new(RecentStore::load()))
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::save_file,
            commands::save_binary_file,
            commands::notify_saved,
            commands::get_saved_path,
            commands::sync_content,
            commands::get_initial_content,
            commands::rename_file,
            commands::get_translations,
            commands::get_platform,
            commands::execute_menu_action,
            commands::open_new_window,
            commands::tag_add,
            commands::tag_remove,
            commands::tag_set,
            commands::tag_get,
            commands::tag_get_all,
            commands::tag_delete_entry,
            commands::tag_relink,
            commands::tag_validate_paths,
            commands::tag_get_all_unique_tags,
            commands::tag_batch_add,
            commands::tag_rename_all,
            commands::tag_remove_all,
            commands::tag_get_counts,
            commands::get_custom_locale_path,
            commands::check_for_updates,
            commands::perform_update,
            commands::restart_app,
            commands::recent_get_all,
            commands::recent_add,
            commands::recent_remove,
            commands::recent_clear,
            commands::get_window_mode,
        ])
        .setup(move |app| {
            let menu = menu::build_menu(app.handle(), &i18n)?;
            app.set_menu(menu)?;

            // On Windows, disable native decorations for custom title bar
            #[cfg(target_os = "windows")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_decorations(false);
                }
            }

            app.manage(i18n::I18nState::new(i18n));

            // Start shared HTTP server
            let (http_port, http_token) = http_api::start_http_server(app.handle().clone());
            app.manage(http_api::HttpServerInfo { port: http_port, token: http_token.clone() });

            // Write HTTP port file for the initial window
            let port_path = ipc::instance_file(&id_for_setup).with_extension("http");
            std::fs::write(&port_path, format!("{}:{}", http_port, http_token)).ok();
            eprintln!("tsumugi: HTTP API listening on http://127.0.0.1:{}", http_port);
            eprintln!("tsumugi: port file: {}", port_path.display());

            // Start per-window IPC listener for initial window
            ipc::start_listener(id_for_setup.clone(), "main".to_string(), app.handle().clone());

            // Start primary socket listener
            ipc::start_primary_listener(app.handle().clone());

            // Start file watcher for initial window if needed
            if let Some(ref fp) = resolved_file_path_for_setup {
                let mut fw = FileWatcher::new();
                fw.watch(app.handle().clone(), "main".to_string(), fp.clone());
                let watchers = app.state::<FileWatchers>();
                watchers.lock().unwrap().insert("main".to_string(), fw);

                // Track in recent files
                let title = std::path::Path::new(fp)
                    .file_name()
                    .map(|f| f.to_string_lossy().to_string())
                    .unwrap_or_else(|| "Untitled".to_string());
                let recent = app.state::<RecentState>();
                let mut store = recent.lock().unwrap();
                store.add(fp, &title);
            }

            Ok(())
        })
        .on_menu_event(|app, event| {
            menu::handle_menu_event(app, event);
        })
        .on_window_event(|window, event| {
            let label = window.label().to_string();

            match event {
                // Track focus for document windows and home window
                tauri::WindowEvent::Focused(true) => {
                    if label == "main" || label.starts_with("doc-") || label.starts_with("main-home") {
                        let app = window.app_handle();
                        let last_focused = app.state::<LastFocusedDoc>();
                        *last_focused.lock().unwrap() = label;
                    }
                }
                // Clean up on window destroy
                tauri::WindowEvent::Destroyed => {
                    // Skip non-document windows (about only)
                    if label != "main" && !label.starts_with("doc-") && !label.starts_with("main-home") {
                        // But clean up about window state if it exists
                        if label == "about" {
                            let app = window.app_handle();
                            let states = app.state::<WindowStates>();
                            states.lock().unwrap().remove(&label);
                        }
                        return;
                    }

                    let app = window.app_handle();

                    // Remove state and get instance_id for cleanup
                    let instance_id;
                    let should_exit;
                    {
                        let states = app.state::<WindowStates>();
                        let mut states = states.lock().unwrap();
                        instance_id = states.get(&label).map(|s| s.instance_id.clone());
                        states.remove(&label);
                        // Check if any document windows remain
                        should_exit = !states.values().any(|s| {
                            // about window is not a document window
                            s.instance_id != "about"
                        });
                    }

                    // Clean up IPC socket and HTTP port file
                    if let Some(ref id) = instance_id {
                        let path = ipc::instance_file(id);
                        std::fs::remove_file(&path).ok();
                        std::fs::remove_file(path.with_extension("http")).ok();
                    }

                    // Clean up file watcher
                    {
                        let watchers = app.state::<FileWatchers>();
                        watchers.lock().unwrap().remove(&label);
                    }

                    // If no document windows remain, exit app
                    if should_exit {
                        app.exit(0);
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| {
            // macOS file association: open file in a new window
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        let path_str = path.to_string_lossy().to_string();
                        let _ = open_document_window(
                            _app_handle,
                            Some(path_str),
                            None,
                            None,
                        );
                    }
                }
                {
                    let states = _app_handle.state::<WindowStates>();
                    let is_home = {
                        let guard = states.lock().unwrap();
                        guard.get("main").map_or(false, |s| {
                            matches!(s.window_mode, WindowMode::Home)
                        })
                    };
                    if is_home {
                        if let Some(window) = _app_handle.get_webview_window("main") {
                            let _ = window.destroy();
                        }
                    }
                }
            }
            match event {
                tauri::RunEvent::Exit => {
                    // Clean up primary socket
                    let primary_path = ipc::instance_file("tsumugi-primary");
                    std::fs::remove_file(&primary_path).ok();
                }
                _ => {}
            }
        });
}

fn file_to_id(file: &str) -> String {
    let canonical = std::fs::canonicalize(file)
        .unwrap_or_else(|_| std::path::PathBuf::from(file));
    let path_str = canonical.to_string_lossy();
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    std::hash::Hasher::write(&mut hasher, path_str.as_bytes());
    let hash = std::hash::Hasher::finish(&hasher);
    let name = std::path::Path::new(file)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string())
        .to_lowercase()
        .replace('.', "-")
        .replace(' ', "-");
    format!("file-{}-{:016x}", name, hash)
}

fn rand_u16() -> u16 {
    let mut buf = [0u8; 2];
    // Simple random using time
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    buf[0] = (t & 0xFF) as u8;
    buf[1] = ((t >> 8) & 0xFF) as u8;
    u16::from_le_bytes(buf)
}

/// Walk up from the executable path to find the enclosing .app bundle.
#[cfg(target_os = "macos")]
fn find_app_bundle(exe: &std::path::Path) -> Option<std::path::PathBuf> {
    let mut path = exe.to_path_buf();
    loop {
        if path.extension().map_or(false, |ext| ext == "app") {
            return Some(path);
        }
        if !path.pop() {
            return None;
        }
    }
}

/// Set the AppUserModelID so that all tsumugi instances share a single taskbar button.
#[cfg(target_os = "windows")]
fn set_app_user_model_id() {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "shell32")]
    extern "system" {
        fn SetCurrentProcessExplicitAppUserModelID(app_id: *const u16) -> i32;
    }

    let id: Vec<u16> = std::ffi::OsStr::new("com.tsumugi.app")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        SetCurrentProcessExplicitAppUserModelID(id.as_ptr());
    }
}
