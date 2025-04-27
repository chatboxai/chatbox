#[derive(Debug)]
pub enum SyncError {
    MissingProviderConfig,
    MissingAuthToken,
}

// Implement `From` for your error to convert it to a frontend-friendly string
impl std::fmt::Display for SyncError {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            SyncError::MissingProviderConfig => write!(f, "Provider config not found"),
            SyncError::MissingAuthToken => write!(f, "Authentication token missing"),
        }
    }
}
