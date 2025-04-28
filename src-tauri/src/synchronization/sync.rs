use crate::synchronization::dropbox::Dropbox;
use crate::synchronization::sync_lock::SyncLocking;
use crate::synchronization::sync_plan::SyncPlan;
use crate::types::settings::{Settings, CHAT_SESSIONS_KEY};
use crate::types::sync::{SyncPayload, SyncStatus};
use anyhow::Result;
use log::{log, log_enabled, Level};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fmt::format;
use std::fs::File;
use std::io::Write;
use std::ops::Index;
use std::ptr::hash;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Wry};
use tauri_plugin_store::Store;
use tokio::sync::Mutex;

pub const SYNC_METADATA_KEY: &str = "sync_metadata";

pub struct Synchronize {
    dropbox: Arc<Dropbox>,
    store: Arc<Store<Wry>>,
    locking: Arc<Mutex<()>>,
    app: tauri::AppHandle,
}

impl Synchronize {
    pub fn new(dropbox: Arc<Dropbox>, store: Arc<Store<Wry>>, app: tauri::AppHandle) -> Self {
        Synchronize {
            dropbox,
            store,
            locking: Arc::new(Mutex::new(())),
            app,
        }
    }

    fn load_settings(&self) -> Result<Settings, String> {
        let val = self
            .store
            .get("settings")
            .ok_or("No settings found".to_string());
        let setting: Settings = serde_json::from_value(val?).map_err(|e| e.to_string())?;
        Ok(setting)
    }

    async fn get_auth_token(&self, settings: &Settings) -> Result<String, String> {
        let refresh_token = settings
            .sync_config
            .providers_config
            .as_ref()
            .and_then(|pc| pc.dropbox.refresh_token.clone());

        let refresh_token = refresh_token.ok_or_else(|| "No refresh token found".to_string())?;

        self.dropbox
            .get_auth_token_from_refresh(refresh_token.as_str())
            .await
    }

    async fn validate_authentication(&self, auth_token: &str) -> Result<(), String> {
        self.dropbox
            .check(auth_token)
            .await
            .map_err(|e| format!("Authentication failed: {}", e))
    }

