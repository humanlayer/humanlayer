# Freestyle Cloud Development Environment Build Plan

## Overview

Build a cloud-based development environment that allows users to launch VM instances with pre-configured development tools, sync their local git repos, and interact with remote development servers through a web interface.

## Phase 1: Foundation (High Priority)

### 1.1 VM Snapshot Infrastructure

- Create base VM snapshot with:
  - Claude Code pre-installed with all dependencies
  - HL daemon pre-configured and ready to start
  - Connection to HL Cloud API on daemon startup
  - System daemon configuration for service management

### 1.2 Web UI Core

- Local git repository management
  - Store user's preferred git repos locally
  - Repo selection interface
- Launch workflow UI
  - Repo picker
  - Command/task input
  - Launch controls

### 1.3 HL Cloud API Core

- Freestyle git repo creation endpoint
  - Generate temporary git URLs for pushing
  - Return push tokens for authentication
- Dev Server provisioning API
  - Fork VM snapshot on demand
  - Return connection details (URL, SSH, web-terminal)

## Phase 2: Integration (High Priority)

### 2.1 Git Workflow

- Local git upstream management
  - Add freestyle remote to local repos
  - Push to freestyle using provided tokens
  - Handle authentication and errors

### 2.2 VM Lifecycle Management

- VM daemon startup sequence
  - Auto-connect to HL Cloud on boot
  - Register VM instance with cloud API
- Dev server initialization
  - Receive and execute launch commands from cloud API
  - Start requested development processes

### 2.3 Real-time Communication

- Event streaming system (WebSocket/SSE)
  - WUI ← HL Cloud: VM status updates ("launching", "ready", "started", "error")
  - HL Cloud ← VM: Development server events and logs
  - Event storage and replay for reconnections

## Phase 3: Enhancement (Medium Priority)

### 3.1 Advanced VM Features

- Bidirectional event streaming
- VM daemon message handling for complex commands
- Process management and monitoring

### 3.2 Development Server Management

- Service discovery and health checks
- Log aggregation and streaming
- Error handling and recovery

## Phase 4: Future Considerations (Low Priority)

### 4.1 Port Management

- Multi-port support beyond default 3000
- Port detection and dynamic proxying
- User-configurable port mappings

### 4.2 Tool Integration

- Evaluate filesystem MCP vs built-in tools
- Agent selection (Claude Code, Codex, OpenCode, etc.)
- SSE MCP server for local-to-cloud editing

### 4.3 Advanced Features

- VM snapshot versioning and updates
- Whitelabel git hosting (git.humanlayer.dev)
- Signal-based daemon connection refresh

## Technical Architecture

```mermaid
graph TB
    subgraph "Local Environment"
        Browser[Browser]
        WUI[Web UI]
        LocalGit[Local Git Repo]
    end

    subgraph "HL Cloud"
        CloudAPI[HL Cloud API]
        EventStore[Event Storage]
        FreestyleGit[Freestyle Git]
    end

    subgraph "VM Instance"
        App[App]
        Daemon[HL Daemon]
        Claude[Claude Code]
        VMGit[VM Git Repo]
    end

    %% Job flow
    WUI -->|Push Jobs| CloudAPI
    CloudAPI -->|Commands| Daemon

    %% Event streaming
    Daemon -->|Stream Events| CloudAPI
    CloudAPI -->|Stream Events| WUI
    CloudAPI --> EventStore

    %% Git flow
    LocalGit -->|Push Code| FreestyleGit
    FreestyleGit -->|Clone/Pull| VMGit

    %% VM Internal Communication
    Daemon <-->|stdio| Claude
    Claude -->|File Changes| VMGit
    Claude -->|Spawn/Control| App
    App -->|Logs/Status| Claude

    %% Port forwarding
    App -.->|Port 3000| Browser

    %% VM Git Repo
    VMGit -->|Push Code??| FreestyleGit

    FreestyleGit -->|Clone/Pull| LocalGit

    style WUI fill:#e1f5fe
    style CloudAPI fill:#f3e5f5
    style Daemon fill:#e8f5e8
    style Claude fill:#fff3e0
```

## Sequence Flow

```mermaid
sequenceDiagram
    participant User
    participant WUI as Web UI
    participant CloudAPI as HL Cloud API
    participant FreestyleGit as Freestyle Git
    participant VM as VM Instance
    participant Daemon as HL Daemon
    participant Claude as Claude Code
    participant App as User App

    Note over User, App: Phase 1: Setup & Launch
    User->>WUI: Select repo & task
    WUI->>CloudAPI: Request dev server
    CloudAPI->>FreestyleGit: Create git repo + token
    FreestyleGit-->>CloudAPI: Return git URL & token
    CloudAPI-->>WUI: Return git credentials

    Note over User, App: Phase 2: Code Sync
    WUI->>WUI: Add freestyle remote
    WUI->>FreestyleGit: Push local code

    Note over User, App: Phase 3: VM Provisioning
    CloudAPI->>VM: Fork VM snapshot
    VM->>Daemon: Start daemon process
    Daemon->>CloudAPI: Connect & register
    CloudAPI-->>WUI: Stream "launching"

    Note over User, App: Phase 4: Code Setup
    FreestyleGit->>Daemon: Clone repo to VM
    Daemon->>Claude: Start Claude Code via stdio
    Claude->>Claude: Read project files
    CloudAPI-->>WUI: Stream "ready"

    Note over User, App: Phase 5: Task Execution
    CloudAPI->>Daemon: Send user task/command
    Daemon->>Claude: Forward task via stdio
    Claude->>Claude: Plan & execute work
    Claude->>App: Spawn/control processes

    Note over User, App: Phase 6: Real-time Updates
    loop Development Loop
        Claude->>Daemon: Send status updates
        App->>Claude: Send logs/errors
        Claude->>Daemon: Forward app status
        Daemon->>CloudAPI: Stream events
        CloudAPI-->>WUI: Stream to user
        WUI-->>User: Display updates
    end

    Note over User, App: Phase 7: Access
    User->>WUI: Click app URL
    WUI->>App: Connect to port 3000
    App-->>User: Serve application
```

## Success Criteria

- Users can select local repos and launch cloud dev environments
- Real-time streaming of development server status and logs
- Seamless git synchronization between local and cloud environments
- Stable VM lifecycle management with proper error handling
