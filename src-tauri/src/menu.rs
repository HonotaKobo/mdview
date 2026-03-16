use tauri::{
    menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    AppHandle, Emitter, Manager, Wry,
};
#[cfg(target_os = "macos")]
use tauri::menu::PredefinedMenuItem;

use crate::i18n::{I18n, I18nState, Locale, save_locale_setting};

pub fn build_menu(app: &AppHandle, i18n: &I18n) -> tauri::Result<tauri::menu::Menu<Wry>> {
    // --- File menu ---
    let file_menu = SubmenuBuilder::new(app, i18n.t("menu.file"))
        .item(&MenuItemBuilder::with_id("file_new_window", i18n.t("menu.file_new_window"))
            .accelerator("CmdOrCtrl+N")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("file_open", i18n.t("menu.file_open"))
            .accelerator("CmdOrCtrl+O")
            .build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("file_save", i18n.t("menu.file_save"))
            .accelerator("CmdOrCtrl+S")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("file_save_as", i18n.t("menu.file_save_as"))
            .accelerator("CmdOrCtrl+Shift+S")
            .build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("file_reload", i18n.t("menu.file_reload"))
            .accelerator("CmdOrCtrl+R")
            .build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("file_export_pdf", i18n.t("menu.file_export_pdf"))
            .accelerator("CmdOrCtrl+Shift+E")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("file_export_html", i18n.t("menu.file_export_html"))
            .build(app)?)
        .item(&MenuItemBuilder::with_id("file_print", i18n.t("menu.file_print"))
            .accelerator("CmdOrCtrl+P")
            .build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("file_quit", i18n.t("menu.file_quit"))
            .accelerator("CmdOrCtrl+Q")
            .build(app)?)
        .build()?;

    // --- Edit menu ---
    #[allow(unused_mut)]
    let mut edit_builder = SubmenuBuilder::new(app, i18n.t("menu.edit"));

    // macOS: add standard editing items so webview text operations work
    #[cfg(target_os = "macos")]
    {
        edit_builder = edit_builder
            .item(&PredefinedMenuItem::undo(app, None)?)
            .item(&PredefinedMenuItem::redo(app, None)?)
            .separator()
            .item(&PredefinedMenuItem::cut(app, None)?)
            .item(&PredefinedMenuItem::copy(app, None)?)
            .item(&PredefinedMenuItem::paste(app, None)?)
            .item(&PredefinedMenuItem::select_all(app, None)?)
            .separator();
    }

    let edit_menu = edit_builder
        .item(&MenuItemBuilder::with_id("edit_copy_markdown", i18n.t("menu.edit_copy_markdown"))
            .accelerator("CmdOrCtrl+Shift+C")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("edit_copy_html", i18n.t("menu.edit_copy_html"))
            .build(app)?)
        .item(&MenuItemBuilder::with_id("edit_copy_plaintext", i18n.t("menu.edit_copy_plaintext"))
            .build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("edit_find", i18n.t("menu.edit_find"))
            .accelerator("CmdOrCtrl+F")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("edit_find_replace", i18n.t("menu.edit_find_replace"))
            .accelerator("CmdOrCtrl+H")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("edit_find_next", i18n.t("menu.edit_find_next"))
            .accelerator("CmdOrCtrl+G")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("edit_find_prev", i18n.t("menu.edit_find_prev"))
            .accelerator("CmdOrCtrl+Shift+G")
            .build(app)?)
        .build()?;

    // --- Tag menu ---
    let tag_menu = SubmenuBuilder::new(app, i18n.t("menu.tag"))
        .item(&MenuItemBuilder::with_id("tag_add", i18n.t("menu.tag_add"))
            .accelerator("CmdOrCtrl+T")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("tag_edit", i18n.t("menu.tag_edit"))
            .build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("tag_manage", i18n.t("menu.tag_manage"))
            .build(app)?)
        .build()?;

    // --- View menu ---
    let theme_submenu = SubmenuBuilder::new(app, i18n.t("menu.view_theme"))
        .item(&CheckMenuItemBuilder::with_id("theme_dark", i18n.t("menu.view_theme_dark"))
            .build(app)?)
        .item(&CheckMenuItemBuilder::with_id("theme_light", i18n.t("menu.view_theme_light"))
            .build(app)?)
        .item(&CheckMenuItemBuilder::with_id("theme_auto", i18n.t("menu.view_theme_auto"))
            .checked(true)
            .build(app)?)
        .build()?;

    let font_submenu = SubmenuBuilder::new(app, i18n.t("menu.view_font_size"))
        .item(&MenuItemBuilder::with_id("font_increase", i18n.t("menu.view_font_size_increase"))
            .accelerator("CmdOrCtrl+=")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("font_decrease", i18n.t("menu.view_font_size_decrease"))
            .accelerator("CmdOrCtrl+-")
            .build(app)?)
        .build()?;

    let lang_submenu = SubmenuBuilder::new(app, i18n.t("menu.view_language"))
        .item(&CheckMenuItemBuilder::with_id("locale_en", i18n.t("menu.view_language_en"))
            .checked(matches!(i18n.locale(), Locale::En))
            .build(app)?)
        .item(&CheckMenuItemBuilder::with_id("locale_ja", i18n.t("menu.view_language_ja"))
            .checked(matches!(i18n.locale(), Locale::Ja))
            .build(app)?)
        .item(&CheckMenuItemBuilder::with_id("locale_custom", i18n.t("menu.view_language_custom"))
            .checked(matches!(i18n.locale(), Locale::Custom))
            .build(app)?)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, i18n.t("menu.view"))
        .item(&theme_submenu)
        .item(&font_submenu)
        .item(&lang_submenu)
        .separator()
        .item(&CheckMenuItemBuilder::with_id("view_status_bar", i18n.t("menu.view_status_bar"))
            .checked(true)
            .build(app)?)
        .item(&CheckMenuItemBuilder::with_id("view_always_on_top", i18n.t("menu.view_always_on_top"))
            .build(app)?)
        .build()?;

    // --- Help menu ---
    let help_menu = SubmenuBuilder::new(app, i18n.t("menu.help"))
        .item(&MenuItemBuilder::with_id("help_check_updates", i18n.t("menu.help_check_updates"))
            .build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("help_about", i18n.t("menu.help_about"))
            .build(app)?)
        .build()?;

    // macOS: add app menu with standard items
    #[cfg(target_os = "macos")]
    {
        let app_menu = SubmenuBuilder::new(app, "tsumugi")
            .item(&MenuItemBuilder::with_id("app_about", i18n.t("menu.help_about"))
                .build(app)?)
            .separator()
            .item(&PredefinedMenuItem::hide(app, None)?)
            .item(&PredefinedMenuItem::hide_others(app, None)?)
            .item(&PredefinedMenuItem::show_all(app, None)?)
            .separator()
            .item(&PredefinedMenuItem::quit(app, None)?)
            .build()?;

        return MenuBuilder::new(app)
            .item(&app_menu)
            .item(&file_menu)
            .item(&edit_menu)
            .item(&tag_menu)
            .item(&view_menu)
            .item(&help_menu)
            .build();
    }

    #[cfg(not(target_os = "macos"))]
    {
        MenuBuilder::new(app)
            .item(&file_menu)
            .item(&edit_menu)
            .item(&tag_menu)
            .item(&view_menu)
            .item(&help_menu)
            .build()
    }
}