    async fn load_remote_metadata(&self, auth_token: &str) -> Result<SyncMetadata, String> {
        let path = format!("{}/sync_metadata.json", self.dropbox.root_path());

        match self.dropbox.download(auth_token, &path).await {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|e| format!("Invalid remote metadata: {}", e)),
            Err(_) => Ok(SyncMetadata::default()),
        }
    }

    async fn handle_first_sync(
        &self,
        auth_token: &str,
        local_metadata: &SyncMetadata,
    ) -> Result<(), String> {
        let root_path = self.dropbox.root_path();

        // Upload all chat sessions
        for (_, session) in &local_metadata.chat_session {
            let path = format!("{}/chat_sessions/{}.json", root_path, session.id);
            let content = session
                .content
                .as_ref()
                .ok_or("Missing session content")?
                .as_bytes()
                .to_vec();

            self.dropbox
                .upload(auth_token, &path, content)
                .await
                .map_err(|e| format!("Failed to upload session: {}", e))?;
        }

        // Upload metadata
        let metadata_path = format!("{}/sync_metadata.json", root_path);
        let metadata_bytes = serde_json::to_vec(local_metadata)
            .map_err(|e| format!("Metadata serialization failed: {}", e))?;

        self.dropbox
            .upload(auth_token, &metadata_path, metadata_bytes)
            .await
            .map_err(|e| format!("Uploading metadata failed: {}", e))?;
        Ok(())
    }

    async fn upload_local_changes(&self, auth_token: &str, plan: &SyncPlan) -> Result<(), String> {
        let local_metadata = self.create_sync_metadata();
        let root_path = self.dropbox.root_path();

        for session_id in &plan.to_upload {
            let local_session = local_metadata
                .chat_session
                .get(session_id)
                .ok_or("Missing local session")?;

            let path = format!("{}/chat_sessions/{}.json", root_path, session_id);
            let content = local_session
                .content
                .as_ref()
                .ok_or("Missing session content")?
                .as_bytes()
                .to_vec();

            self.dropbox
                .upload(auth_token, &path, content)
                .await
                .map_err(|e| format!("Uploading session failed: {}", e))?;
        }

        Ok(())
    }

    async fn update_remote_metadata(&self, auth_token: &str) -> Result<(), String> {
        //  rebuild local metadata from the latest data.
        let local_metadata = self.create_sync_metadata();
        let metadata_path = format!("{}/sync_metadata.json", self.dropbox.root_path());
        let metadata_bytes = serde_json::to_vec(&local_metadata)
            .map_err(|e| format!("Metadata serialization failed: {}", e))?;

        self.dropbox
            .upload(auth_token, &metadata_path, metadata_bytes)
            .await
            .map_err(|e| format!("Uploading metadata failed: {}", e))?;
        Ok(())
    }

    async fn apply_remote_changes(
        &self,
        auth_token: &str,
        remote_metadata: &SyncMetadata,
        plan: &SyncPlan,
    ) -> Result<(), String> {
        for session_id in &plan.to_download {
            // let remote_session = remote_metadata
            //     .chat_session
            //     .iter()
            //     .find(|s| &s.id == session_id)
            //     .ok_or("Missing remote session")?;

            self.insert_chat_session(auth_token.to_string(), session_id.clone())
                .await
                .map_err(|e| format!("Failed to apply remote change: {}", e))?;
        }

        Ok(())
    }

    pub async fn do_sync(&self) -> Result<(), String> {
        // locking can't be separated from the main logic,
        // otherwise the finish event will be called immediately.
        let _sync_locking = SyncLocking::new(
            self.store.clone(),
            self.app.clone(),
            Arc::from(Mutex::new(())),
        )
        .await
        .map_err(|e| e.to_string());

        let settings = self.load_settings()?;
        let auth_token = self.get_auth_token(&settings).await?;

        self.validate_authentication(&auth_token).await?;

        let local_metadata = self.create_sync_metadata();
        let remote_metadata = self.load_remote_metadata(&auth_token).await?;

        if remote_metadata.hash == "" {
            return self.handle_first_sync(&auth_token, &local_metadata).await;
        }

        // TODO: if there's no changes in the remote, filter new changes in local then upload it.
        // for now update all local data.
        if local_metadata.hash == remote_metadata.hash {
            return Ok(());
        }

        let sync_plan = SyncPlan::new();

        let sync_plan = sync_plan.create_sync_plan(&local_metadata, &remote_metadata);
        self.apply_remote_changes(&auth_token, &remote_metadata, &sync_plan)
            .await?;
        self.upload_local_changes(&auth_token, &sync_plan).await?;
        self.update_remote_metadata(&auth_token).await?;

        if sync_plan.to_download.len() > 0 {
            self.notify_fe(SyncStatus::RequireReload, None);
        }
        Ok(())
    }

    pub fn notify_fe(&self, status: SyncStatus, error_message: Option<String>) {
        self.app
            .emit(
                "sync_event",
                SyncPayload {
                    status,
                    error_message,
                },
            )
            .unwrap();
    }

    async fn insert_chat_session(&self, auth_token: String, id: String) -> Result<(), String> {
        let file_path = format!(
            "{}/{}/{}.json",
            self.dropbox.root_path(),
            "chat_sessions",
            id
        );

        // Download session data
        let new_session_data = self
            .dropbox
            .download(auth_token.as_str(), &file_path)
            .await
            .map_err(|e| format!("Download failed: {}", e))?;

        // Deserialize session metadata
        let session: ChatSessionMetadata = serde_json::from_slice(&new_session_data)
            .map_err(|e| format!("Deserialization failed: {}", e))?;

        // Get existing chat sessions, handling both string and object formats
        let mut chats: Vec<String> = self
            .store
            .get(CHAT_SESSIONS_KEY)
            .map(|v| {
                // First try to parse as Vec<String>
                serde_json::from_value::<Vec<String>>(v.clone())
                    .or_else(|_| {
                        // Fallback: parse as Vec<Value> and convert each to JSON string
                        serde_json::from_value::<Vec<serde_json::Value>>(v).map(|values| {
                            values
                                .into_iter()
                                .map(|val| val.to_string()) // Serialize Value to JSON string
                                .collect::<Vec<String>>()
                        })
                    })
                    .map_err(|e| format!("Failed to parse chat sessions: {}", e))
            })
            .unwrap()
            .map_err(|e| format!("Failed to parse chats: {}", e))?;

        // Get content and ensure it's a JSON string
        let session_content = session.content.ok_or("Session content is missing")?;

        // Validate content is valid JSON
        let session_value: serde_json::Value = serde_json::from_str(&session_content)
            .map_err(|e| format!("Invalid JSON content: {}", e))?;

        // Check for duplicates by comparing IDs
        let mut found_duplicate = false;
        let mut updated_chats: Vec<String> = Vec::new();

        for chat in chats {
            if let Ok(chat_value) = serde_json::from_str::<serde_json::Value>(&chat) {
                if let Some(chat_id) = chat_value.get("id").and_then(|v| v.as_str()) {
                    if chat_id == session.id {
                        // Replace the existing chat with the new one
                        updated_chats.push(session_content.clone());
                        found_duplicate = true;
                    } else {
                        updated_chats.push(chat);
                    }
                }
            }
        }

        // If no duplicate was found, append the new chat
        if !found_duplicate {
            updated_chats.push(session_content);
        }

        let new_val = format!("[{}]", updated_chats.join(","));
        let new_chat_session: Vec<Value> = serde_json::from_slice(new_val.as_bytes())
            .map_err(|e| format!("failed to parse chat session: {}", e))?;

        // Save updated list
        self.store.set(CHAT_SESSIONS_KEY, new_chat_session);

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
            last_sync: 0,
            chat_session: self.create_chat_session_metadata(),
        };

        let mut hasher = Sha256::new();
        hasher.update(
            serde_json::to_string_pretty(&sync_metadata)
                .unwrap()
                .as_bytes(),
        );
        let result = hasher.finalize();
        sync_metadata.hash = hex::encode(result);
        sync_metadata.last_sync = since_the_epoch;

        sync_metadata
    }

    fn create_chat_session_metadata(&self) -> HashMap<String, ChatSessionMetadata> {
        // Get chats from store or default to empty array
        let chats_value = self.store.get(CHAT_SESSIONS_KEY);
        log!(
            Level::Info,
            "chat session: {}",
            chats_value.clone().unwrap()
        );
        let chats_value = chats_value.unwrap_or_else(|| Value::Array(vec![]));
        let mut chats_sessions: Vec<ChatSessionMetadata> =
            serde_json::from_value(chats_value.clone()).unwrap_or_else(|e| {
                eprintln!("Deserialization failed: {}", e);
                Vec::new() // Fallback
            });

        let mut chat_session_hash: HashMap<String, ChatSessionMetadata> = HashMap::new();
        for (index, chat) in chats_sessions.iter_mut().enumerate() {
            let mut hasher = Sha256::new();
            hasher.update(chat.content.clone().unwrap().as_bytes());

            let result = hasher.finalize();
            chat.hash = Option::from(hex::encode(result));
            chat_session_hash.insert(chat.id.clone(), chat.clone());
        }
        chat_session_hash
    }

    pub fn sync_interval(&self) -> Duration {
        match self.load_settings() {
            Ok(value) => Duration::from_secs(value.sync_config.frequency),
            Err(e) => Duration::new(0, 0),
        }
    }
}
#[derive(Debug, Clone, Serialize)]
pub struct ChatSessionMetadata {
    pub(crate) hash: Option<String>,
    pub(crate) id: String,
    #[serde(rename = "updateTime")]
    pub(crate) update_time: Option<u128>,

