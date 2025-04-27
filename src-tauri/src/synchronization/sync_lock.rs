use crate::types::sync::{SyncPayload, SyncStatus};
use std::sync::Arc;
use tauri::{Emitter, Wry};
use tauri_plugin_store::Store;
use tokio::sync::Mutex;
pub struct SyncLocking {
    store: Arc<Store<Wry>>,
    app: tauri::AppHandle,
    _guard: tokio::sync::MutexGuard<'static, ()>, // This line is problematic; see explanation below
    _mutex: Arc<Mutex<()>>,
}

impl SyncLocking {
    pub async fn new(
        store: Arc<Store<Wry>>,
        app: tauri::AppHandle,
        mutex: Arc<Mutex<()>>,
    ) -> Result<Self, String> {
        // Clone the Arc before locking to move into the struct
        let mutex_clone = mutex.clone();
        let guard = mutex.lock().await;
        // Transmute the guard's lifetime to 'static (unsafe, but necessary here)
        // WARNING: This is unsafe and only valid if the Arc<Mutex> is kept alive!
        let guard_static: tokio::sync::MutexGuard<'static, ()> =
            unsafe { std::mem::transmute(guard) };

        app.emit(
            "sync_event",
            SyncPayload {
                status: SyncStatus::InProgress,
                error_message: None,
            },
        )
        .unwrap();

        Ok(Self {
            _mutex: mutex_clone,
            store,
            app,
            _guard: guard_static,
        })
    }
}

impl Drop for SyncLocking {
    fn drop(&mut self) {
        self.app
            .emit(
                "sync_event",
                SyncPayload {
                    status: SyncStatus::Finished,
                    error_message: None,
                },
            )
            .unwrap();
    }
}
