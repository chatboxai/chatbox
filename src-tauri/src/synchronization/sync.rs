use crate::settings::setting::Settings;
use crate::synchronization::dropbox::Dropbox;
use crate::types::settings::CHAT_SESSIONS_KEY;
use anyhow::Result;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fmt::format;
use std::ops::Index;
use std::ptr::hash;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Wry;
use tauri_plugin_store::Store;

pub const SYNC_METADATA_KEY: &str = "sync_metadata";

pub struct Synchronize {
    dropbox: Arc<Dropbox>,
    store: Arc<Store<Wry>>,
    locking: Mutex<String>,
}

impl Synchronize {
    pub fn new(dropbox: Arc<Dropbox>, store: Arc<Store<Wry>>) -> Self {
        Synchronize {
            dropbox,
            store,
            locking: Mutex::new(String::default()),
        }
    }

    pub async fn do_sync(&self) -> Result<(), String> {
        {
            let _unused = self
                .locking
                .lock()
                .map_err(|e| format!("other sync process still happening{e}"));
        }

        let setting = self.store.get("settings").ok_or("failed to get settings")?;

        let settings: Settings = serde_json::from_value(setting).map_err(|e| format!("{}", e))?;

        let provider_config = settings
            .sync_config
            .providers_config
            .ok_or("failed to get sync providers config")?;

        let dropbox_config = provider_config.dropbox;

        let auth_token = dropbox_config
            .auth_token
            .ok_or("failed to get auth token")?;
        // 1. update sync to in progress

        // TODO
        // 1.1. validate authenticate
        self.dropbox
            .check(auth_token.as_str())
            .await
            .map_err(|e| format!("failed to validate token with error: {}", e))?;
        // 2. fetch local metadata
        let local_sync_metadata = self.create_sync_metadata();
        println!("sync metadata: {:?}", local_sync_metadata);
        // 3. fetch remote metadata

        let default_remote_sync_metadata = SyncMetadata {
            hash: "new".to_string(),
            last_sync: 0,
            chat_session: vec![],
        };

        let sync_metadata_file_name =
            format!("{}/sync_metadata.json", self.dropbox.root_path()).as_str();
        // if metadata not found remotely it means first sync
        let remote_sync_metadata: SyncMetadata = match self
            .dropbox
            .download(auth_token.as_str(), sync_metadata_file_name)
            .await
        {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|e| format!("Failed to parse remote metadata: {}", e))
                .unwrap_or_else(|_| {
                    eprintln!("Using default metadata due to parse error");
                    default_remote_sync_metadata
                }),
            Err(e) => {
                eprintln!("Failed to download metadata: {}. Using default", e);
                default_remote_sync_metadata
            }
        };

        // completely new, upload metadata and chat.
        if remote_sync_metadata.hash == "new" {
            for chat_session in local_sync_metadata.chat_session.iter() {
                let file_name = format!(
                    "{}/chat_sessions/{}.json",
                    self.dropbox.root_path(),
                    chat_session.id
                );
                let content = chat_session.content.clone();
                println!("file_name: {}, hash: {:?}", file_name, chat_session.hash);
                self.dropbox
                    .upload(
                        auth_token.as_str(),
                        &*file_name,
                        content.unwrap().as_bytes().to_vec(),
                    )
                    .await
                    .map_err(|e| format!("{}", e))?;
            }
            self.dropbox
                .upload(
                    auth_token.as_str(),
                    sync_metadata_file_name,
                    content.unwrap().as_bytes().to_vec(),
                )
                .await
                .map_err(|e| format!("{}", e))?
        }

        // 4. compare hash
        // 5. if the hash still the same it means there's no changes from other device
        if local_sync_metadata.hash == remote_sync_metadata.hash {
            return Ok(());
        }
        //    5.1 compare hash local vs remote for each session
        //      5.1.1 if hash the same, ignore it no changes
        //      5.1.2 if the hash different, means there's changes between local and remote

        // complete this function
        // compare each local_sync_metadata.chat_session.hash to local_sync_metadata.chat_session.hash
        // by searching by its chat_session.id
        // if any of data not exist in the which data doesn't exist in new variable for each local and remote

        //          5.1.2.1 upload the local changes to remote
        //          5.1.2.2 update hash to the metadata
        // 6. if the hash different, there's other device modify the remote changes
        //    6.1 compare hash for each session
        //
        Ok(())
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

        let mut hasher = Sha256::new();
        hasher.update(sync_metadata.hash.as_bytes());
        let result = hasher.finalize();
        sync_metadata.hash = hex::encode(result);

        sync_metadata
    }

    fn create_chat_session_metadata(&self) -> Vec<ChatSessionMetadata> {
        // Get chats from store or default to empty array
        let chats_value = self.store.get(CHAT_SESSIONS_KEY);
        let chats_value = chats_value.unwrap_or_else(|| Value::Array(vec![]));
        let mut chats_sessions: Vec<ChatSessionMetadata> =
            serde_json::from_value(chats_value.clone()).unwrap_or_else(|e| {
                eprintln!("Deserialization failed: {}", e);
                Vec::new() // Fallback
            });

        for (index, chat) in chats_sessions.iter_mut().enumerate() {
            let mut hasher = Sha256::new();
            hasher.update(chat.content.clone().unwrap().as_bytes());

            let result = hasher.finalize();
            chat.hash = Option::from(hex::encode(result));
        }
        chats_sessions
    }
}
#[derive(Debug, Clone, Serialize)]
struct ChatSessionMetadata {
    hash: Option<String>,
    id: String,
    #[serde(rename = "updateTime")]
    update_time: Option<u128>,

    #[serde(skip_serializing)]
    content: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SyncMetadata {
    hash: String,
    last_sync: u128,
    chat_session: Vec<ChatSessionMetadata>,
}

impl<'de> Deserialize<'de> for ChatSessionMetadata {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw_value = Value::deserialize(deserializer)?;

        // Extract known fields
        let id = raw_value
            .get("id")
            .and_then(Value::as_str)
            .map(String::from)
            .ok_or_else(|| serde::de::Error::custom("Missing required field: id"))?;

        let update_time = raw_value
            .get("updateTime")
            .and_then(Value::as_u64)
            .map(|t| t as u128);

        // Remove known fields to get remaining content
        let mut content_value = raw_value.clone();
        if let Value::Object(ref mut map) = content_value {
            map.remove("id");
            map.remove("updateTime");
        }

        // Store original JSON in content field
        let content = serde_json::to_string(&raw_value)
            .map_err(|e| serde::de::Error::custom(e.to_string()))?;

        Ok(Self {
            id,
            update_time,
            hash: None,
            content: Some(content),
        })
    }
}