    #[serde(skip_serializing)]
    content: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncMetadata {
    hash: String,
    last_sync: u128,
    pub(crate) chat_session: HashMap<String, ChatSessionMetadata>,
}

impl SyncMetadata {
    fn default() -> SyncMetadata {
        SyncMetadata {
            hash: "".to_string(),
            last_sync: 0,
            chat_session: HashMap::new(),
        }
    }
}

impl<'de> Deserialize<'de> for ChatSessionMetadata {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw_value = Value::deserialize(deserializer)?;

        log!(
            Level::Info,
            "{}",
            serde_json::to_string_pretty(&raw_value).unwrap()
        );
        // Extract known fields
        let id = raw_value
            .get("id")
            .and_then(Value::as_str)
            .map(String::from)
            .ok_or_else(|| serde::de::Error::custom("Missing required field: id"))?;

        let hash = raw_value
            .get("hash")
            .and_then(Value::as_str)
            .map(String::from)
            .unwrap_or_else(String::new);

        let update_time = raw_value
            .get("updateTime")
            .and_then(Value::as_u64)
            .map(|t| t as u128);

        // Remove known fields to get remaining content
        let mut content_value = raw_value.clone();
        if let Value::Object(ref mut map) = content_value {
            map.remove("id");
            map.remove("updateTime");
            map.remove("hash");
        }

        // Store original JSON in content field
        let content = serde_json::to_string(&raw_value)
            .map_err(|e| serde::de::Error::custom(e.to_string()))?;

        Ok(Self {
            id,
            update_time,
            hash: Some(hash),
            content: Some(content),
        })
    }
}