/// Execute a menu action by ID. Shared by native menu events and the frontend command.
pub fn execute_action(app: &AppHandle, id: &str) {
    match id {
        // Window operations — handle directly in Rust
        "file_quit" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.close();
            }
        }
        "view_always_on_top" => {
            if let Some(window) = app.get_webview_window("main") {
                let current = window.is_always_on_top().unwrap_or(false);
                let new_state = !current;
                let _ = window.set_always_on_top(new_state);
                if let Some(item) = app.menu().and_then(|m| m.get("view_always_on_top")) {
                    if let Some(check) = item.as_check_menuitem() {
                        let _ = check.set_checked(new_state);
                    }
                }
                let _ = app.emit("menu-action", serde_json::json!({ "action": "always_on_top_changed", "value": new_state }));
            }
        }

        "view_status_bar" => {
            if let Some(item) = app.menu().and_then(|m| m.get("view_status_bar")) {
                if let Some(check) = item.as_check_menuitem() {
                    let new_state = check.is_checked().unwrap_or(false);
                    let _ = check.set_checked(new_state);
                }
            }
            let _ = app.emit("menu-action", serde_json::json!({ "action": "view_status_bar" }));
        }

        "tag_manage" => {
            open_tag_manager(app);
        }

        "help_check_updates" => {
            let _ = app.emit("menu-action", serde_json::json!({ "action": "help_check_updates" }));
        }

        "help_about" | "app_about" => {
            open_about_window();
        }

        // Theme — update check marks and emit to frontend
        "theme_dark" | "theme_light" | "theme_auto" => {
            update_theme_checks(app, id);
            let theme = id.strip_prefix("theme_").unwrap_or("auto");
            let _ = app.emit("menu-action", serde_json::json!({ "action": "theme_change", "value": theme }));
        }

        // Language — save setting, rebuild menu, update state
        "locale_en" | "locale_ja" | "locale_custom" => {
            let locale = match id {
                "locale_en" => Locale::En,
                "locale_ja" => Locale::Ja,
                _ => Locale::Custom,
            };
            save_locale_setting(&locale);

            // Save current menu check states before rebuild
            let current_theme = ["theme_dark", "theme_light", "theme_auto"]
                .iter()
                .find(|tid| get_check_state(app, tid))
                .unwrap_or(&"theme_auto")
                .to_string();
            let status_bar = get_check_state(app, "view_status_bar");
            let always_on_top = get_check_state(app, "view_always_on_top");

            // Rebuild menu with new locale
            let new_i18n = I18n::with_locale(locale);
            if let Ok(menu) = build_menu(app, &new_i18n) {
                let _ = app.set_menu(menu);
            }

            // Restore check states
            update_theme_checks(app, &current_theme);
            set_check_state(app, "view_status_bar", status_bar);
            set_check_state(app, "view_always_on_top", always_on_top);

            // Update I18n state
            let i18n_state = app.state::<I18nState>();
            {
                let mut guard = i18n_state.lock().unwrap();
                *guard = new_i18n;
            }
        }

        // All other actions — emit to frontend
        _ => {
            let _ = app.emit("menu-action", serde_json::json!({ "action": id }));
        }
    }
}

