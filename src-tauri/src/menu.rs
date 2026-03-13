use tauri::{
    menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Emitter, Manager, Wry,
};

use crate::i18n::I18n;

pub fn build_menu(app: &AppHandle, i18n: &I18n) -> tauri::Result<tauri::menu::Menu<Wry>> {
    // --- File menu ---
    let file_menu = SubmenuBuilder::new(app, i18n.t("menu.file"))
        .item(&MenuItemBuilder::with_id("file_open", i18n.t("menu.file_open"))
            .accelerator("CmdOrCtrl+O")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("file_save", i18n.t("menu.file_save"))
            .accelerator("CmdOrCtrl+S")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("file_save_as", i18n.t("menu.file_save_as"))
            .accelerator("CmdOrCtrl+Shift+S")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("file_rename", i18n.t("menu.file_rename"))
            .build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("file_print", i18n.t("menu.file_print"))
            .accelerator("CmdOrCtrl+P")
            .build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("file_quit", i18n.t("menu.file_quit"))
            .accelerator("CmdOrCtrl+Q")
            .build(app)?)
        .build()?;

    // --- Edit menu ---
    let edit_menu = SubmenuBuilder::new(app, i18n.t("menu.edit"))
        .item(&MenuItemBuilder::with_id("edit_copy_markdown", i18n.t("menu.edit_copy_markdown"))
            .accelerator("CmdOrCtrl+Shift+C")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("edit_copy_plaintext", i18n.t("menu.edit_copy_plaintext"))
            .build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("edit_select_all", i18n.t("menu.edit_select_all"))
            .accelerator("CmdOrCtrl+A")
            .build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("edit_find", i18n.t("menu.edit_find"))
            .accelerator("CmdOrCtrl+F")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("edit_find_next", i18n.t("menu.edit_find_next"))
            .accelerator("CmdOrCtrl+G")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("edit_find_prev", i18n.t("menu.edit_find_prev"))
            .accelerator("CmdOrCtrl+Shift+G")
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

    let view_menu = SubmenuBuilder::new(app, i18n.t("menu.view"))
        .item(&theme_submenu)
        .item(&font_submenu)
        .separator()
        .item(&MenuItemBuilder::with_id("view_minimize", i18n.t("menu.view_minimize"))
            .build(app)?)
        .item(&MenuItemBuilder::with_id("view_maximize", i18n.t("menu.view_maximize"))
            .build(app)?)
        .item(&CheckMenuItemBuilder::with_id("view_always_on_top", i18n.t("menu.view_always_on_top"))
            .build(app)?)
        .build()?;

    // macOS: add app menu with standard items
    #[cfg(target_os = "macos")]
    {
        let app_menu = SubmenuBuilder::new(app, "mdview")
            .item(&PredefinedMenuItem::about(app, Some("About mdview"), None)?)
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
            .item(&view_menu)
            .build();
    }

    #[cfg(not(target_os = "macos"))]
    {
        MenuBuilder::new(app)
            .item(&file_menu)
            .item(&edit_menu)
            .item(&view_menu)
            .build()
    }
}

pub fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();

    match id {
        // Window operations — handle directly in Rust
        "file_quit" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.close();
            }
        }
        "view_minimize" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.minimize();
            }
        }
        "view_maximize" => {
            if let Some(window) = app.get_webview_window("main") {
                if window.is_maximized().unwrap_or(false) {
                    let _ = window.unmaximize();
                } else {
                    let _ = window.maximize();
                }
            }
        }
        "view_always_on_top" => {
            if let Some(window) = app.get_webview_window("main") {
                let current = window.is_always_on_top().unwrap_or(false);
                let _ = window.set_always_on_top(!current);
            }
        }

        // Theme — update check marks and emit to frontend
        "theme_dark" | "theme_light" | "theme_auto" => {
            update_theme_checks(app, id);
            let theme = id.strip_prefix("theme_").unwrap_or("auto");
            let _ = app.emit("menu-action", serde_json::json!({ "action": "theme_change", "value": theme }));
        }

        // All other actions — emit to frontend
        _ => {
            let _ = app.emit("menu-action", serde_json::json!({ "action": id }));
        }
    }
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
