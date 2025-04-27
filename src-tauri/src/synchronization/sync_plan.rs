use crate::synchronization::sync::{SyncMetadata, Synchronize};
use std::collections::HashMap;

pub struct SyncPlan {
    pub(crate) to_download: Vec<String>,
    pub(crate) to_upload: Vec<String>,
    conflicts: Vec<String>,
}

impl SyncPlan {
    pub fn new() -> Self {
        SyncPlan {
            to_download: vec![],
            to_upload: vec![],
            conflicts: vec![],
        }
    }
    pub fn create_sync_plan(&self, local: &SyncMetadata, remote: &SyncMetadata) -> SyncPlan {
        let mut plan = SyncPlan {
            to_download: Vec::new(),
            to_upload: Vec::new(),
            conflicts: Vec::new(),
        };

        let local_map: HashMap<_, _> = local
            .chat_session
            .iter()
            .map(|s| (s.id.clone(), s))
            .collect();

        // Check remote changes
        for remote_session in &remote.chat_session {
            match local_map.get(&remote_session.id) {
                Some(local_session) => {
                    if local_session.hash != remote_session.hash {
                        if remote_session.update_time > local_session.update_time {
                            plan.to_download.push(remote_session.id.clone());
                        } else {
                            plan.to_upload.push(remote_session.id.clone());
                        }
                    }
                }
                None => plan.to_download.push(remote_session.id.clone()),
            }
        }

        // Check local changes not in remote
        for local_session in &local.chat_session {
            if !remote
                .chat_session
                .iter()
                .any(|rs| rs.id == local_session.id)
            {
                plan.to_upload.push(local_session.id.clone());
            }
        }

        plan
    }
}
