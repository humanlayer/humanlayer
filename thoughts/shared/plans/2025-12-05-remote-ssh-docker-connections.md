# Remote SSH & Docker Connections Implementation Plan

## Overview

Add VS Code-like remote development experience to CodeLayer, allowing users to:
- Connect to remote machines via SSH
- Connect to local Docker containers
- Automatically install and manage hld daemon on remote targets
- View and manage sessions across multiple machines in a single unified UI

## Current State Analysis

### How WUI Connects to Daemon Today
- WUI connects to a single hld daemon via HTTP REST API + SSE for real-time events
- Connection URL determined by `getDaemonUrl()` in `humanlayer-wui/src/lib/daemon/http-config.ts:9-44`
- Supports external daemon via `VITE_HUMANLAYER_DAEMON_URL` or Debug Panel
- Daemon binds to `127.0.0.1:7777` (localhost only) - `hld/config/config.go:113`

### Working Directory Picker
- `FuzzySearchInput` component uses Tauri's `readDir` API for filesystem browsing
- `QuickLauncherDirectoryInput` for quick launcher window
- Recent paths fetched from daemon via `daemonClient.getRecentPaths()`
- Tilde expansion via Tauri's `homeDir()` API

### Session Model
- Sessions have NO machine/host concept - scoped to single daemon
- Session schema in `hld/store/sqlite.go:82-125`
- UI session type in `humanlayer-wui/src/lib/daemon/types.ts`

### Key Discoveries
- Multi-daemon isolation already exists for dev branches (different sockets/databases)
- External daemon connection pattern exists via environment variables
- WUI can connect to any URL - foundation for remote connections exists

## Desired End State

After implementation:
1. Users can add SSH hosts (from `~/.ssh/config` or manual entry) and Docker containers
2. Host selector appears next to working directory picker
3. Selecting a remote host:
   - Establishes SSH tunnel (or Docker exec channel)
   - Installs hld daemon if not present (via SCP)
   - Starts remote daemon
   - Tunnels daemon port to local machine
4. Sessions display which machine they're running on
5. Multiple connections can be active simultaneously
6. All sessions (local + remotes) appear in unified session list

### Verification
- Can connect to remote SSH host and launch session
- Can connect to Docker container and launch session
- Sessions show connection indicator
- Multiple simultaneous connections work
- Reconnection works after network interruption

## What We're NOT Doing

- Remote debugging/attach (just session management)
- File sync/rsync between machines
- Remote extension installation (hld only)
- Kubernetes pod connections (Docker only for now)
- Windows remote targets (Linux/macOS only)
- Jump host / bastion host support (direct connections only)

## Implementation Approach

Build in layers:
1. Data model and storage for connections
2. SSH infrastructure in Tauri/Rust
3. Docker infrastructure in Tauri/Rust
4. Remote daemon lifecycle management
5. Multi-connection WUI architecture
6. UI integration with host selector

---

## Phase 1: Connection Data Model

### Overview
Define the connection type system and persistent storage for managing remote hosts.

### Changes Required

