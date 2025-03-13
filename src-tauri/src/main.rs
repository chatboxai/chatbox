// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use serde_json::json;
use tauri::Wry;
use tauri::{command, Manager};
use tauri_plugin_store::StoreExt;
use uuid::Uuid;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
