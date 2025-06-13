use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("Connection error: {0}")]
    Connection(String),

    #[error("Socket error: {0}")]
    Socket(#[from] std::io::Error),

    #[error("JSON serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("RPC error: {code} - {message}")]
    Rpc { code: i32, message: String },

    #[error("Protocol error: {0}")]
    Protocol(String),

    #[error("Timeout error")]
    Timeout,

    #[error("Invalid response: {0}")]
    InvalidResponse(String),

    #[error("Subscription error: {0}")]
    Subscription(String),

    #[error("Session error: {0}")]
    Session(String),

    #[error("Approval error: {0}")]
    Approval(String),
}

pub type Result<T> = std::result::Result<T, Error>;