#### 1. Connection Types (Rust)
**File**: `humanlayer-wui/src-tauri/src/connections/types.rs` (new)

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Connection {
    Local(LocalConnection),
    SSH(SSHConnection),
    Docker(DockerConnection),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConnection {
    pub id: String,  // Always "local"
    pub name: String, // "Local Machine"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SSHConnection {
    pub id: String,  // UUID
    pub name: String, // Display name (e.g., "dev-server")
    pub host: String, // Hostname or IP
    pub port: u16,    // SSH port (default 22)
    pub user: String, // SSH username
    pub identity_file: Option<String>, // Path to private key
    pub use_ssh_config: bool, // Whether this came from ~/.ssh/config
    pub ssh_config_host: Option<String>, // Host alias from ssh config
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerConnection {
    pub id: String,  // UUID
    pub name: String, // Display name
    pub container_id: String, // Docker container ID
    pub container_name: String, // Docker container name
    pub image: String, // Image name
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionState {
    pub connection_id: String,
    pub status: ConnectionStatus,
    pub daemon_port: Option<u16>, // Local tunneled port
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Installing, // Installing hld on remote
    Starting,   // Starting remote daemon
    Connected,
    Error,
}
```

#### 2. Connection Storage
**File**: `humanlayer-wui/src-tauri/src/connections/storage.rs` (new)

```rust
use std::path::PathBuf;
use tokio::fs;
use super::types::{Connection, SSHConnection, DockerConnection};

const CONNECTIONS_FILE: &str = "connections.json";

pub struct ConnectionStorage {
    path: PathBuf,
}

impl ConnectionStorage {
    pub fn new(humanlayer_dir: &PathBuf) -> Self {
        Self {
            path: humanlayer_dir.join(CONNECTIONS_FILE),
        }
    }

    pub async fn load(&self) -> Result<Vec<Connection>, String> {
        if !self.path.exists() {
            return Ok(vec![]);
        }
        let content = fs::read_to_string(&self.path)
            .await
            .map_err(|e| format!("Failed to read connections: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse connections: {}", e))
    }

    pub async fn save(&self, connections: &[Connection]) -> Result<(), String> {
        let content = serde_json::to_string_pretty(connections)
            .map_err(|e| format!("Failed to serialize connections: {}", e))?;
        fs::write(&self.path, content)
            .await
            .map_err(|e| format!("Failed to write connections: {}", e))
    }

    pub async fn add(&self, connection: Connection) -> Result<(), String> {
        let mut connections = self.load().await?;
        connections.push(connection);
        self.save(&connections).await
    }

    pub async fn remove(&self, id: &str) -> Result<(), String> {
        let mut connections = self.load().await?;
        connections.retain(|c| match c {
            Connection::SSH(s) => s.id != id,
            Connection::Docker(d) => d.id != id,
            Connection::Local(_) => true,
        });
        self.save(&connections).await
    }
}
```

#### 3. TypeScript Types
**File**: `humanlayer-wui/src/lib/connections/types.ts` (new)

```typescript
export type ConnectionType = 'local' | 'ssh' | 'docker'

export interface LocalConnection {
  type: 'local'
  id: 'local'
  name: string
}

export interface SSHConnection {
  type: 'ssh'
  id: string
  name: string
  host: string
  port: number
  user: string
  identityFile?: string
  useSshConfig: boolean
  sshConfigHost?: string
}

export interface DockerConnection {
  type: 'docker'
  id: string
  name: string
  containerId: string
  containerName: string
  image: string
}

export type Connection = LocalConnection | SSHConnection | DockerConnection

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'installing'
  | 'starting'
  | 'connected'
  | 'error'

export interface ConnectionState {
  connectionId: string
  status: ConnectionStatus
  daemonPort?: number
  error?: string
}
```

### Success Criteria

#### Automated Verification:
- [ ] Rust types compile: `cd humanlayer-wui && cargo check`
- [ ] TypeScript types compile: `cd humanlayer-wui && bun run typecheck`

#### Manual Verification:
- [ ] N/A - no UI yet

---

## Phase 2: SSH Infrastructure (Tauri/Rust)

### Overview
Implement SSH connection management using the `russh` crate for pure-Rust async SSH.

### Changes Required

#### 1. Add Dependencies
**File**: `humanlayer-wui/src-tauri/Cargo.toml`

Add to `[dependencies]`:
```toml
russh = "0.44"
russh-keys = "0.44"
ssh-config = "0.2"
async-trait = "0.1"
```

#### 2. SSH Config Parser
**File**: `humanlayer-wui/src-tauri/src/connections/ssh_config.rs` (new)

```rust
use ssh_config::SSHConfig;
use std::path::PathBuf;
use dirs::home_dir;

pub struct SSHConfigParser;

impl SSHConfigParser {
    pub fn parse() -> Result<Vec<SSHHostConfig>, String> {
        let config_path = home_dir()
            .ok_or("Cannot find home directory")?
            .join(".ssh")
            .join("config");

        if !config_path.exists() {
            return Ok(vec![]);
        }

        let content = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read SSH config: {}", e))?;

        let config = SSHConfig::parse_str(&content)
            .map_err(|e| format!("Failed to parse SSH config: {}", e))?;

        let mut hosts = vec![];
        for host in config.hosts() {
            // Skip wildcard patterns
            if host.pattern.contains('*') || host.pattern.contains('?') {
                continue;
            }

            hosts.push(SSHHostConfig {
                name: host.pattern.clone(),
                hostname: host.get("HostName").map(|s| s.to_string()),
                user: host.get("User").map(|s| s.to_string()),
                port: host.get("Port").and_then(|s| s.parse().ok()),
                identity_file: host.get("IdentityFile").map(|s| s.to_string()),
            });
        }

        Ok(hosts)
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SSHHostConfig {
    pub name: String,
    pub hostname: Option<String>,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub identity_file: Option<String>,
}
```

#### 3. SSH Client Implementation
**File**: `humanlayer-wui/src-tauri/src/connections/ssh_client.rs` (new)

```rust
use russh::*;
use russh_keys::*;
use std::sync::Arc;
use tokio::net::TcpStream;
use std::path::PathBuf;

pub struct SSHClient {
    session: Option<client::Handle<ClientHandler>>,
    config: SSHClientConfig,
}

pub struct SSHClientConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub identity_file: Option<PathBuf>,
    pub password: Option<String>,
}

struct ClientHandler;

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // TODO: Implement proper host key verification
        // For now, accept all (like StrictHostKeyChecking=no)
        Ok(true)
    }
}

impl SSHClient {
    pub fn new(config: SSHClientConfig) -> Self {
        Self {
            session: None,
            config,
        }
    }

    pub async fn connect(&mut self) -> Result<(), String> {
        let russh_config = client::Config::default();
        let russh_config = Arc::new(russh_config);

        let addr = format!("{}:{}", self.config.host, self.config.port);
        let stream = TcpStream::connect(&addr)
            .await
            .map_err(|e| format!("Failed to connect to {}: {}", addr, e))?;

        let handler = ClientHandler;
        let (handle, _) = client::connect_stream(russh_config, stream, handler)
            .await
            .map_err(|e| format!("SSH handshake failed: {}", e))?;

        // Try key-based auth first
        if let Some(identity_file) = &self.config.identity_file {
            let key = load_secret_key(identity_file, None)
                .map_err(|e| format!("Failed to load key: {}", e))?;

            let auth_result = handle
                .authenticate_publickey(&self.config.user, Arc::new(key))
                .await
                .map_err(|e| format!("Key auth failed: {}", e))?;

            if auth_result {
                self.session = Some(handle);
                return Ok(());
            }
        }

        // Try SSH agent
        if let Ok(mut agent) = russh_keys::agent::client::AgentClient::connect_env().await {
            let identities = agent.request_identities().await.unwrap_or_default();
            for identity in identities {
                let auth_result = handle
                    .authenticate_publickey_with(&self.config.user, &identity, &mut agent)
                    .await;
                if auth_result.is_ok() {
                    self.session = Some(handle);
                    return Ok(());
                }
            }
        }

        // Try password if provided
        if let Some(password) = &self.config.password {
            let auth_result = handle
                .authenticate_password(&self.config.user, password)
                .await
                .map_err(|e| format!("Password auth failed: {}", e))?;

            if auth_result {
                self.session = Some(handle);
                return Ok(());
            }
        }

        Err("All authentication methods failed".to_string())
    }

    pub async fn exec(&self, command: &str) -> Result<String, String> {
        let session = self.session.as_ref().ok_or("Not connected")?;
        let mut channel = session
            .channel_open_session()
            .await
            .map_err(|e| format!("Failed to open channel: {}", e))?;

        channel
            .exec(true, command)
            .await
            .map_err(|e| format!("Failed to execute command: {}", e))?;

        let mut output = Vec::new();
        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    output.extend_from_slice(&data);
                }
                Some(ChannelMsg::Eof) | None => break,
                _ => {}
            }
        }

        String::from_utf8(output)
            .map_err(|e| format!("Invalid UTF-8 output: {}", e))
    }

    pub async fn upload_file(&self, local_path: &PathBuf, remote_path: &str) -> Result<(), String> {
        let session = self.session.as_ref().ok_or("Not connected")?;
        let content = tokio::fs::read(local_path)
            .await
            .map_err(|e| format!("Failed to read local file: {}", e))?;

        let mut channel = session
            .channel_open_session()
            .await
            .map_err(|e| format!("Failed to open channel: {}", e))?;

        // Use SCP protocol
        let file_size = content.len();
        let filename = std::path::Path::new(remote_path)
            .file_name()
            .ok_or("Invalid remote path")?
            .to_str()
            .ok_or("Invalid filename")?;
        let dir = std::path::Path::new(remote_path)
            .parent()
            .map(|p| p.to_str().unwrap_or("."))
            .unwrap_or(".");

        channel
            .exec(true, format!("scp -t {}", dir))
            .await
            .map_err(|e| format!("SCP exec failed: {}", e))?;

        // Send file header
        let header = format!("C0755 {} {}\n", file_size, filename);
        channel.data(header.as_bytes()).await.map_err(|e| format!("SCP header failed: {}", e))?;

        // Send content
        channel.data(&content).await.map_err(|e| format!("SCP data failed: {}", e))?;

        // Send EOF
        channel.data(&[0u8]).await.map_err(|e| format!("SCP EOF failed: {}", e))?;

        channel.eof().await.map_err(|e| format!("Channel EOF failed: {}", e))?;

        Ok(())
    }

    pub async fn forward_port(&self, remote_port: u16) -> Result<u16, String> {
        let session = self.session.as_ref().ok_or("Not connected")?;

        // Request port forwarding from remote to local
        // Bind to random local port (0)
        let local_listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind local port: {}", e))?;

        let local_port = local_listener.local_addr()
            .map_err(|e| format!("Failed to get local address: {}", e))?
            .port();

        // Spawn forwarding task
        let session_clone = session.clone();
        let remote_host = self.config.host.clone();
        tokio::spawn(async move {
            loop {
                if let Ok((local_stream, _)) = local_listener.accept().await {
                    let session = session_clone.clone();
                    let host = remote_host.clone();
                    tokio::spawn(async move {
                        if let Ok(channel) = session.channel_open_direct_tcpip(
                            "127.0.0.1", remote_port as u32,
                            &host, local_port as u32
                        ).await {
                            // Forward data between local_stream and channel
                            let _ = forward_traffic(local_stream, channel).await;
                        }
                    });
                }
            }
        });

        Ok(local_port)
    }

    pub async fn disconnect(&mut self) -> Result<(), String> {
        if let Some(session) = self.session.take() {
            session
                .disconnect(Disconnect::ByApplication, "User disconnect", "")
                .await
                .map_err(|e| format!("Disconnect failed: {}", e))?;
        }
        Ok(())
    }
}

