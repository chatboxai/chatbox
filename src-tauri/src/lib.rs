mod settings;
pub mod synchronization;
mod types;

use crate::synchronization::dropbox::Dropbox;
use crate::synchronization::sync::Synchronize;
use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_store::StoreExt;

#[tauri::command]
fn is_mobile_platform() -> bool {
    let platform = tauri_plugin_os::platform();
    platform == "ios" || platform == "android"
}

#[tauri::command]
async fn relaunch_app(app: tauri::AppHandle) -> () {
    app.restart();
}

#[tauri::command]
fn sync_dropbox_login_url(dropbox: tauri::State<Arc<Dropbox>>) -> String {
    dropbox.get_login_url()
}

#[tauri::command]
async fn sync_dropbox_get_auth_token(
    auth_code: &str,
    dropbox: tauri::State<'_, Arc<Dropbox>>,
) -> Result<String, String> {
    dropbox
        .get_auth_token(auth_code)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn sync_execute(synchronize: tauri::State<'_, Arc<Synchronize>>) -> Result<(), String> {
    synchronize.do_sync().await?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Create single instance
            let dropbox = Arc::new(Dropbox::new(
                "cx9li9ur8taq1z7".into(),
                "i8f9a1mvx3bijrt".into(),
            ));

            let store = app.store("settings.json")?;

            let synchronize = Arc::new(Synchronize::new(dropbox.clone(), store.clone()));

            // Share it across commands
            app.manage(dropbox);
            app.manage(store);
            app.manage(synchronize);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            is_mobile_platform,
            relaunch_app,
            sync_dropbox_login_url,
            sync_dropbox_get_auth_token,
            sync_execute,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
