// Settings stores the setting information of the application
// it only stores the data needed in Rust, the most complete are in typescript.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub show_word_count: Option<bool>,
    pub show_token_count: Option<bool>,
    pub show_token_used: Option<bool>,
    pub show_model_name: Option<bool>,
    pub show_message_timestamp: Option<bool>,

    #[serde(rename = "languageInited")]
    pub language_inited: Option<bool>,
    pub font_size: Option<u32>,

    #[serde(rename = "spellCheck")]
    pub spell_check: Option<bool>,

    #[serde(rename = "defaultPrompt")]
    pub default_prompt: Option<String>,

    pub proxy: Option<String>,

    #[serde(rename = "allowReportingAndTracking")]
    pub allow_reporting_and_tracking: bool,

    #[serde(rename = "userAvatarKey")]
    pub user_avatar_key: Option<String>,

    #[serde(rename = "enableMarkdownRendering")]
    pub enable_markdown_rendering: bool,

    #[serde(rename = "autoGenerateTitle")]
    pub auto_generate_title: bool,

    #[serde(rename = "syncConfig")]
    pub sync_config: SynchronizedConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncDataType {
    All,
    Chat,
    Config,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncProvider {
    #[serde(rename = "None")]
    None,
    #[serde(rename = "Dropbox")]
    Dropbox,
    #[serde(rename = "GoogleDrive")]
    GoogleDrive,
    #[serde(rename = "OneDrive")]
    OneDrive,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynchronizedConfig {
    pub provider: SyncProvider,
    pub providers_config: Option<ProvidersConfig>,
    pub frequency: u64, // in seconds
    pub on_app_launch: bool,
    pub sync_data_type: Vec<SyncDataType>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvidersConfig {
    #[serde(rename = "Dropbox")]
    pub dropbox: DropboxConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DropboxConfig {
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub auth_token: Option<String>,
    pub refresh_token: Option<String>,
}

pub const CHAT_SESSIONS_KEY: &str = "chat-sessions";

// STORE_FILES_KEY must be the as FE
pub const STORE_FILES_KEY: &str = "settings.json";