async fn forward_traffic(
    mut local: tokio::net::TcpStream,
    mut channel: client::Channel<ClientHandler>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let (mut local_read, mut local_write) = local.split();

    loop {
        tokio::select! {
            // Local to remote
            result = async {
                let mut buf = [0u8; 8192];
                local_read.read(&mut buf).await
            } => {
                match result {
                    Ok(0) => break,
                    Ok(n) => channel.data(&buf[..n]).await?,
                    Err(_) => break,
                }
            }
            // Remote to local
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => {
                        local_write.write_all(&data).await?;
                    }
                    Some(ChannelMsg::Eof) | None => break,
                    _ => {}
                }
            }
        }
    }

    Ok(())
}
```

#### 4. Tauri Commands for SSH
**File**: `humanlayer-wui/src-tauri/src/connections/commands.rs` (new)

```rust
use tauri::State;
use super::ssh_config::SSHConfigParser;
use super::storage::ConnectionStorage;
use super::types::*;

#[tauri::command]
pub async fn get_ssh_config_hosts() -> Result<Vec<super::ssh_config::SSHHostConfig>, String> {
    SSHConfigParser::parse()
}

#[tauri::command]
pub async fn list_connections(
    storage: State<'_, ConnectionStorage>,
) -> Result<Vec<Connection>, String> {
    storage.load().await
}

#[tauri::command]
pub async fn add_ssh_connection(
    storage: State<'_, ConnectionStorage>,
    name: String,
    host: String,
    port: u16,
    user: String,
    identity_file: Option<String>,
    use_ssh_config: bool,
    ssh_config_host: Option<String>,
) -> Result<Connection, String> {
    let connection = Connection::SSH(SSHConnection {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        host,
        port,
        user,
        identity_file,
        use_ssh_config,
        ssh_config_host,
    });
    storage.add(connection.clone()).await?;
    Ok(connection)
}

#[tauri::command]
pub async fn remove_connection(
    storage: State<'_, ConnectionStorage>,
    id: String,
) -> Result<(), String> {
    storage.remove(&id).await
}

#[tauri::command]
pub async fn test_ssh_connection(
    host: String,
    port: u16,
    user: String,
    identity_file: Option<String>,
) -> Result<(), String> {
    let config = super::ssh_client::SSHClientConfig {
        host,
        port,
        user,
        identity_file: identity_file.map(std::path::PathBuf::from),
        password: None,
    };

    let mut client = super::ssh_client::SSHClient::new(config);
    client.connect().await?;

    // Test with simple command
    let output = client.exec("echo 'SSH connection test successful'").await?;
    log::info!("SSH test output: {}", output);

    client.disconnect().await?;
    Ok(())
}
```

### Success Criteria

#### Automated Verification:
- [ ] Rust compiles with new dependencies: `cd humanlayer-wui && cargo check`
- [ ] SSH config parsing works: unit test for `SSHConfigParser::parse()`

#### Manual Verification:
- [ ] Can parse `~/.ssh/config` and list hosts
- [ ] Can establish SSH connection to test server
- [ ] SSH agent authentication works
- [ ] Key-based authentication works
- [ ] Port forwarding establishes tunnel

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the SSH connection testing was successful before proceeding.

---

## Phase 3: Docker Infrastructure (Tauri/Rust)

### Overview
Implement Docker container connection support using the Docker CLI (wrapping `docker` command).

### Changes Required

#### 1. Docker Client Implementation
**File**: `humanlayer-wui/src-tauri/src/connections/docker_client.rs` (new)

```rust
use tokio::process::Command;
use serde::Deserialize;

pub struct DockerClient;

#[derive(Debug, Deserialize)]
pub struct DockerContainer {
    #[serde(rename = "ID")]
    pub id: String,
    #[serde(rename = "Names")]
    pub names: String,
    #[serde(rename = "Image")]
    pub image: String,
    #[serde(rename = "State")]
    pub state: String,
    #[serde(rename = "Status")]
    pub status: String,
}

