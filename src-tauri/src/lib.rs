mod cli;
mod commands;
mod ipc;
mod state;
mod watcher;

use clap::Parser;
use tauri::Manager as _;
use state::{AppState, AppStateInner};
use watcher::FileWatcher;

pub fn run() {
    let args = cli::CliArgs::parse();

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
        eprintln!("mdview: No instance found with id: {}", id);
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
        Command::new(exe)
            .args(&child_args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("failed to launch mdview");
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
                eprintln!("mdview: Failed to read file: {}", e);
                (String::new(), initial_title.clone(), None)
            }
        }
    } else {
        (String::new(), initial_title.clone(), None)
    };

    let mut app_state = AppStateInner::new(resolved_title, resolved_content);
    if let Some(ref fp) = resolved_file_path {
        app_state.saved_path = Some(fp.clone());
    }

    let id_for_setup = id.clone();
    let id_for_exit = id.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState::new(app_state))
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::save_file,
            commands::notify_saved,
            commands::get_saved_path,
            commands::get_initial_content,
        ])
        .setup(move |app| {
            ipc::start_listener(id_for_setup.clone(), app.handle().clone());

            // Start file watcher for file mode
            if let Some(ref fp) = resolved_file_path {
                let mut watcher = FileWatcher::new();
                watcher.watch(app.handle().clone(), fp.clone());
                // Keep watcher alive by managing it in Tauri state
                app.manage(std::sync::Mutex::new(watcher));
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                let path = ipc::instance_file(&id_for_exit);
                std::fs::remove_file(&path).ok();
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

