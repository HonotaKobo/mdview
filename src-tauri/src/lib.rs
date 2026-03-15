mod cli;
mod commands;
mod http_api;
mod i18n;
mod ipc;
mod menu;
mod state;
mod tags;
mod watcher;

use clap::Parser;
#[cfg(target_os = "macos")]
use tauri::Emitter;
use tauri::Manager as _;
use state::{AppState, AppStateInner};
use tags::{TagState, TagStore};
use watcher::FileWatcher;

pub fn run() {
    let mut args = cli::CliArgs::parse();

    // --body - : read from stdin (must happen before daemonize)
    let stdin_read = if args.body.as_deref() == Some("-") {
        use std::io::Read as _;
        let mut input = String::new();
        std::io::stdin()
            .read_to_string(&mut input)
            .expect("mdcast: failed to read stdin");
        args.body = Some(input);
        true
    } else {
        false
    };

    // Determine the instance ID
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
        eprintln!("mdcast: No instance found with id: {}", id);
        std::process::exit(2);
    }
    if args.list {
        ipc::list_instances();
        return;
    }

    // Daemonize: re-launch self in background so the terminal is freed immediately
    if !args.foreground {
        let exe = std::env::current_exe().expect("failed to get executable path");
        let mut child_args: Vec<String> = std::env::args().skip(1).collect();
        child_args.push("--_foreground".to_string());
        // Pass auto-generated ID explicitly so the child doesn't regenerate it
        if args.id.is_none() {
            child_args.push("--id".to_string());
            child_args.push(id.clone());
        }
        use std::process::{Command, Stdio};
        let mut cmd = Command::new(exe);
        cmd.args(&child_args)
            .stdout(Stdio::null())
            .stderr(Stdio::inherit());

        if stdin_read {
            // Pipe the stdin content to the child process (which will read it via --body -)
            cmd.stdin(Stdio::piped());
            let mut child = cmd.spawn().expect("failed to launch mdcast");
            if let Some(mut child_stdin) = child.stdin.take() {
                use std::io::Write as _;
                child_stdin
                    .write_all(args.body.as_deref().unwrap_or("").as_bytes())
                    .ok();
            }
        } else {
            cmd.stdin(Stdio::null());
            cmd.spawn().expect("failed to launch mdcast");
        }
        return;
    }

    let initial_content = args.body.clone().unwrap_or_default();
    let initial_title = args.title.clone().unwrap_or_else(|| "Untitled".to_string());
    let initial_file = args.file.clone().or_else(|| args.file_pos.clone());

    // For file mode: read content upfront and store in AppState
    let (resolved_content, resolved_title, resolved_file_path) = if !initial_content.is_empty() {
        (initial_content.clone(), initial_title.clone(), None)
    } else if let Some(ref file_path) = initial_file {
        let abs_path = std::fs::canonicalize(file_path)
            .unwrap_or_else(|_| std::path::PathBuf::from(file_path));
        let abs_path_str = abs_path.to_string_lossy().to_string();
        match std::fs::read_to_string(&abs_path) {
            Ok(content) => {
                let title = abs_path
                    .file_name()
                    .map(|f| f.to_string_lossy().to_string())
                    .unwrap_or_else(|| "Untitled".to_string());
                (content, title, Some(abs_path_str))
            }
            Err(e) => {
                eprintln!("mdcast: Failed to read file: {}", e);
                (String::new(), initial_title.clone(), None)
            }
        }
    } else {
        (String::new(), initial_title.clone(), None)
    };

    let content_explicitly_set = args.body.is_some() || initial_file.is_some();
    let mut app_state = AppStateInner::new(resolved_title, resolved_content);
    app_state.content_explicitly_set = content_explicitly_set;
    if let Some(ref fp) = resolved_file_path {
        app_state.saved_path = Some(fp.clone());
    }

    let id_for_setup = id.clone();
    let id_for_exit = id.clone();

    let i18n = i18n::I18n::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new(app_state))
        .manage(TagState::new(TagStore::load()))
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

            app.manage(i18n);

            ipc::start_listener(id_for_setup.clone(), app.handle().clone());
            let http_port = http_api::start_http_server(id_for_setup.clone(), app.handle().clone());
            let port_path = ipc::instance_file(&id_for_setup).with_extension("http");
            eprintln!("mdcast: HTTP API listening on http://127.0.0.1:{}", http_port);
            eprintln!("mdcast: port file: {}", port_path.display());

            // Start file watcher for file mode
            if let Some(ref fp) = resolved_file_path {
                let mut watcher = FileWatcher::new();
                watcher.watch(app.handle().clone(), fp.clone());
                // Keep watcher alive by managing it in Tauri state
                app.manage(std::sync::Mutex::new(watcher));
            }

            Ok(())
        })
        .on_menu_event(|app, event| {
            menu::handle_menu_event(app, event);
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        if let Ok(content) = std::fs::read_to_string(&path) {
                            let title = path
                                .file_name()
                                .map(|f: &std::ffi::OsStr| f.to_string_lossy().to_string())
                                .unwrap_or_else(|| "Untitled".to_string());
                            let abs_path = path.to_string_lossy().to_string();

                            {
                                let state = _app_handle.state::<AppState>();
                                let mut state = state.lock().unwrap();
                                state.current_content = content.clone();
                                state.title = title.clone();
                                state.saved_path = Some(abs_path);
                                state.dirty = false;
                            }

                            let _ = _app_handle.emit("content-update", serde_json::json!({
                                "body": content,
                                "title": title,
                            }));
                        }
                    }
                }
            }
            match event {
                tauri::RunEvent::Exit => {
                    let path = ipc::instance_file(&id_for_exit);
                    std::fs::remove_file(&path).ok();
                    // Clean up HTTP port file
                    std::fs::remove_file(path.with_extension("http")).ok();
                }
                _ => {}
            }
        });
}

fn file_to_id(file: &str) -> String {
    let name = std::path::Path::new(file)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| file.to_string());
    format!(
        "file-{}",
        name.to_lowercase()
            .replace('.', "-")
            .replace(' ', "-")
    )
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
