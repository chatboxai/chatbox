pub mod synchronization;
mod types;

use crate::synchronization::dropbox::Dropbox;
use crate::synchronization::sync::Synchronize;
use crate::types::settings;
use crate::types::sync::SyncStatus;
use log::{log, log_enabled, Level};
use std::env;
use std::sync::Arc;
use std::thread;
use std::time::Duration;
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
) -> Result<(String, String), String> {
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
    log_enabled!(Level::Info);
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dropbox_client_id: &'static str = env!("DROPBOX_CLIENT_ID");
            let dropbox_client_secret: &'static str = env!("DROPBOX_CLIENT_SECRET");

            // Create single instance
            let dropbox = Arc::new(Dropbox::new(
                dropbox_client_id.to_string(),
                dropbox_client_secret.to_string(),
            ));

            let store = app.store(settings::STORE_FILES_KEY)?;

            let synchronize = Arc::new(Synchronize::new(
                dropbox.clone(),
                store.clone(),
                app.handle().clone(),
            ));

            // for now use clone, instead of reference.
            // I still don't understand how does the lifetime works.
            sync_scheduler(synchronize.clone());

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

fn sync_scheduler(synchronize: Arc<Synchronize>) {
    thread::spawn(move || loop {
        let dur = synchronize.sync_interval();

        // stop the sync process.
        if dur == Duration::ZERO {
            break;
        }
        thread::sleep(dur);
        let sync_clone = synchronize.clone();
        tauri::async_runtime::spawn(async move {
            match sync_clone.do_sync().await {
                Ok(_) => {}
                Err(e) => sync_clone.notify_fe(SyncStatus::Error, Some(e.to_string())),
            }
        });
    });
}
