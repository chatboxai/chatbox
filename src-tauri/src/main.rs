#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use http::header::{HeaderName, HeaderValue};
use rmcp::{
    model::{CallToolRequestParams, ClientCapabilities, ClientInfo, Implementation},
    transport::streamable_http_client::StreamableHttpClientTransportConfig,
    transport::{StreamableHttpClientTransport, TokioChildProcess},
    ServiceExt,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicI64, AtomicU64, Ordering},
        Mutex,
    },
};
use sys_locale::get_locale;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, WindowEvent};
use tokio::process::Command;
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type")]
enum McpTransportConfig {
    #[serde(rename = "stdio")]
    Stdio {
        command: String,
        args: Vec<String>,
        env: Option<HashMap<String, String>>,
    },
    #[serde(rename = "http")]
    Http {
        url: String,
        headers: Option<HashMap<String, String>>,
    },
}

#[derive(Debug, Clone)]
struct McpServerState {
    id: String,
    transport: McpTransportConfig,
    connected: bool,
    last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpToolInfo {
    name: String,
    description: String,
    input_schema: Value,
}

#[derive(Debug, Clone)]
struct KnowledgeBaseRecord {
    id: i64,
    name: String,
    embedding_model: String,
    rerank_model: String,
    vision_model: Option<String>,
    provider_mode: Option<String>,
    document_parser: Option<Value>,
    created_at: i64,
}

#[derive(Debug, Clone)]
struct KnowledgeBaseFileRecord {
    id: i64,
    kb_id: i64,
    filename: String,
    filepath: String,
    mime_type: String,
    file_size: i64,
    chunk_count: i64,
    total_chunks: i64,
    status: String,
    error: Option<String>,
    created_at: i64,
    parsed_remotely: i64,
    parser_type: String,
}

#[derive(Debug, Default)]
struct KnowledgeBaseState {
    bases: HashMap<i64, KnowledgeBaseRecord>,
    files: HashMap<i64, KnowledgeBaseFileRecord>,
    file_chunks: HashMap<i64, Vec<String>>,
}

#[derive(Default)]
struct AppState {
    store: Mutex<HashMap<String, Value>>,
    blobs: Mutex<HashMap<String, String>>,
    mcp_servers: Mutex<HashMap<String, McpServerState>>,
    next_mcp_id: AtomicU64,
    kb: Mutex<KnowledgeBaseState>,
    next_kb_id: AtomicI64,
    next_file_id: AtomicI64,
}

type CommandResult<T> = Result<T, String>;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn map_platform() -> String {
    match std::env::consts::OS {
        "macos" => "darwin".to_string(),
        "windows" => "win32".to_string(),
        other => other.to_string(),
    }
}

fn map_arch() -> String {
    match std::env::consts::ARCH {
        "aarch64" => "arm64".to_string(),
        "x86_64" => "x64".to_string(),
        other => other.to_string(),
    }
}

fn get_arg<'a>(args: &'a [Value], idx: usize) -> CommandResult<&'a Value> {
    args.get(idx)
        .ok_or_else(|| format!("missing argument at index {idx}"))
}

fn get_arg_string(args: &[Value], idx: usize) -> CommandResult<String> {
    get_arg(args, idx)?
        .as_str()
        .map(std::string::ToString::to_string)
        .ok_or_else(|| format!("argument {idx} is not a string"))
}

fn get_arg_bool(args: &[Value], idx: usize) -> CommandResult<bool> {
    get_arg(args, idx)?
        .as_bool()
        .ok_or_else(|| format!("argument {idx} is not a boolean"))
}

fn default_settings() -> Value {
    json!({
      "mcp": {
        "enabledBuiltinServers": [],
        "servers": []
      },
      "shortcuts": {
        "quickToggle": "Alt+`"
      }
    })
}

fn default_config() -> Value {
    json!({
      "uuid": Uuid::new_v4().to_string()
    })
}

fn extract_tool_list(raw_tools: Value) -> Vec<McpToolInfo> {
    let mut output = Vec::new();
    let tools = raw_tools.as_array().cloned().unwrap_or_default();

    for tool in tools {
        let name = tool
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if name.is_empty() {
            continue;
        }
        let description = tool
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let input_schema = tool
            .get("inputSchema")
            .or_else(|| tool.get("input_schema"))
            .cloned()
            .unwrap_or_else(|| json!({ "type": "object", "properties": {} }));

        output.push(McpToolInfo {
            name,
            description,
            input_schema,
        });
    }

    output
}

