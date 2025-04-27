use crate::synchronization::sync_plan::SyncPlan;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SyncStatus {
    InProgress,
    RequireReload,
    Finished,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncPayload {
    pub(crate) status: SyncStatus,
    pub(crate) error_message: Option<String>,
}