pub fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    execute_action(app, event.id().as_ref());
}

fn open_about_window() {
    let version = env!("CARGO_PKG_VERSION");
    let body = format!(
        "# tsumugi\n\n\
         **Version {version}**\n\n\
         Markdown viewer for the AI age.\n\n\
         ---\n\n\
         - GitHub: https://github.com/HonotaKobo/tsumugi\n\
         - License: MIT\n"
    );
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::process::Command::new(exe)
            .args(["--body", &body, "--title", "About tsumugi"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::inherit())
            .spawn();
    }
}

fn open_tag_manager(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("tag-manager") {
        let _ = window.set_focus();
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        #[allow(unused_variables)]
        if let Ok(window) = tauri::WebviewWindowBuilder::new(
            &app,
            "tag-manager",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("タグ管理 — tsumugi")
        .inner_size(700.0, 500.0)
        .min_inner_size(400.0, 300.0)
        .build()
        {
            #[cfg(not(target_os = "macos"))]
            let _ = window.remove_menu();
        }
    });
}

fn update_theme_checks(app: &AppHandle, selected_id: &str) {
    for id in &["theme_dark", "theme_light", "theme_auto"] {
        if let Some(item) = app.menu().and_then(|m| m.get(*id)) {
            if let Some(check) = item.as_check_menuitem() {
                let _ = check.set_checked(*id == selected_id);
            }
        }
    }
}

fn get_check_state(app: &AppHandle, id: &str) -> bool {
    if let Some(item) = app.menu().and_then(|m| m.get(id)) {
        if let Some(check) = item.as_check_menuitem() {
            return check.is_checked().unwrap_or(false);
        }
    }
    false
}

fn set_check_state(app: &AppHandle, id: &str, checked: bool) {
    if let Some(item) = app.menu().and_then(|m| m.get(id)) {
        if let Some(check) = item.as_check_menuitem() {
            let _ = check.set_checked(checked);
        }
    }
}