fn build_http_transport_config(
    url: &str,
    headers: &Option<HashMap<String, String>>,
) -> CommandResult<StreamableHttpClientTransportConfig> {
    let mut config = StreamableHttpClientTransportConfig::with_uri(url.to_string());
    let mut custom_headers = HashMap::<HeaderName, HeaderValue>::new();
    let mut bearer_token: Option<String> = None;

    if let Some(headers) = headers {
        for (name, value) in headers {
            let header_name = HeaderName::from_bytes(name.as_bytes())
                .map_err(|err| format!("invalid MCP HTTP header name `{name}`: {err}"))?;

            // rmcp has dedicated bearer auth support. Keep it normalized to avoid duplicate auth headers.
            if bearer_token.is_none() && header_name.as_str().eq_ignore_ascii_case("authorization")
            {
                let token = value
                    .strip_prefix("Bearer ")
                    .or_else(|| value.strip_prefix("bearer "))
                    .map(str::trim)
                    .filter(|token| !token.is_empty())
                    .map(std::string::ToString::to_string);
                if let Some(token) = token {
                    bearer_token = Some(token);
                    continue;
                }
            }

            let header_value = HeaderValue::from_str(value)
                .map_err(|err| format!("invalid MCP HTTP header value for `{name}`: {err}"))?;
            custom_headers.insert(header_name, header_value);
        }
    }

    if let Some(token) = bearer_token {
        config = config.auth_header(token);
    }
    if !custom_headers.is_empty() {
        config = config.custom_headers(custom_headers);
    }

    Ok(config)
}

fn load_text_from_file(filepath: &str, mime_type: &str) -> Option<String> {
    if filepath.is_empty() {
        return None;
    }
    let lower_path = filepath.to_ascii_lowercase();
    let supports_text = mime_type.starts_with("text/")
        || mime_type.contains("json")
        || mime_type.contains("xml")
        || lower_path.ends_with(".txt")
        || lower_path.ends_with(".md")
        || lower_path.ends_with(".markdown")
        || lower_path.ends_with(".json")
        || lower_path.ends_with(".csv")
        || lower_path.ends_with(".log");
    if !supports_text {
        return None;
    }
    std::fs::read_to_string(filepath).ok()
}

fn chunk_text(text: &str, max_chunk_chars: usize) -> Vec<String> {
    if text.is_empty() || max_chunk_chars == 0 {
        return Vec::new();
    }

    let chars = text.chars().collect::<Vec<_>>();
    let mut chunks = Vec::new();
    let mut start = 0;

    while start < chars.len() {
        let end = (start + max_chunk_chars).min(chars.len());
        let chunk = chars[start..end].iter().collect::<String>();
        if !chunk.trim().is_empty() {
            chunks.push(chunk);
        }
        start = end;
    }

    chunks
}

fn score_search_text(query_lower: &str, query_terms: &[String], text: &str) -> f64 {
    if text.is_empty() || query_terms.is_empty() {
        return 0.0;
    }

    let text_lower = text.to_ascii_lowercase();
    let term_hits = query_terms
        .iter()
        .filter(|term| text_lower.contains(term.as_str()))
        .count();

    if term_hits == 0 && !text_lower.contains(query_lower) {
        return 0.0;
    }

    let mut score = term_hits as f64 / query_terms.len() as f64;
    if text_lower.contains(query_lower) {
        score += 0.5;
    }
    score
}

async fn run_stdio_list_tools(config: &McpTransportConfig) -> CommandResult<Vec<McpToolInfo>> {
    let McpTransportConfig::Stdio { command, args, env } = config else {
        return Err("invalid stdio config".to_string());
    };

    let mut cmd = Command::new(command);
    cmd.args(args);
    if let Some(envs) = env {
        cmd.envs(envs);
    }

    let transport =
        TokioChildProcess::new(cmd).map_err(|err| format!("stdio transport init failed: {err}"))?;
    let client = ()
        .serve(transport)
        .await
        .map_err(|err| format!("mcp stdio connect failed: {err}"))?;

    let tools = client
        .list_all_tools()
        .await
        .map_err(|err| format!("mcp stdio list tools failed: {err}"));

    let _ = client.cancel().await;

    let tools = tools?;
    let raw = serde_json::to_value(tools)
        .map_err(|err| format!("serialize stdio tools failed: {err}"))?;
    Ok(extract_tool_list(raw))
}

async fn run_http_list_tools(config: &McpTransportConfig) -> CommandResult<Vec<McpToolInfo>> {
    let McpTransportConfig::Http { url, headers } = config else {
        return Err("invalid http config".to_string());
    };

    let client_info = ClientInfo {
        meta: None,
        protocol_version: Default::default(),
        capabilities: ClientCapabilities::default(),
        client_info: Implementation {
            name: "chaeboxi".to_string(),
            title: None,
            version: "0.1.0".to_string(),
            description: None,
            website_url: None,
            icons: None,
        },
    };

    let transport_config = build_http_transport_config(url, headers)?;
    let transport = StreamableHttpClientTransport::from_config(transport_config);
    let client = client_info
        .serve(transport)
        .await
        .map_err(|err| format!("mcp http connect failed: {err}"))?;

    let tools = client
        .list_all_tools()
        .await
        .map_err(|err| format!("mcp http list tools failed: {err}"));

    let _ = client.cancel().await;

    let tools = tools?;
    let raw =
        serde_json::to_value(tools).map_err(|err| format!("serialize http tools failed: {err}"))?;
    Ok(extract_tool_list(raw))
}

async fn list_tools_for_config(config: &McpTransportConfig) -> CommandResult<Vec<McpToolInfo>> {
    match config {
        McpTransportConfig::Stdio { .. } => run_stdio_list_tools(config).await,
        McpTransportConfig::Http { .. } => run_http_list_tools(config).await,
    }
}

