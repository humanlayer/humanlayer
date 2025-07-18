use crate::daemon_client::error::{Error, Result};
use std::env;
use std::path::PathBuf;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::Mutex;
use tokio::time::{sleep, timeout};
use tracing::{debug, info};

const DEFAULT_SOCKET_PATH: &str = ".humanlayer/daemon.sock";
const CONNECTION_TIMEOUT: Duration = Duration::from_secs(5);
const RETRY_DELAY: Duration = Duration::from_millis(500);

pub struct Connection {
    stream: Mutex<UnixStream>,
    socket_path: PathBuf,
}

impl Connection {
    /// Create a new connection to the daemon
    pub async fn new(socket_path: Option<PathBuf>) -> Result<Self> {
        let path = socket_path.unwrap_or_else(Self::default_socket_path);
        let stream = Self::connect_to_socket(&path).await?;

        Ok(Connection {
            stream: Mutex::new(stream),
            socket_path: path,
        })
    }

    /// Connect with retries
    pub async fn connect_with_retries(
        socket_path: Option<PathBuf>,
        max_retries: u32,
    ) -> Result<Self> {
        let path = socket_path.unwrap_or_else(Self::default_socket_path);

        for attempt in 0..=max_retries {
            match Self::connect_to_socket(&path).await {
                Ok(stream) => {
                    info!("Connected to daemon at {:?}", path);
                    return Ok(Connection {
                        stream: Mutex::new(stream),
                        socket_path: path,
                    });
                }
                Err(e) => {
                    if attempt < max_retries {
                        debug!(
                            "Connection attempt {} failed: {}. Retrying in {:?}",
                            attempt + 1,
                            e,
                            RETRY_DELAY
                        );
                        sleep(RETRY_DELAY).await;
                    } else {
                        return Err(e);
                    }
                }
            }
        }

        Err(Error::Connection(format!(
            "Failed to connect after {} attempts",
            max_retries + 1
        )))
    }

    /// Send a message and receive a response
    pub async fn send_request(&self, message: &str) -> Result<String> {
        let mut stream = self.stream.lock().await;

        // Send the message with newline
        let message_with_newline = format!("{}\n", message);
        stream
            .write_all(message_with_newline.as_bytes())
            .await
            .map_err(|e| Error::Socket(e))?;
        stream.flush().await.map_err(|e| Error::Socket(e))?;

        // Read the response
        let mut reader = BufReader::new(&mut *stream);
        let mut response = String::new();

        match timeout(CONNECTION_TIMEOUT, reader.read_line(&mut response)).await {
            Ok(Ok(0)) => Err(Error::Connection("Connection closed by daemon".to_string())),
            Ok(Ok(_)) => {
                // Remove the trailing newline
                if response.ends_with('\n') {
                    response.pop();
                }
                Ok(response)
            }
            Ok(Err(e)) => Err(Error::Socket(e)),
            Err(_) => Err(Error::Timeout),
        }
    }

    /// Create a new connection for subscriptions (doesn't reuse the main connection)
    pub async fn create_subscription_connection(&self) -> Result<UnixStream> {
        Self::connect_to_socket(&self.socket_path).await
    }

    /// Get the default socket path
    fn default_socket_path() -> PathBuf {
        // Check environment variable first, matching daemon's behavior
        if let Ok(socket_path) = env::var("HUMANLAYER_DAEMON_SOCKET") {
            return PathBuf::from(socket_path);
        }

        // Fall back to default
        let home = dirs::home_dir().expect("Could not find home directory");
        home.join(DEFAULT_SOCKET_PATH)
    }

    /// Connect to the Unix socket
    async fn connect_to_socket(path: &PathBuf) -> Result<UnixStream> {
        // Check if socket exists
        if !path.exists() {
            return Err(Error::Connection(format!(
                "Socket not found at {:?}. Is the daemon running?",
                path
            )));
        }

        match timeout(CONNECTION_TIMEOUT, UnixStream::connect(path)).await {
            Ok(Ok(stream)) => Ok(stream),
            Ok(Err(e)) => Err(Error::Socket(e)),
            Err(_) => Err(Error::Timeout),
        }
    }

    /// Check if the connection is still alive
    pub async fn is_alive(&self) -> bool {
        // Try to get a lock with a timeout
        let stream_guard =
            match tokio::time::timeout(Duration::from_millis(100), self.stream.lock()).await {
                Ok(guard) => guard,
                Err(_) => return false,
            };

        // Check if we can peek at the stream
        match stream_guard.try_read(&mut [0u8; 0]) {
            Ok(_) => true,
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => true,
            Err(_) => false,
        }
    }

    /// Reconnect to the daemon
    pub async fn reconnect(&mut self) -> Result<()> {
        let new_stream = Self::connect_to_socket(&self.socket_path).await?;
        let mut stream = self.stream.lock().await;
        *stream = new_stream;
        info!("Reconnected to daemon");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_default_socket_path() {
        let path = Connection::default_socket_path();
        assert!(path.to_string_lossy().contains(".humanlayer/daemon.sock"));
    }
}
