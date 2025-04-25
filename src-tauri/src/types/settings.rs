// Settings stores the setting information of the application
// it only stores the data needed in Rust, the most complete are in typescript.
use serde::Deserialize;

#[derive(Deserialize)]
struct Settings {
    #[serde(rename = "SyncConfig")]
    sync_config: SynchronizedConfig,
}

#[derive(Deserialize)]
struct SynchronizedConfig {
    provider: SyncProvider,
    #[serde(rename = "providerConfig")]
    provider_config: SyncProviderConfig,

    frequency: i64,

    #[serde(rename = "onAppLaunch")]
    on_app_launch: bool,

    #[serde(rename = "syncDataType")]
    sync_data_type: Vec<SyncDataType>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum SyncProvider {
    None,
    Dropbox,
    GoogleDrive,
    OneDrive,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum SyncDataType {
    All,
    Chat,
    Config,
}

#[derive(Deserialize)]
struct SyncProviderConfig {
    dropbox: SyncDropboxProviderConfig,
}

#[derive(Deserialize)]
struct SyncDropboxProviderConfig {
    client_id: String,
    client_secret: String,
    auth_token: String,
}

pub const CHAT_SESSIONS_KEY: &str = "chat-sessions";