async fn run_stdio_call_tool(
    config: &McpTransportConfig,
    tool_name: &str,
    arguments: Value,
) -> CommandResult<Value> {
    let McpTransportConfig::Stdio { command, args, env } = config else {
        return Err("invalid stdio config".to_string());
    };

    let mut cmd = Command::new(command);
    cmd.args(args);
    if let Some(envs) = env {
        cmd.envs(envs);
    }

    let transport =
        TokioChildProcess::new(cmd).map_err(|err| format!("stdio transport init failed: {err}"))?;
    let client = ()
        .serve(transport)
        .await
        .map_err(|err| format!("mcp stdio connect failed: {err}"))?;

    let response = client
        .call_tool(CallToolRequestParams {
            meta: None,
            name: tool_name.to_string().into(),
            arguments: arguments.as_object().cloned(),
            task: None,
        })
        .await
        .map_err(|err| format!("mcp stdio call tool failed: {err}"));

    let _ = client.cancel().await;

    let response = response?;
    serde_json::to_value(response)
        .map_err(|err| format!("serialize stdio call tool response failed: {err}"))
}

async fn run_http_call_tool(
    config: &McpTransportConfig,
    tool_name: &str,
    arguments: Value,
) -> CommandResult<Value> {
    let McpTransportConfig::Http { url, headers } = config else {
        return Err("invalid http config".to_string());
    };

    let client_info = ClientInfo {
        meta: None,
        protocol_version: Default::default(),
        capabilities: ClientCapabilities::default(),
        client_info: Implementation {
            name: "chaeboxi".to_string(),
            title: None,
            version: "0.1.0".to_string(),
            description: None,
            website_url: None,
            icons: None,
        },
    };

    let transport_config = build_http_transport_config(url, headers)?;
    let transport = StreamableHttpClientTransport::from_config(transport_config);
    let client = client_info
        .serve(transport)
        .await
        .map_err(|err| format!("mcp http connect failed: {err}"))?;

    let response = client
        .call_tool(CallToolRequestParams {
            meta: None,
            name: tool_name.to_string().into(),
            arguments: arguments.as_object().cloned(),
            task: None,
        })
        .await
        .map_err(|err| format!("mcp http call tool failed: {err}"));

    let _ = client.cancel().await;

    let response = response?;
    serde_json::to_value(response)
        .map_err(|err| format!("serialize http call tool response failed: {err}"))
}

async fn call_tool_for_config(
    config: &McpTransportConfig,
    tool_name: &str,
    arguments: Value,
) -> CommandResult<Value> {
    match config {
        McpTransportConfig::Stdio { .. } => run_stdio_call_tool(config, tool_name, arguments).await,
        McpTransportConfig::Http { .. } => run_http_call_tool(config, tool_name, arguments).await,
    }
}

