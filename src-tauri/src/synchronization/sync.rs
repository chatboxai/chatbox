use crate::settings::setting::Settings;
use crate::synchronization::dropbox::Dropbox;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::ptr::hash;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Wry;
use tauri_plugin_store::Store;

pub struct Synchronize {
    dropbox: Arc<Dropbox>,
    store: Arc<Store<Wry>>,
}

impl Synchronize {
    pub fn new(dropbox: Arc<Dropbox>, store: Arc<Store<Wry>>) -> Self {
        Synchronize { dropbox, store }
    }

    pub async fn do_sync(&self) {
        let setting = self.store.get("settings").expect("No configs found");

        let settings: Settings = serde_json::from_value(setting).expect("Invalid configs found");

        println!(
            "dropbox configuration: {:?}",
            settings.sync_config.providers_config
        );
        // 1. update sync to in progress
        // TODO
        // 1.1. validate authenticate
        self.dropbox.check().await.expect("Error checking configs");
        // 2. fetch local metadata
        // if not exist create sync metadata
        self.create_sync_metadata();
        // 3. fetch remote metadata
        // 4. compare hash
    }

    fn create_sync_metadata(&self) -> SyncMetadata {
        let start = SystemTime::now();
        let since_the_epoch = start
            .duration_since(UNIX_EPOCH)
            .unwrap_or_else(|_| Duration::new(0, 0))
            .as_millis();

        let mut sync_metadata = SyncMetadata {
            hash: "".to_string(),
            last_sync: since_the_epoch,
            chat_session: self.create_chat_session_metadata(),
        };

        println!("sync metadata: {:?}", sync_metadata);

        sync_metadata
    }

    fn create_chat_session_metadata(&self) -> Vec<ChatSessionMetadata> {
        // Get chats from store or default to empty array
        let chats_value = self
            .store
            .get("chat_session")
            .unwrap_or_else(|| Value::Array(vec![]));

        // Parse into vector of ChatSessionMetadata, default to empty vec on error
        let mut chats: Vec<ChatSessionMetadata> =
            serde_json::from_value(chats_value).unwrap_or_default();

        // Process each chat session
        for chat in chats.iter_mut() {
            let json_str = match serde_json::to_string(chat) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("Failed to serialize chat metadata: {}", e);
                    continue;
                }
            };

            let mut hasher = Sha256::new();
            hasher.update(json_str);
            let result = hasher.finalize();

            chat.hash = Option::from(hex::encode(result));
        }

        chats
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChatSessionMetadata {
    hash: Option<String>,
    id: String,
    update_time: u128,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SyncMetadata {
    hash: String,
    last_sync: u128,
    chat_session: Vec<ChatSessionMetadata>,
}