impl DockerClient {
    pub async fn list_containers() -> Result<Vec<DockerContainer>, String> {
        let output = Command::new("docker")
            .args(["ps", "--format", "json", "-a"])
            .output()
            .await
            .map_err(|e| format!("Failed to run docker: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Docker command failed: {}", stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut containers = vec![];

        for line in stdout.lines() {
            if line.trim().is_empty() {
                continue;
            }
            let container: DockerContainer = serde_json::from_str(line)
                .map_err(|e| format!("Failed to parse docker output: {}", e))?;
            containers.push(container);
        }

        Ok(containers)
    }

    pub async fn exec(container_id: &str, command: &str) -> Result<String, String> {
        let output = Command::new("docker")
            .args(["exec", container_id, "sh", "-c", command])
            .output()
            .await
            .map_err(|e| format!("Docker exec failed: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Command failed: {}", stderr));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    pub async fn copy_to_container(
        container_id: &str,
        local_path: &str,
        remote_path: &str,
    ) -> Result<(), String> {
        let output = Command::new("docker")
            .args(["cp", local_path, &format!("{}:{}", container_id, remote_path)])
            .output()
            .await
            .map_err(|e| format!("Docker cp failed: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Copy failed: {}", stderr));
        }

        Ok(())
    }

    pub async fn read_dir(container_id: &str, path: &str) -> Result<Vec<DirEntry>, String> {
        // Use ls with specific format for parsing
        let output = Self::exec(
            container_id,
            &format!("ls -1F {} 2>/dev/null || echo ''", path),
        ).await?;

        let mut entries = vec![];
        for line in output.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            let is_dir = line.ends_with('/');
            let name = if is_dir {
                line.trim_end_matches('/')
            } else {
                line
            };

            entries.push(DirEntry {
                name: name.to_string(),
                is_directory: is_dir,
            });
        }

        Ok(entries)
    }

    pub async fn home_dir(container_id: &str) -> Result<String, String> {
        let output = Self::exec(container_id, "echo $HOME").await?;
        Ok(output.trim().to_string())
    }

    /// Start a daemon port forwarder using docker exec + socat
    pub async fn forward_port(container_id: &str, container_port: u16) -> Result<u16, String> {
        // Bind to random local port
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind local port: {}", e))?;

        let local_port = listener.local_addr()
            .map_err(|e| format!("Failed to get local address: {}", e))?
            .port();

        let container_id = container_id.to_string();

        // Spawn forwarding task
        tokio::spawn(async move {
            loop {
                if let Ok((mut local_stream, _)) = listener.accept().await {
                    let container = container_id.clone();
                    tokio::spawn(async move {
                        use tokio::io::{AsyncReadExt, AsyncWriteExt};

                        // Use docker exec with socat or nc to forward
                        let mut child = tokio::process::Command::new("docker")
                            .args([
                                "exec", "-i", &container,
                                "socat", "-", &format!("TCP:127.0.0.1:{}", container_port),
                            ])
                            .stdin(std::process::Stdio::piped())
                            .stdout(std::process::Stdio::piped())
                            .spawn()
                            .expect("Failed to spawn docker exec");

                        let mut stdin = child.stdin.take().unwrap();
                        let mut stdout = child.stdout.take().unwrap();

                        let (mut local_read, mut local_write) = local_stream.split();

                        tokio::select! {
                            _ = tokio::io::copy(&mut local_read, &mut stdin) => {}
                            _ = tokio::io::copy(&mut stdout, &mut local_write) => {}
                        }
                    });
                }
            }
        });

        Ok(local_port)
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DirEntry {
    pub name: String,
    pub is_directory: bool,
}
```

#### 2. Docker Tauri Commands
**File**: `humanlayer-wui/src-tauri/src/connections/commands.rs` (append)

```rust
use super::docker_client::DockerClient;

#[tauri::command]
pub async fn list_docker_containers() -> Result<Vec<super::docker_client::DockerContainer>, String> {
    DockerClient::list_containers().await
}

#[tauri::command]
pub async fn add_docker_connection(
    storage: State<'_, ConnectionStorage>,
    container_id: String,
    container_name: String,
    image: String,
) -> Result<Connection, String> {
    let connection = Connection::Docker(DockerConnection {
        id: uuid::Uuid::new_v4().to_string(),
        name: container_name.clone(),
        container_id,
        container_name,
        image,
    });
    storage.add(connection.clone()).await?;
    Ok(connection)
}

#[tauri::command]
pub async fn docker_read_dir(
    container_id: String,
    path: String,
) -> Result<Vec<super::docker_client::DirEntry>, String> {
    DockerClient::read_dir(&container_id, &path).await
}

#[tauri::command]
pub async fn docker_home_dir(container_id: String) -> Result<String, String> {
    DockerClient::home_dir(&container_id).await
}
```

### Success Criteria

#### Automated Verification:
- [ ] Rust compiles: `cd humanlayer-wui && cargo check`

#### Manual Verification:
- [ ] Can list running Docker containers
- [ ] Can execute commands in container
- [ ] Can browse filesystem in container
- [ ] Port forwarding works (requires socat in container)

**Implementation Note**: After completing this phase, pause for manual Docker testing confirmation.

---

## Phase 4: Remote Daemon Lifecycle

### Overview
Implement automatic hld installation and lifecycle management on remote targets.

### Changes Required

#### 1. Remote Daemon Manager
**File**: `humanlayer-wui/src-tauri/src/connections/remote_daemon.rs` (new)

```rust
use std::path::PathBuf;
use super::ssh_client::SSHClient;
use super::docker_client::DockerClient;
use super::types::*;

pub struct RemoteDaemonManager {
    local_hld_path: PathBuf,
}

impl RemoteDaemonManager {
    pub fn new(app_handle: &tauri::AppHandle) -> Self {
        // Get path to bundled hld binary
        let resource_path = app_handle
            .path()
            .resource_dir()
            .expect("Failed to get resource dir");

        Self {
            local_hld_path: resource_path.join("hld"),
        }
    }

    pub async fn ensure_daemon_running_ssh(
        &self,
        client: &SSHClient,
    ) -> Result<u16, String> {
        // Check if hld is installed and get version
        let remote_version = match client.exec("~/.humanlayer/bin/hld --version 2>/dev/null").await {
            Ok(v) => Some(v.trim().to_string()),
            Err(_) => None,
        };

        let local_version = self.get_local_version()?;

        // Install if not present or version mismatch
        if remote_version.as_ref() != Some(&local_version) {
            log::info!("Installing hld on remote (local: {}, remote: {:?})", local_version, remote_version);
            self.install_hld_ssh(client).await?;
        }

        // Check if daemon already running
        let pid_check = client.exec("pgrep -f 'hld daemon' 2>/dev/null || echo ''").await?;
        if !pid_check.trim().is_empty() {
            // Daemon running, get its port
            let port = client.exec("cat ~/.humanlayer/daemon.port 2>/dev/null || echo '7777'").await?;
            return port.trim().parse().map_err(|e| format!("Invalid port: {}", e));
        }

        // Start daemon
        let port = self.start_daemon_ssh(client).await?;
        Ok(port)
    }

    pub async fn ensure_daemon_running_docker(
        &self,
        container_id: &str,
    ) -> Result<u16, String> {
        // Check if hld is installed
        let remote_version = match DockerClient::exec(container_id, "~/.humanlayer/bin/hld --version 2>/dev/null").await {
            Ok(v) => Some(v.trim().to_string()),
            Err(_) => None,
        };

        let local_version = self.get_local_version()?;

        if remote_version.as_ref() != Some(&local_version) {
            log::info!("Installing hld in container (local: {}, remote: {:?})", local_version, remote_version);
            self.install_hld_docker(container_id).await?;
        }

        // Check if daemon already running
        let pid_check = DockerClient::exec(container_id, "pgrep -f 'hld daemon' 2>/dev/null || echo ''").await?;
        if !pid_check.trim().is_empty() {
            let port = DockerClient::exec(container_id, "cat ~/.humanlayer/daemon.port 2>/dev/null || echo '7777'").await?;
            return port.trim().parse().map_err(|e| format!("Invalid port: {}", e));
        }

        // Start daemon
        let port = self.start_daemon_docker(container_id).await?;
        Ok(port)
    }

    fn get_local_version(&self) -> Result<String, String> {
        let output = std::process::Command::new(&self.local_hld_path)
            .arg("--version")
            .output()
            .map_err(|e| format!("Failed to get local hld version: {}", e))?;

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    async fn install_hld_ssh(&self, client: &SSHClient) -> Result<(), String> {
        // Create directory
        client.exec("mkdir -p ~/.humanlayer/bin").await?;

        // Upload binary
        client.upload_file(&self.local_hld_path, "~/.humanlayer/bin/hld").await?;

        // Make executable
        client.exec("chmod +x ~/.humanlayer/bin/hld").await?;

        Ok(())
    }

    async fn install_hld_docker(&self, container_id: &str) -> Result<(), String> {
        // Create directory
        DockerClient::exec(container_id, "mkdir -p ~/.humanlayer/bin").await?;

        // Copy binary
        DockerClient::copy_to_container(
            container_id,
            self.local_hld_path.to_str().unwrap(),
            "/root/.humanlayer/bin/hld",
        ).await?;

        // Make executable
        DockerClient::exec(container_id, "chmod +x ~/.humanlayer/bin/hld").await?;

        Ok(())
    }

    async fn start_daemon_ssh(&self, client: &SSHClient) -> Result<u16, String> {
        // Start daemon with port 0 (dynamic allocation)
        let output = client.exec(
            "cd ~ && nohup ~/.humanlayer/bin/hld daemon --http-port 0 > ~/.humanlayer/daemon.log 2>&1 & \
             sleep 1 && head -1 ~/.humanlayer/daemon.log | grep -oP 'HTTP_PORT=\\K[0-9]+'"
        ).await?;

        let port: u16 = output.trim().parse()
            .map_err(|e| format!("Failed to parse daemon port: {}", e))?;

        // Save port for future reference
        client.exec(&format!("echo {} > ~/.humanlayer/daemon.port", port)).await?;

        Ok(port)
    }

    async fn start_daemon_docker(&self, container_id: &str) -> Result<u16, String> {
        let output = DockerClient::exec(
            container_id,
            "cd ~ && nohup ~/.humanlayer/bin/hld daemon --http-port 0 > ~/.humanlayer/daemon.log 2>&1 & \
             sleep 1 && head -1 ~/.humanlayer/daemon.log | grep -oP 'HTTP_PORT=\\K[0-9]+'"
        ).await?;

        let port: u16 = output.trim().parse()
            .map_err(|e| format!("Failed to parse daemon port: {}", e))?;

        DockerClient::exec(container_id, &format!("echo {} > ~/.humanlayer/daemon.port", port)).await?;

        Ok(port)
    }

    pub async fn stop_daemon_ssh(&self, client: &SSHClient) -> Result<(), String> {
        client.exec("pkill -f 'hld daemon' || true").await?;
        Ok(())
    }

    pub async fn stop_daemon_docker(&self, container_id: &str) -> Result<(), String> {
        DockerClient::exec(container_id, "pkill -f 'hld daemon' || true").await?;
        Ok(())
    }
}
```

#### 2. Connection Manager (Orchestrator)
**File**: `humanlayer-wui/src-tauri/src/connections/manager.rs` (new)

```rust
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use super::types::*;
use super::ssh_client::{SSHClient, SSHClientConfig};
use super::docker_client::DockerClient;
use super::remote_daemon::RemoteDaemonManager;

pub struct ConnectionManager {
    connections: Arc<RwLock<HashMap<String, ActiveConnection>>>,
    daemon_manager: RemoteDaemonManager,
}

struct ActiveConnection {
    connection: Connection,
    state: ConnectionState,
    ssh_client: Option<SSHClient>,
    local_port: Option<u16>,
}

impl ConnectionManager {
    pub fn new(app_handle: &tauri::AppHandle) -> Self {
        Self {
            connections: Arc::new(RwLock::new(HashMap::new())),
            daemon_manager: RemoteDaemonManager::new(app_handle),
        }
    }

    pub async fn connect(&self, connection: Connection) -> Result<ConnectionState, String> {
        let id = match &connection {
            Connection::Local(c) => c.id.clone(),
            Connection::SSH(c) => c.id.clone(),
            Connection::Docker(c) => c.id.clone(),
        };

        // Update state to connecting
        self.update_state(&id, ConnectionStatus::Connecting, None, None).await;

        match &connection {
            Connection::Local(_) => {
                // Local is always "connected" - daemon managed by existing logic
                self.update_state(&id, ConnectionStatus::Connected, Some(7777), None).await;
            }
            Connection::SSH(ssh) => {
                self.connect_ssh(ssh.clone()).await?;
            }
            Connection::Docker(docker) => {
                self.connect_docker(docker.clone()).await?;
            }
        }

        let connections = self.connections.read().await;
        Ok(connections.get(&id).map(|c| c.state.clone()).unwrap_or(ConnectionState {
            connection_id: id,
            status: ConnectionStatus::Disconnected,
            daemon_port: None,
            error: None,
        }))
    }

    async fn connect_ssh(&self, ssh: SSHConnection) -> Result<(), String> {
        let id = ssh.id.clone();

        // Create SSH client
        let config = SSHClientConfig {
            host: ssh.host.clone(),
            port: ssh.port,
            user: ssh.user.clone(),
            identity_file: ssh.identity_file.as_ref().map(std::path::PathBuf::from),
            password: None,
        };

        let mut client = SSHClient::new(config);

        // Connect
        client.connect().await.map_err(|e| {
            let _ = futures::executor::block_on(
                self.update_state(&id, ConnectionStatus::Error, None, Some(e.clone()))
            );
            e
        })?;

        // Install/start daemon
        self.update_state(&id, ConnectionStatus::Installing, None, None).await;
        let remote_port = self.daemon_manager.ensure_daemon_running_ssh(&client).await.map_err(|e| {
            let _ = futures::executor::block_on(
                self.update_state(&id, ConnectionStatus::Error, None, Some(e.clone()))
            );
            e
        })?;

        // Set up port forwarding
        self.update_state(&id, ConnectionStatus::Starting, None, None).await;
        let local_port = client.forward_port(remote_port).await.map_err(|e| {
            let _ = futures::executor::block_on(
                self.update_state(&id, ConnectionStatus::Error, None, Some(e.clone()))
            );
            e
        })?;

        // Store connection
        let mut connections = self.connections.write().await;
        connections.insert(id.clone(), ActiveConnection {
            connection: Connection::SSH(ssh),
            state: ConnectionState {
                connection_id: id.clone(),
                status: ConnectionStatus::Connected,
                daemon_port: Some(local_port),
                error: None,
            },
            ssh_client: Some(client),
            local_port: Some(local_port),
        });

        Ok(())
    }

    async fn connect_docker(&self, docker: DockerConnection) -> Result<(), String> {
        let id = docker.id.clone();

        // Install/start daemon
        self.update_state(&id, ConnectionStatus::Installing, None, None).await;
        let container_port = self.daemon_manager.ensure_daemon_running_docker(&docker.container_id).await.map_err(|e| {
            let _ = futures::executor::block_on(
                self.update_state(&id, ConnectionStatus::Error, None, Some(e.clone()))
            );
            e
        })?;

        // Set up port forwarding
        self.update_state(&id, ConnectionStatus::Starting, None, None).await;
        let local_port = DockerClient::forward_port(&docker.container_id, container_port).await.map_err(|e| {
            let _ = futures::executor::block_on(
                self.update_state(&id, ConnectionStatus::Error, None, Some(e.clone()))
            );
            e
        })?;

        // Store connection
        let mut connections = self.connections.write().await;
        connections.insert(id.clone(), ActiveConnection {
            connection: Connection::Docker(docker),
            state: ConnectionState {
                connection_id: id.clone(),
                status: ConnectionStatus::Connected,
                daemon_port: Some(local_port),
                error: None,
            },
            ssh_client: None,
            local_port: Some(local_port),
        });

        Ok(())
    }

    pub async fn disconnect(&self, id: &str) -> Result<(), String> {
        let mut connections = self.connections.write().await;
        if let Some(mut active) = connections.remove(id) {
            if let Some(mut client) = active.ssh_client.take() {
                client.disconnect().await?;
            }
            // Docker connections don't need explicit disconnect
        }
        Ok(())
    }

    pub async fn get_state(&self, id: &str) -> Option<ConnectionState> {
        let connections = self.connections.read().await;
        connections.get(id).map(|c| c.state.clone())
    }

    pub async fn get_all_states(&self) -> Vec<ConnectionState> {
        let connections = self.connections.read().await;
        connections.values().map(|c| c.state.clone()).collect()
    }

    async fn update_state(
        &self,
        id: &str,
        status: ConnectionStatus,
        port: Option<u16>,
        error: Option<String>,
    ) {
        let mut connections = self.connections.write().await;
        if let Some(active) = connections.get_mut(id) {
            active.state.status = status;
            if port.is_some() {
                active.state.daemon_port = port;
            }
            active.state.error = error;
        }
    }
}
```

#### 3. Tauri Command Integration
**File**: `humanlayer-wui/src-tauri/src/connections/commands.rs` (append)

```rust
use super::manager::ConnectionManager;

#[tauri::command]
pub async fn connect_to_remote(
    manager: State<'_, ConnectionManager>,
    connection: Connection,
) -> Result<ConnectionState, String> {
    manager.connect(connection).await
}

#[tauri::command]
pub async fn disconnect_from_remote(
    manager: State<'_, ConnectionManager>,
    id: String,
) -> Result<(), String> {
    manager.disconnect(&id).await
}

#[tauri::command]
pub async fn get_connection_state(
    manager: State<'_, ConnectionManager>,
    id: String,
) -> Result<Option<ConnectionState>, String> {
    Ok(manager.get_state(&id).await)
}

#[tauri::command]
pub async fn get_all_connection_states(
    manager: State<'_, ConnectionManager>,
) -> Result<Vec<ConnectionState>, String> {
    Ok(manager.get_all_states().await)
}
```

### Success Criteria

#### Automated Verification:
- [ ] Rust compiles: `cd humanlayer-wui && cargo check`

#### Manual Verification:
- [ ] hld binary transfers to remote via SSH
- [ ] hld binary copies to Docker container
- [ ] Remote daemon starts and port is captured
- [ ] Port forwarding allows local access to remote daemon
- [ ] Health check via tunneled port succeeds

**Implementation Note**: After completing this phase, pause for comprehensive remote daemon testing.

---

## Phase 5: Multi-Connection WUI Architecture

### Overview
Modify the WUI to support multiple simultaneous daemon connections with aggregated session views.

### Changes Required

#### 1. Connection Store
**File**: `humanlayer-wui/src/stores/connectionStore.ts` (new)

```typescript
import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import type { Connection, ConnectionState } from '../lib/connections/types'

interface ConnectionStore {
  connections: Connection[]
  connectionStates: Map<string, ConnectionState>
  activeConnectionId: string // 'local' by default

  // Actions
  loadConnections: () => Promise<void>
  addSSHConnection: (params: {
    name: string
    host: string
    port: number
    user: string
    identityFile?: string
    useSshConfig: boolean
    sshConfigHost?: string
  }) => Promise<Connection>
  addDockerConnection: (params: {
    containerId: string
    containerName: string
    image: string
  }) => Promise<Connection>
  removeConnection: (id: string) => Promise<void>

  connect: (connection: Connection) => Promise<void>
  disconnect: (id: string) => Promise<void>
  setActiveConnection: (id: string) => void

  getSSHConfigHosts: () => Promise<SSHHostConfig[]>
  getDockerContainers: () => Promise<DockerContainer[]>
}

export interface SSHHostConfig {
  name: string
  hostname?: string
  user?: string
  port?: number
  identityFile?: string
}

export interface DockerContainer {
  id: string
  names: string
  image: string
  state: string
  status: string
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  connections: [
    { type: 'local', id: 'local', name: 'Local Machine' }
  ],
  connectionStates: new Map([
    ['local', { connectionId: 'local', status: 'connected', daemonPort: 7777 }]
  ]),
  activeConnectionId: 'local',

  loadConnections: async () => {
    const connections = await invoke<Connection[]>('list_connections')
    set({ connections: [
      { type: 'local', id: 'local', name: 'Local Machine' },
      ...connections
    ]})
  },

  addSSHConnection: async (params) => {
    const connection = await invoke<Connection>('add_ssh_connection', params)
    set(state => ({
      connections: [...state.connections, connection]
    }))
    return connection
  },

  addDockerConnection: async (params) => {
    const connection = await invoke<Connection>('add_docker_connection', params)
    set(state => ({
      connections: [...state.connections, connection]
    }))
    return connection
  },

  removeConnection: async (id) => {
    await invoke('remove_connection', { id })
    set(state => ({
      connections: state.connections.filter(c =>
        (c.type === 'local' ? c.id : c.id) !== id
      )
    }))
  },

  connect: async (connection) => {
    const id = connection.type === 'local' ? 'local' : connection.id

    // Update state to connecting
    set(state => {
      const newStates = new Map(state.connectionStates)
      newStates.set(id, { connectionId: id, status: 'connecting' })
      return { connectionStates: newStates }
    })

    try {
      const result = await invoke<ConnectionState>('connect_to_remote', { connection })
      set(state => {
        const newStates = new Map(state.connectionStates)
        newStates.set(id, result)
        return { connectionStates: newStates }
      })
    } catch (error) {
      set(state => {
        const newStates = new Map(state.connectionStates)
        newStates.set(id, {
          connectionId: id,
          status: 'error',
          error: String(error)
        })
        return { connectionStates: newStates }
      })
      throw error
    }
  },

  disconnect: async (id) => {
    await invoke('disconnect_from_remote', { id })
    set(state => {
      const newStates = new Map(state.connectionStates)
      newStates.set(id, { connectionId: id, status: 'disconnected' })
      return { connectionStates: newStates }
    })
  },

  setActiveConnection: (id) => {
    set({ activeConnectionId: id })
  },

  getSSHConfigHosts: async () => {
    return invoke<SSHHostConfig[]>('get_ssh_config_hosts')
  },

  getDockerContainers: async () => {
    return invoke<DockerContainer[]>('list_docker_containers')
  },
}))
```

#### 2. Multi-Daemon Client Manager
**File**: `humanlayer-wui/src/lib/daemon/multi-client.ts` (new)

```typescript
import { HTTPDaemonClient } from './http-client'
import type { Session, Approval } from './types'
import type { ConnectionState } from '../connections/types'

export interface AggregatedSession extends Session {
  connectionId: string
  connectionName: string
}

export class MultiDaemonClient {
  private clients: Map<string, HTTPDaemonClient> = new Map()
  private connectionNames: Map<string, string> = new Map()

  async addConnection(
    connectionId: string,
    connectionName: string,
    daemonPort: number
  ): Promise<void> {
    const url = `http://localhost:${daemonPort}`
    const client = new HTTPDaemonClient()
    await client.connect(url)
    this.clients.set(connectionId, client)
    this.connectionNames.set(connectionId, connectionName)
  }

  removeConnection(connectionId: string): void {
    const client = this.clients.get(connectionId)
    if (client) {
      client.disconnect()
      this.clients.delete(connectionId)
      this.connectionNames.delete(connectionId)
    }
  }

  async getSessionLeaves(filter?: string): Promise<AggregatedSession[]> {
    const results: AggregatedSession[] = []

    const promises = Array.from(this.clients.entries()).map(
      async ([connectionId, client]) => {
        try {
          const sessions = await client.getSessionLeaves({ filter })
          return sessions.map(session => ({
            ...session,
            connectionId,
            connectionName: this.connectionNames.get(connectionId) || connectionId,
          }))
        } catch (error) {
          console.error(`Failed to get sessions from ${connectionId}:`, error)
          return []
        }
      }
    )

    const sessionArrays = await Promise.all(promises)
    for (const sessions of sessionArrays) {
      results.push(...sessions)
    }

    // Sort by lastActivityAt descending
    results.sort((a, b) =>
      new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
    )

    return results
  }

  async launchSession(
    connectionId: string,
    params: Parameters<HTTPDaemonClient['launchSession']>[0]
  ): Promise<Session> {
    const client = this.clients.get(connectionId)
    if (!client) {
      throw new Error(`Connection ${connectionId} not found`)
    }
    return client.launchSession(params)
  }

  getClient(connectionId: string): HTTPDaemonClient | undefined {
    return this.clients.get(connectionId)
  }

  subscribeToAllEvents(
    handlers: {
      onSessionUpdate?: (session: AggregatedSession) => void
      onApproval?: (approval: Approval & { connectionId: string }) => void
    }
  ): () => void {
    const unsubscribes: (() => void)[] = []

    for (const [connectionId, client] of this.clients) {
      const unsub = client.subscribeToEvents({
        onMessage: (event) => {
          if (event.type === 'session_status_changed' && handlers.onSessionUpdate) {
            handlers.onSessionUpdate({
              ...event.session,
              connectionId,
              connectionName: this.connectionNames.get(connectionId) || connectionId,
            })
          }
          if (event.type === 'new_approval' && handlers.onApproval) {
            handlers.onApproval({
              ...event.approval,
              connectionId,
            })
          }
        },
      })
      unsubscribes.push(unsub)
    }

    return () => {
      for (const unsub of unsubscribes) {
        unsub()
      }
    }
  }
}

// Singleton instance
export const multiDaemonClient = new MultiDaemonClient()
```

#### 3. Update AppStore for Multi-Connection
**File**: `humanlayer-wui/src/AppStore.ts`

Add connection awareness to session handling:

```typescript
// Add to StoreState interface
connectionId: string | null  // Currently viewing sessions from this connection, null = all

// Update refreshSessions to use multiDaemonClient
// Update session display to show connectionName
```

### Success Criteria

#### Automated Verification:
- [ ] TypeScript compiles: `make -C humanlayer-wui check`
- [ ] Connection store tests pass

#### Manual Verification:
- [ ] Can add/remove connections in store
- [ ] Multi-client aggregates sessions from multiple daemons
- [ ] SSE subscriptions work across connections

**Implementation Note**: Pause for multi-connection testing before proceeding to UI.

---

## Phase 6: UI Integration

### Overview
Add host selector to working directory picker and connection management UI.

### Changes Required

#### 1. Host Selector Component
**File**: `humanlayer-wui/src/components/HostSelector.tsx` (new)

```typescript
import { useState } from 'react'
import { Monitor, Server, Container, Plus, Check, Loader2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Button } from './ui/button'
import { useConnectionStore } from '../stores/connectionStore'
import type { Connection, ConnectionStatus } from '../lib/connections/types'
import { AddConnectionDialog } from './AddConnectionDialog'

interface HostSelectorProps {
  value: string // connection ID
  onChange: (connectionId: string) => void
  className?: string
}

export function HostSelector({ value, onChange, className }: HostSelectorProps) {
  const [showAddDialog, setShowAddDialog] = useState(false)
  const { connections, connectionStates, connect } = useConnectionStore()

  const selectedConnection = connections.find(c =>
    (c.type === 'local' ? 'local' : c.id) === value
  ) || connections[0]

  const getIcon = (connection: Connection) => {
    switch (connection.type) {
      case 'local': return <Monitor className="h-4 w-4" />
      case 'ssh': return <Server className="h-4 w-4" />
      case 'docker': return <Container className="h-4 w-4" />
    }
  }

  const getStatusIndicator = (connectionId: string) => {
    const state = connectionStates.get(connectionId)
    if (!state) return null

    switch (state.status) {
      case 'connected':
        return <div className="h-2 w-2 rounded-full bg-green-500" />
      case 'connecting':
      case 'installing':
      case 'starting':
        return <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />
      case 'error':
        return <div className="h-2 w-2 rounded-full bg-red-500" />
      default:
        return <div className="h-2 w-2 rounded-full bg-gray-500" />
    }
  }

  const handleSelect = async (connection: Connection) => {
    const id = connection.type === 'local' ? 'local' : connection.id
    const state = connectionStates.get(id)

    // Connect if not already connected
    if (!state || state.status === 'disconnected' || state.status === 'error') {
      try {
        await connect(connection)
      } catch (error) {
        console.error('Failed to connect:', error)
        return
      }
    }

    onChange(id)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className={className}>
            {getIcon(selectedConnection)}
            <span className="ml-2 max-w-[120px] truncate">
              {selectedConnection.name}
            </span>
            {getStatusIndicator(value)}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {connections.map(connection => {
            const id = connection.type === 'local' ? 'local' : connection.id
            const isSelected = id === value

            return (
              <DropdownMenuItem
                key={id}
                onClick={() => handleSelect(connection)}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  {getIcon(connection)}
                  <span>{connection.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusIndicator(id)}
                  {isSelected && <Check className="h-4 w-4" />}
                </div>
              </DropdownMenuItem>
            )
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowAddDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Remote Host...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AddConnectionDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
      />
    </>
  )
}
```

#### 2. Add Connection Dialog
**File**: `humanlayer-wui/src/components/AddConnectionDialog.tsx` (new)

```typescript
import { useState, useEffect } from 'react'
import { Server, Container } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { useConnectionStore, SSHHostConfig, DockerContainer } from '../stores/connectionStore'

interface AddConnectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddConnectionDialog({ open, onOpenChange }: AddConnectionDialogProps) {
  const [tab, setTab] = useState<'ssh' | 'docker'>('ssh')
  const [sshHosts, setSSHHosts] = useState<SSHHostConfig[]>([])
  const [containers, setContainers] = useState<DockerContainer[]>([])
  const [loading, setLoading] = useState(false)

  // SSH form state
  const [sshName, setSSHName] = useState('')
  const [sshHost, setSSHHost] = useState('')
  const [sshPort, setSSHPort] = useState('22')
  const [sshUser, setSSHUser] = useState('')
  const [sshIdentityFile, setSSHIdentityFile] = useState('')

  const {
    addSSHConnection,
    addDockerConnection,
    getSSHConfigHosts,
    getDockerContainers
  } = useConnectionStore()

  useEffect(() => {
    if (open) {
      loadSSHHosts()
      loadContainers()
    }
  }, [open])

  const loadSSHHosts = async () => {
    try {
      const hosts = await getSSHConfigHosts()
      setSSHHosts(hosts)
    } catch (error) {
      console.error('Failed to load SSH hosts:', error)
    }
  }

  const loadContainers = async () => {
    try {
      const containers = await getDockerContainers()
      setContainers(containers.filter(c => c.state === 'running'))
    } catch (error) {
      console.error('Failed to load containers:', error)
    }
  }

  const handleSSHHostSelect = (host: SSHHostConfig) => {
    setSSHName(host.name)
    setSSHHost(host.hostname || host.name)
    setSSHPort(String(host.port || 22))
    setSSHUser(host.user || '')
    setSSHIdentityFile(host.identityFile || '')
  }

  const handleAddSSH = async () => {
    setLoading(true)
    try {
      await addSSHConnection({
        name: sshName,
        host: sshHost,
        port: parseInt(sshPort),
        user: sshUser,
        identityFile: sshIdentityFile || undefined,
        useSshConfig: sshHosts.some(h => h.name === sshName),
        sshConfigHost: sshHosts.some(h => h.name === sshName) ? sshName : undefined,
      })
      onOpenChange(false)
      resetForm()
    } catch (error) {
      console.error('Failed to add SSH connection:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAddDocker = async (container: DockerContainer) => {
    setLoading(true)
    try {
      await addDockerConnection({
        containerId: container.id,
        containerName: container.names,
        image: container.image,
      })
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to add Docker connection:', error)
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setSSHName('')
    setSSHHost('')
    setSSHPort('22')
    setSSHUser('')
    setSSHIdentityFile('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Remote Connection</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'ssh' | 'docker')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="ssh">
              <Server className="h-4 w-4 mr-2" />
              SSH Host
            </TabsTrigger>
            <TabsTrigger value="docker">
              <Container className="h-4 w-4 mr-2" />
              Docker Container
            </TabsTrigger>
          </TabsList>

          <TabsContent value="ssh" className="space-y-4">
            {sshHosts.length > 0 && (
              <div className="space-y-2">
                <Label>From SSH Config</Label>
                <div className="flex flex-wrap gap-2">
                  {sshHosts.map(host => (
                    <Button
                      key={host.name}
                      variant="outline"
                      size="sm"
                      onClick={() => handleSSHHostSelect(host)}
                    >
                      {host.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="ssh-name">Name</Label>
                <Input
                  id="ssh-name"
                  placeholder="dev-server"
                  value={sshName}
                  onChange={(e) => setSSHName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2 grid gap-2">
                  <Label htmlFor="ssh-host">Host</Label>
                  <Input
                    id="ssh-host"
                    placeholder="hostname or IP"
                    value={sshHost}
                    onChange={(e) => setSSHHost(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ssh-port">Port</Label>
                  <Input
                    id="ssh-port"
                    placeholder="22"
                    value={sshPort}
                    onChange={(e) => setSSHPort(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ssh-user">Username</Label>
                <Input
                  id="ssh-user"
                  placeholder="username"
                  value={sshUser}
                  onChange={(e) => setSSHUser(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ssh-key">Identity File (optional)</Label>
                <Input
                  id="ssh-key"
                  placeholder="~/.ssh/id_rsa"
                  value={sshIdentityFile}
                  onChange={(e) => setSSHIdentityFile(e.target.value)}
                />
              </div>
            </div>

            <Button
              onClick={handleAddSSH}
              disabled={loading || !sshName || !sshHost || !sshUser}
              className="w-full"
            >
              {loading ? 'Adding...' : 'Add SSH Connection'}
            </Button>
          </TabsContent>

          <TabsContent value="docker" className="space-y-4">
            {containers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No running containers found.
                <br />
                Start a container and refresh.
              </div>
            ) : (
              <div className="space-y-2">
                {containers.map(container => (
                  <div
                    key={container.id}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50"
                  >
                    <div>
                      <div className="font-medium">{container.names}</div>
                      <div className="text-sm text-muted-foreground">
                        {container.image}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleAddDocker(container)}
                      disabled={loading}
                    >
                      Connect
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <Button
              variant="outline"
              onClick={loadContainers}
              disabled={loading}
              className="w-full"
            >
              Refresh Containers
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
```

#### 3. Integrate Host Selector with Directory Input
**File**: `humanlayer-wui/src/components/FuzzySearchInput.tsx`

Add host selector prop and remote filesystem support:

```typescript
// Add to props interface
interface FuzzySearchInputProps {
  // ... existing props
  connectionId?: string
  onConnectionChange?: (connectionId: string) => void
  showHostSelector?: boolean
}

// Modify readDir logic to support remote
const readDirectory = async (path: string) => {
  if (connectionId && connectionId !== 'local') {
    const connection = connections.find(c => c.id === connectionId)
    if (connection?.type === 'ssh') {
      return invoke<DirEntry[]>('ssh_read_dir', { connectionId, path })
    } else if (connection?.type === 'docker') {
      return invoke<DirEntry[]>('docker_read_dir', {
        containerId: connection.containerId,
        path
      })
    }
  }
  // Local filesystem
  return readDir(path)
}

// Add host selector to render
{showHostSelector && (
  <HostSelector
    value={connectionId || 'local'}
    onChange={onConnectionChange || (() => {})}
    className="mr-2"
  />
)}
```

#### 4. Session Table Connection Indicator
**File**: `humanlayer-wui/src/components/internal/SessionTable.tsx`

Add connection indicator column:

```typescript
// Add to columns
{
  id: 'connection',
  header: 'Host',
  cell: ({ row }) => {
    const session = row.original as AggregatedSession
    if (!session.connectionId || session.connectionId === 'local') {
      return <Monitor className="h-4 w-4 text-muted-foreground" />
    }
    return (
      <div className="flex items-center gap-1">
        {session.connectionId.startsWith('docker:') ? (
          <Container className="h-4 w-4" />
        ) : (
          <Server className="h-4 w-4" />
        )}
        <span className="text-xs text-muted-foreground truncate max-w-[80px]">
          {session.connectionName}
        </span>
      </div>
    )
  },
  size: 100,
}
```

### Success Criteria

#### Automated Verification:
- [ ] TypeScript compiles: `make -C humanlayer-wui check`
- [ ] Linting passes: `make -C humanlayer-wui lint`

#### Manual Verification:
- [ ] Host selector appears next to directory input
- [ ] Can select SSH hosts from `~/.ssh/config`
- [ ] Can add custom SSH host
- [ ] Can select running Docker containers
- [ ] Directory browsing works on remote hosts
- [ ] Sessions show host indicator in table
- [ ] New sessions launch on selected host

**Implementation Note**: This phase completes the core feature. Comprehensive end-to-end testing recommended.

---

## Phase 7: Remote Filesystem Commands

### Overview
Add Tauri commands for remote filesystem operations.

### Changes Required

#### 1. SSH Filesystem Commands
**File**: `humanlayer-wui/src-tauri/src/connections/commands.rs` (append)

```rust
#[tauri::command]
pub async fn ssh_read_dir(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    path: String,
) -> Result<Vec<DirEntry>, String> {
    // Get the SSH client for this connection
    let connections = manager.connections.read().await;
    let active = connections.get(&connection_id)
        .ok_or("Connection not found")?;

    let client = active.ssh_client.as_ref()
        .ok_or("Not an SSH connection")?;

    // Expand tilde
    let expanded_path = if path.starts_with("~") {
        let home = client.exec("echo $HOME").await?;
        path.replacen("~", home.trim(), 1)
    } else {
        path
    };

    // List directory
    let output = client.exec(&format!(
        "ls -1F {} 2>/dev/null | head -100",
        shell_escape(&expanded_path)
    )).await?;

    let mut entries = vec![];
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let is_dir = line.ends_with('/');
        let name = line.trim_end_matches('/').trim_end_matches('@').trim_end_matches('*');
        entries.push(DirEntry {
            name: name.to_string(),
            is_directory: is_dir,
        });
    }

    Ok(entries)
}

#[tauri::command]
pub async fn ssh_home_dir(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
) -> Result<String, String> {
    let connections = manager.connections.read().await;
    let active = connections.get(&connection_id)
        .ok_or("Connection not found")?;

    let client = active.ssh_client.as_ref()
        .ok_or("Not an SSH connection")?;

    let home = client.exec("echo $HOME").await?;
    Ok(home.trim().to_string())
}

#[tauri::command]
pub async fn ssh_validate_directory(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    path: String,
) -> Result<bool, String> {
    let connections = manager.connections.read().await;
    let active = connections.get(&connection_id)
        .ok_or("Connection not found")?;

    let client = active.ssh_client.as_ref()
        .ok_or("Not an SSH connection")?;

    let output = client.exec(&format!(
        "test -d {} && echo 'exists' || echo 'not found'",
        shell_escape(&path)
    )).await?;

    Ok(output.trim() == "exists")
}

fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace("'", "'\\''"))
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DirEntry {
    pub name: String,
    pub is_directory: bool,
}
```

### Success Criteria

#### Automated Verification:
- [ ] Rust compiles: `cd humanlayer-wui && cargo check`

#### Manual Verification:
- [ ] Can browse remote directories via SSH
- [ ] Tilde expansion works on remote
- [ ] Directory validation works on remote
- [ ] Docker filesystem browsing works

---

## Testing Strategy

### Unit Tests
- SSH config parser parsing various `~/.ssh/config` formats
- Connection type serialization/deserialization
- Multi-client session aggregation

### Integration Tests
- SSH connection with key authentication
- SSH connection with agent authentication
- Docker container connection
- Port forwarding tunnel establishment
- Remote hld installation
- Remote daemon lifecycle

### Manual Testing Steps
1. Add SSH host from `~/.ssh/config`
2. Connect to SSH host and verify daemon installs
3. Browse remote filesystem in directory picker
4. Launch session on remote host
5. Verify session appears with host indicator
6. Add Docker container connection
7. Launch session in Docker container
8. Disconnect and verify reconnection works
9. Test with multiple simultaneous connections

## Performance Considerations

- SSH connections are persistent (not reconnecting per operation)
- Port forwarding uses async I/O for efficient tunneling
- Directory listings cached to reduce remote calls
- SSE streams per connection merged client-side

## Migration Notes

- No database schema changes required
- Connections stored in `~/.humanlayer/connections.json`
- Existing local sessions continue to work unchanged
- Feature is additive - no breaking changes

## References

- VS Code Remote-SSH extension architecture
- russh crate documentation
- Tauri plugin-fs for local filesystem operations
- Current WUI architecture: `humanlayer-wui/src/lib/daemon/http-client.ts`
- Working directory picker: `humanlayer-wui/src/components/FuzzySearchInput.tsx`