#[tauri::command]
async fn ipc_invoke(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    channel: String,
    args: Vec<Value>,
) -> CommandResult<Value> {
    match channel.as_str() {
        "getStoreValue" => {
            let key = get_arg_string(&args, 0)?;
            let store = state
                .store
                .lock()
                .map_err(|_| "store lock poisoned".to_string())?;
            Ok(store.get(&key).cloned().unwrap_or(Value::Null))
        }
        "setStoreValue" => {
            let key = get_arg_string(&args, 0)?;
            let data_json = get_arg_string(&args, 1)?;
            let value = serde_json::from_str::<Value>(&data_json).unwrap_or(Value::Null);
            state
                .store
                .lock()
                .map_err(|_| "store lock poisoned".to_string())?
                .insert(key, value);
            Ok(Value::Null)
        }
        "delStoreValue" => {
            let key = get_arg_string(&args, 0)?;
            state
                .store
                .lock()
                .map_err(|_| "store lock poisoned".to_string())?
                .remove(&key);
            Ok(Value::Null)
        }
        "getAllStoreValues" => {
            let store = state
                .store
                .lock()
                .map_err(|_| "store lock poisoned".to_string())?;
            let json_str = serde_json::to_string(&*store)
                .map_err(|err| format!("serialize store failed: {err}"))?;
            Ok(Value::String(json_str))
        }
        "setAllStoreValues" => {
            let data_json = get_arg_string(&args, 0)?;
            let data = serde_json::from_str::<Value>(&data_json)
                .map_err(|err| format!("invalid json: {err}"))?;
            if let Some(map) = data.as_object() {
                let mut store = state
                    .store
                    .lock()
                    .map_err(|_| "store lock poisoned".to_string())?;
                for (key, value) in map {
                    store.insert(key.to_string(), value.clone());
                }
            }
            Ok(Value::Null)
        }
        "getAllStoreKeys" => {
            let store = state
                .store
                .lock()
                .map_err(|_| "store lock poisoned".to_string())?;
            Ok(Value::Array(
                store.keys().map(|k| Value::String(k.to_string())).collect(),
            ))
        }
        "getStoreBlob" => {
            let key = get_arg_string(&args, 0)?;
            let blobs = state
                .blobs
                .lock()
                .map_err(|_| "blob store lock poisoned".to_string())?;
            Ok(blobs
                .get(&key)
                .cloned()
                .map(Value::String)
                .unwrap_or(Value::Null))
        }
        "setStoreBlob" => {
            let key = get_arg_string(&args, 0)?;
            let value = get_arg_string(&args, 1)?;
            state
                .blobs
                .lock()
                .map_err(|_| "blob store lock poisoned".to_string())?
                .insert(key, value);
            Ok(Value::Null)
        }
        "delStoreBlob" => {
            let key = get_arg_string(&args, 0)?;
            state
                .blobs
                .lock()
                .map_err(|_| "blob store lock poisoned".to_string())?
                .remove(&key);
            Ok(Value::Null)
        }
        "listStoreBlobKeys" => {
            let blobs = state
                .blobs
                .lock()
                .map_err(|_| "blob store lock poisoned".to_string())?;
            Ok(Value::Array(
                blobs.keys().map(|k| Value::String(k.to_string())).collect(),
            ))
        }
        "getVersion" => Ok(Value::String(app.package_info().version.to_string())),
        "getPlatform" => Ok(Value::String(map_platform())),
        "getArch" => Ok(Value::String(map_arch())),
        "getHostname" => {
            let hostname = hostname::get()
                .ok()
                .and_then(|value| value.to_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "unknown".to_string());
            Ok(Value::String(hostname))
        }
        "getDeviceName" => {
            let hostname = hostname::get()
                .ok()
                .and_then(|value| value.to_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "unknown".to_string());
            Ok(Value::String(hostname))
        }
        "getLocale" => {
            let locale = get_locale().unwrap_or_else(|| "en-US".to_string());
            Ok(Value::String(locale))
        }
        "openLink" => {
            let url = get_arg_string(&args, 0)?;
            webbrowser::open(&url).map_err(|err| format!("open link failed: {err}"))?;
            Ok(Value::Null)
        }
        "ensureShortcutConfig" => Ok(Value::Null),
        "shouldUseDarkColors" => {
            let theme = window
                .theme()
                .map_err(|err| format!("get window theme failed: {err}"))?;
            Ok(Value::Bool(matches!(theme, tauri::Theme::Dark)))
        }
        "ensureProxy" => Ok(Value::Null),
        "relaunch" => {
            // app.restart() is a diverging `-> !` method on AppHandle in Tauri v2.
            // It terminates and relaunches the process. The Ok below is unreachable
            // but required to satisfy the match arm return type.
            app.restart();
            #[allow(unreachable_code)]
            Ok(Value::Null)
        }
        "analysticTrackingEvent" => Ok(Value::Null),
        "getConfig" => {
            let mut store = state
                .store
                .lock()
                .map_err(|_| "store lock poisoned".to_string())?;
            let config = store
                .entry("configs".to_string())
                .or_insert_with(default_config)
                .clone();
            Ok(config)
        }
        "getSettings" => {
            let store = state
                .store
                .lock()
                .map_err(|_| "store lock poisoned".to_string())?;
            let settings = store
                .get("settings")
                .cloned()
                .unwrap_or_else(default_settings);
            Ok(settings)
        }
        "shouldShowAboutDialogWhenStartUp" => Ok(Value::Bool(false)),
        "appLog" => {
            if let Ok(data) = get_arg_string(&args, 0) {
                println!("APP_LOG: {data}");
            }
            Ok(Value::Null)
        }
        "exportLogs" => Ok(Value::String(String::new())),
        "clearLogs" => Ok(Value::Null),
        "ensureAutoLaunch" => Ok(Value::Null),
        "parseFileLocally" => {
            let data_json = get_arg_string(&args, 0)?;
            let data = serde_json::from_str::<Value>(&data_json)
                .map_err(|err| format!("invalid json: {err}"))?;
            let file_path = data
                .get("filePath")
                .and_then(Value::as_str)
                .ok_or_else(|| "filePath is required".to_string())?;

            match std::fs::read_to_string(file_path) {
                Ok(text) => Ok(Value::String(
                    json!({
                      "text": text,
                      "isSupported": true
                    })
                    .to_string(),
                )),
                Err(_) => Ok(Value::String(json!({ "isSupported": false }).to_string())),
            }
        }
        "parseUrl" => Ok(Value::String(json!({ "key": "", "title": "" }).to_string())),
        "isFullscreen" => {
            Ok(Value::Bool(window.is_fullscreen().map_err(|err| {
                format!("fullscreen check failed: {err}")
            })?))
        }
        "setFullscreen" => {
            let enabled = get_arg_bool(&args, 0)?;
            window
                .set_fullscreen(enabled)
                .map_err(|err| format!("set fullscreen failed: {err}"))?;
            Ok(Value::Null)
        }
        "install-update" => Ok(Value::Null),
        "switch-theme" => Ok(Value::Null),
        "window:minimize" => {
            window
                .minimize()
                .map_err(|err| format!("window minimize failed: {err}"))?;
            Ok(Value::Null)
        }
        "window:maximize" => {
            window
                .maximize()
                .map_err(|err| format!("window maximize failed: {err}"))?;
            Ok(Value::Null)
        }
        "window:unmaximize" => {
            window
                .unmaximize()
                .map_err(|err| format!("window unmaximize failed: {err}"))?;
            Ok(Value::Null)
        }
        "window:close" => {
            window
                .close()
                .map_err(|err| format!("window close failed: {err}"))?;
            Ok(Value::Null)
        }
        "window:is-maximized" => {
            Ok(Value::Bool(window.is_maximized().map_err(|err| {
                format!("window maximize state check failed: {err}")
            })?))
        }

        // mcp:stdio-transport:* channels are the legacy Electron/preload IPC route.
        // In the Tauri runtime, MCP runs natively in Rust via the mcp:server:* commands
        // below. The renderer's createTauriClient() should always be used when
        // isTauriRuntime() is true, so these channels should never be called.
        "mcp:stdio-transport:create"
        | "mcp:stdio-transport:start"
        | "mcp:stdio-transport:send"
        | "mcp:stdio-transport:close" => Err(format!(
            "IPC channel '{channel}' is not supported in the Tauri runtime. \
             Use mcp:server:create / mcp:server:start / mcp:server:call-tool instead."
        )),

        // MCP backend commands for Tauri renderer runtime
        "mcp:server:create" => {
            let config_value = get_arg(&args, 0)?.clone();
            let transport = serde_json::from_value::<McpTransportConfig>(config_value)
                .map_err(|err| format!("invalid MCP transport config: {err}"))?;
            let id = format!(
                "mcp-{}",
                state.next_mcp_id.fetch_add(1, Ordering::Relaxed) + 1
            );
            let server_state = McpServerState {
                id: id.clone(),
                transport,
                connected: false,
                last_error: None,
            };
            state
                .mcp_servers
                .lock()
                .map_err(|_| "mcp server lock poisoned".to_string())?
                .insert(id.clone(), server_state);
            Ok(Value::String(id))
        }
        "mcp:server:start" => {
            let server_id = get_arg_string(&args, 0)?;
            let transport = {
                let servers = state
                    .mcp_servers
                    .lock()
                    .map_err(|_| "mcp server lock poisoned".to_string())?;
                let entry = servers
                    .get(&server_id)
                    .ok_or_else(|| format!("MCP server not found: {server_id}"))?;
                entry.transport.clone()
            };

            match list_tools_for_config(&transport).await {
                Ok(_) => {
                    let mut servers = state
                        .mcp_servers
                        .lock()
                        .map_err(|_| "mcp server lock poisoned".to_string())?;
                    if let Some(server) = servers.get_mut(&server_id) {
                        server.connected = true;
                        server.last_error = None;
                    }
                    Ok(Value::Null)
                }
                Err(err) => {
                    let mut servers = state
                        .mcp_servers
                        .lock()
                        .map_err(|_| "mcp server lock poisoned".to_string())?;
                    if let Some(server) = servers.get_mut(&server_id) {
                        server.connected = false;
                        server.last_error = Some(err.clone());
                    }
                    Err(err)
                }
            }
        }
        "mcp:server:list-tools" => {
            let server_id = get_arg_string(&args, 0)?;
            let transport = {
                let servers = state
                    .mcp_servers
                    .lock()
                    .map_err(|_| "mcp server lock poisoned".to_string())?;
                let entry = servers
                    .get(&server_id)
                    .ok_or_else(|| format!("MCP server not found: {server_id}"))?;
                entry.transport.clone()
            };

            let tools = list_tools_for_config(&transport).await?;
            serde_json::to_value(tools).map_err(|err| format!("serialize MCP tools failed: {err}"))
        }
        "mcp:server:call-tool" => {
            let server_id = get_arg_string(&args, 0)?;
            let tool_name = get_arg_string(&args, 1)?;
            let arguments = get_arg(&args, 2).cloned().unwrap_or_else(|_| json!({}));

            let transport = {
                let servers = state
                    .mcp_servers
                    .lock()
                    .map_err(|_| "mcp server lock poisoned".to_string())?;
                let entry = servers
                    .get(&server_id)
                    .ok_or_else(|| format!("MCP server not found: {server_id}"))?;
                entry.transport.clone()
            };

            call_tool_for_config(&transport, &tool_name, arguments).await
        }
        "mcp:server:close" => {
            let server_id = get_arg_string(&args, 0)?;
            state
                .mcp_servers
                .lock()
                .map_err(|_| "mcp server lock poisoned".to_string())?
                .remove(&server_id);
            Ok(Value::Null)
        }
        "mcp:server:list" => {
            let servers = state
                .mcp_servers
                .lock()
                .map_err(|_| "mcp server lock poisoned".to_string())?;
            let list: Vec<Value> = servers
                .values()
                .map(|entry| {
                    json!({
                      "id": entry.id,
                      "connected": entry.connected,
                      "lastError": entry.last_error
                    })
                })
                .collect();
            Ok(Value::Array(list))
        }
        "mcp:server:status" => {
            let server_id = get_arg_string(&args, 0)?;
            let servers = state
                .mcp_servers
                .lock()
                .map_err(|_| "mcp server lock poisoned".to_string())?;
            let entry = servers
                .get(&server_id)
                .ok_or_else(|| format!("MCP server not found: {server_id}"))?;
            Ok(json!({
              "id": entry.id,
              "connected": entry.connected,
              "lastError": entry.last_error
            }))
        }

        // Knowledge base scaffolding in Rust runtime
        "kb:list" => {
            let kb = state
                .kb
                .lock()
                .map_err(|_| "kb lock poisoned".to_string())?;
            let mut result = Vec::new();
            for record in kb.bases.values() {
                result.push(json!({
                  "id": record.id,
                  "name": record.name,
                  "embeddingModel": record.embedding_model,
                  "rerankModel": record.rerank_model,
                  "visionModel": record.vision_model,
                  "providerMode": record.provider_mode,
                  "documentParser": record.document_parser,
                  "createdAt": record.created_at,
                }));
            }
            Ok(Value::Array(result))
        }
        "kb:create" => {
            let params = get_arg(&args, 0)?;
            let name = params
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("New Knowledge Base")
                .to_string();
            let embedding_model = params
                .get("embeddingModel")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let rerank_model = params
                .get("rerankModel")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let vision_model = params
                .get("visionModel")
                .and_then(Value::as_str)
                .map(std::string::ToString::to_string);
            let provider_mode = params
                .get("providerMode")
                .and_then(Value::as_str)
                .map(std::string::ToString::to_string);
            let document_parser = params.get("documentParser").cloned();

            let id = state.next_kb_id.fetch_add(1, Ordering::Relaxed) + 1;
            let record = KnowledgeBaseRecord {
                id,
                name,
                embedding_model,
                rerank_model,
                vision_model,
                provider_mode,
                document_parser,
                created_at: now_ms(),
            };
            let created_name = record.name.clone();
            state
                .kb
                .lock()
                .map_err(|_| "kb lock poisoned".to_string())?
                .bases
                .insert(id, record);
            Ok(json!({ "id": id, "name": created_name }))
        }
        "kb:update" => {
            let params = get_arg(&args, 0)?;
            let id = params
                .get("id")
                .and_then(Value::as_i64)
                .ok_or_else(|| "missing kb id".to_string())?;
            let mut kb = state
                .kb
                .lock()
                .map_err(|_| "kb lock poisoned".to_string())?;
            let record = kb
                .bases
                .get_mut(&id)
                .ok_or_else(|| format!("knowledge base {id} not found"))?;
            let mut updated = 0_i64;
            if let Some(name) = params.get("name").and_then(Value::as_str) {
                record.name = name.to_string();
                updated = 1;
            }
            if let Some(model) = params.get("rerankModel").and_then(Value::as_str) {
                record.rerank_model = model.to_string();
                updated = 1;
            }
            if let Some(model) = params.get("visionModel").and_then(Value::as_str) {
                record.vision_model = Some(model.to_string());
                updated = 1;
            }
            Ok(Value::Number(updated.into()))
        }
        "kb:delete" => {
            let kb_id = get_arg(&args, 0)?
                .as_i64()
                .ok_or_else(|| "invalid kb id".to_string())?;
            let mut kb = state
                .kb
                .lock()
                .map_err(|_| "kb lock poisoned".to_string())?;
            kb.bases.remove(&kb_id);
            let removed_file_ids: Vec<i64> = kb
                .files
                .values()
                .filter(|file| file.kb_id == kb_id)
                .map(|file| file.id)
                .collect();
            kb.files.retain(|_, file| file.kb_id != kb_id);
            for file_id in removed_file_ids {
                kb.file_chunks.remove(&file_id);
            }
            Ok(json!({ "success": true }))
        }
        "kb:file:list" => {
            let kb_id = get_arg(&args, 0)?
                .as_i64()
                .ok_or_else(|| "invalid kb id".to_string())?;
            let kb = state
                .kb
                .lock()
                .map_err(|_| "kb lock poisoned".to_string())?;
            let mut files = Vec::new();
            for file in kb.files.values().filter(|item| item.kb_id == kb_id) {
                files.push(json!({
                  "id": file.id,
                  "kb_id": file.kb_id,
                  "filename": file.filename,
                  "filepath": file.filepath,
                  "mime_type": file.mime_type,
                  "file_size": file.file_size,
                  "chunk_count": file.chunk_count,
                  "total_chunks": file.total_chunks,
                  "status": file.status,
                  "error": file.error,
                  "createdAt": file.created_at,
                  "parsed_remotely": file.parsed_remotely,
                  "parser_type": file.parser_type,
                }));
            }
            Ok(Value::Array(files))
        }
        "kb:file:count" => {
            let kb_id = get_arg(&args, 0)?
                .as_i64()
                .ok_or_else(|| "invalid kb id".to_string())?;
            let kb = state
                .kb
                .lock()
                .map_err(|_| "kb lock poisoned".to_string())?;
            let count = kb.files.values().filter(|item| item.kb_id == kb_id).count() as i64;
            Ok(Value::Number(count.into()))
        }
        "kb:file:list-paginated" => {
            let kb_id = get_arg(&args, 0)?
                .as_i64()
                .ok_or_else(|| "invalid kb id".to_string())?;
            let offset = get_arg(&args, 1)
                .ok()
                .and_then(Value::as_i64)
                .unwrap_or(0)
                .max(0) as usize;
            let limit = get_arg(&args, 2)
                .ok()
                .and_then(Value::as_i64)
                .unwrap_or(20)
                .max(1) as usize;

            let kb = state
                .kb
                .lock()
                .map_err(|_| "kb lock poisoned".to_string())?;
            let mut files: Vec<_> = kb
                .files
                .values()
                .filter(|item| item.kb_id == kb_id)
                .cloned()
                .collect();
            files.sort_by(|a, b| b.created_at.cmp(&a.created_at));

            let rows: Vec<Value> = files
                .into_iter()
                .skip(offset)
                .take(limit)
                .map(|file| {
                    json!({
                      "id": file.id,
                      "kb_id": file.kb_id,
                      "filename": file.filename,
                      "filepath": file.filepath,
                      "mime_type": file.mime_type,
                      "file_size": file.file_size,
                      "chunk_count": file.chunk_count,
                      "total_chunks": file.total_chunks,
                      "status": file.status,
                      "error": file.error,
                      "createdAt": file.created_at,
                      "parsed_remotely": file.parsed_remotely,
                      "parser_type": file.parser_type,
                    })
                })
                .collect();
            Ok(Value::Array(rows))
        }
        "kb:file:get-metas" => {
            let kb_id = get_arg(&args, 0)?
                .as_i64()
                .ok_or_else(|| "invalid kb id".to_string())?;
            let file_ids = get_arg(&args, 1)?
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter_map(|value| value.as_i64())
                .collect::<Vec<_>>();

            let kb = state
                .kb
                .lock()
                .map_err(|_| "kb lock poisoned".to_string())?;
            let mut rows = Vec::new();
            for file_id in file_ids {
                if let Some(file) = kb.files.get(&file_id) {
                    if file.kb_id != kb_id {
                        continue;
                    }
                    rows.push(json!({
                      "id": file.id,
                      "kbId": file.kb_id,
                      "filename": file.filename,
                      "mimeType": file.mime_type,
                      "fileSize": file.file_size,
                      "chunkCount": file.chunk_count,
                      "totalChunks": file.total_chunks,
                      "status": file.status,
                      "createdAt": file.created_at,
                    }));
                }
            }
            Ok(Value::Array(rows))
        }
        "kb:file:read-chunks" => {
            let kb_id = get_arg(&args, 0)?
                .as_i64()
                .ok_or_else(|| "invalid kb id".to_string())?;
            let chunks = get_arg(&args, 1)?
                .as_array()
                .ok_or_else(|| "invalid chunks parameter".to_string())?;

            let kb = state
                .kb
                .lock()
                .map_err(|_| "kb lock poisoned".to_string())?;

            let mut rows = Vec::new();
            for chunk in chunks {
                let file_id = chunk
                    .get("fileId")
                    .and_then(Value::as_i64)
                    .ok_or_else(|| "invalid chunk.fileId".to_string())?;
                let chunk_index = chunk
                    .get("chunkIndex")
                    .and_then(Value::as_i64)
                    .ok_or_else(|| "invalid chunk.chunkIndex".to_string())?;

                if chunk_index < 0 {
                    continue;
                }
                let Some(file) = kb.files.get(&file_id) else {
                    continue;
                };
                if file.kb_id != kb_id {
                    continue;
                }
                let Some(file_chunks) = kb.file_chunks.get(&file_id) else {
                    continue;
                };
                let Some(text) = file_chunks.get(chunk_index as usize) else {
                    continue;
                };

                rows.push(json!({
                  "fileId": file_id,
                  "filename": file.filename,
                  "chunkIndex": chunk_index,
                  "text": text,
                }));
            }
            Ok(Value::Array(rows))
        }
        "kb:file:upload" => {
            let kb_id = get_arg(&args, 0)?
                .as_i64()
                .ok_or_else(|| "invalid kb id".to_string())?;
            let file = get_arg(&args, 1)?;
            let filename = file
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string();
            let filepath = file
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let mime_type = file
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("application/octet-stream")
                .to_string();

            let chunks = load_text_from_file(&filepath, &mime_type)
                .map(|text| chunk_text(&text, 1200))
                .unwrap_or_default();
            let chunk_count = chunks.len() as i64;

            let id = state.next_file_id.fetch_add(1, Ordering::Relaxed) + 1;
            let record = KnowledgeBaseFileRecord {
                id,
                kb_id,
                filename,
                filepath,
                mime_type,
                file_size: file.get("size").and_then(Value::as_i64).unwrap_or(0),
                chunk_count,
                total_chunks: chunk_count,
                status: "done".to_string(),
                error: None,
                created_at: now_ms(),
                parsed_remotely: 0,
                parser_type: "local".to_string(),
            };
            let mut kb = state
                .kb
                .lock()
                .map_err(|_| "kb lock poisoned".to_string())?;
            kb.files.insert(id, record);
            kb.file_chunks.insert(id, chunks);
            Ok(json!({ "id": id }))
        }
        "kb:search" => {
            let kb_id = get_arg(&args, 0)?
                .as_i64()
                .ok_or_else(|| "invalid kb id".to_string())?;
            let query = get_arg_string(&args, 1)?.trim().to_string();
            if query.is_empty() {
                return Err("Search query is required".to_string());
            }

            let query_lower = query.to_ascii_lowercase();
            let query_terms: Vec<String> = query_lower
                .split_whitespace()
                .map(str::trim)
                .filter(|term| !term.is_empty())
                .map(std::string::ToString::to_string)
                .collect();

            let kb = state
                .kb
                .lock()
                .map_err(|_| "kb lock poisoned".to_string())?;
            if !kb.bases.contains_key(&kb_id) {
                return Err(format!("knowledge base {kb_id} not found"));
            }

            let mut matches = Vec::<(f64, Value)>::new();
            for file in kb.files.values().filter(|item| item.kb_id == kb_id) {
                let Some(chunks) = kb.file_chunks.get(&file.id) else {
                    continue;
                };
                for (chunk_index, text) in chunks.iter().enumerate() {
                    let score = score_search_text(&query_lower, &query_terms, text);
                    if score <= 0.0 {
                        continue;
                    }
                    matches.push((
                        score,
                        json!({
                          "id": file.id.saturating_mul(1_000_000) + chunk_index as i64,
                          "score": score,
                          "text": text,
                          "fileId": file.id,
                          "filename": file.filename,
                          "mimeType": file.mime_type,
                          "chunkIndex": chunk_index
                        }),
                    ));
                }
            }

            matches.sort_by(|left, right| {
                right
                    .0
                    .partial_cmp(&left.0)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });

            let rows = matches
                .into_iter()
                .take(20)
                .map(|(_, result)| result)
                .collect::<Vec<_>>();
            Ok(Value::Array(rows))
        }
        "kb:file:retry" => {
            let file_id = get_arg(&args, 0)?
                .as_i64()
                .ok_or_else(|| "invalid file id".to_string())?;
            let use_remote_parsing = get_arg(&args, 1)
                .ok()
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let mut kb = state
                .kb
                .lock()
                .map_err(|_| "kb lock poisoned".to_string())?;
            let file = kb
                .files
                .get_mut(&file_id)
                .ok_or_else(|| format!("file {file_id} not found"))?;
            file.status = "pending".to_string();
            file.error = None;
            file.chunk_count = 0;
            file.total_chunks = 0;
            file.parsed_remotely = if use_remote_parsing { 1 } else { 0 };
            file.parser_type = if use_remote_parsing {
                "chatbox-ai".to_string()
            } else {
                "local".to_string()
            };
            kb.file_chunks.remove(&file_id);
            Ok(json!({ "success": true }))
        }
        "kb:file:pause" => {
            let file_id = get_arg(&args, 0)?
                .as_i64()
                .ok_or_else(|| "invalid file id".to_string())?;
            let mut kb = state
                .kb
                .lock()
                .map_err(|_| "kb lock poisoned".to_string())?;
            if let Some(file) = kb.files.get_mut(&file_id) {
                file.status = "paused".to_string();
            }
            Ok(json!({ "success": true }))
        }
        "kb:file:resume" => {
            let file_id = get_arg(&args, 0)?
                .as_i64()
                .ok_or_else(|| "invalid file id".to_string())?;
            let mut kb = state
                .kb
                .lock()
                .map_err(|_| "kb lock poisoned".to_string())?;
            let file = kb
                .files
                .get_mut(&file_id)
                .ok_or_else(|| format!("file {file_id} not found"))?;
            file.status = "pending".to_string();
            file.error = None;
            Ok(json!({ "success": true }))
        }
        "kb:file:delete" => {
            let file_id = get_arg(&args, 0)?
                .as_i64()
                .ok_or_else(|| "invalid file id".to_string())?;
            let mut kb = state
                .kb
                .lock()
                .map_err(|_| "kb lock poisoned".to_string())?;
            kb.files.remove(&file_id);
            kb.file_chunks.remove(&file_id);
            Ok(json!({ "success": true }))
        }
        "parser:test-mineru" => Ok(json!({
          "success": false,
          "error": "MinerU parser is not configured in Tauri runtime yet"
        })),
        "parser:parse-file-with-mineru" => Ok(json!({
          "success": false,
          "error": "MinerU parser is not configured in Tauri runtime yet"
        })),
        "parser:cancel-mineru-parse" => Ok(json!({ "success": true })),

        _ => Err(format!("unknown ipc channel: {channel}")),
    }
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            next_mcp_id: AtomicU64::new(0),
            next_kb_id: AtomicI64::new(0),
            next_file_id: AtomicI64::new(0),
            ..Default::default()
        })
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("window-show", json!({}));
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Focused(true) => {
                let _ = window.emit("window:focused", json!({}));
            }
            WindowEvent::ThemeChanged(_) => {
                let _ = window.emit("system-theme-updated", json!({}));
            }
            // Only emit on actual maximize/unmaximize transitions, not every resize.
            // Using Resized caused spurious re-renders every time the user dragged
            // the window edge.
            WindowEvent::ScaleFactorChanged { .. } => {
                // Not used currently, but prevents fallthrough to the catch-all.
            }
            WindowEvent::Resized(_) => {}
            _ => {
                // Emit maximize-changed for Maximized/Unmaximized/Fullscreen events.
                // Tauri 2.x fires WindowEvent variants for these; check the state
                // after any unrecognised event so we catch both paths.
                if let Ok(is_maximized) = window.is_maximized() {
                    let _ = window.emit("window:maximized-changed", is_maximized);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![ipc_invoke])
        .run(tauri::generate_context!())
        .expect("failed to run tauri application")
}
