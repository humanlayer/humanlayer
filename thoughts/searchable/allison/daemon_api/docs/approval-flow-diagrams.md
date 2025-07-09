# Approval Flow Diagrams

## Local Approval Flow

```mermaid
sequenceDiagram
    participant Claude as Claude Code
    participant MCP as MCP Server<br/>(hlyr)
    participant Daemon as HLD Daemon
    participant UI as TUI/WUI
    participant User as User

    Claude->>MCP: request_permission(Edit, params)
    MCP->>Daemon: POST /api/v1/approvals

    Note over Daemon: Check auto-approval rules:<br/>1. Session settings<br/>2. .claude/settings.local.json<br/>3. CLI flags

    alt Auto-approved
        Daemon-->>MCP: 200 OK {approved: true}
        MCP-->>Claude: {behavior: "allow"}
    else Needs approval
        Daemon->>Daemon: Enrich context<br/>(read file, etc)
        Daemon-->>MCP: 202 Accepted {id: "123"}
        Daemon->>UI: SSE: new_approval event
        UI->>Daemon: GET /api/v1/approvals/123
        Daemon-->>UI: Approval + context + schema
        UI->>User: Display enriched approval
        User->>UI: Approve with modifications
        UI->>Daemon: PUT /api/v1/approvals/123/decide
        Note over UI: {decision: "approve",<br/>response_data: {updatedInput: {...}}}
        Daemon->>Daemon: Update .claude/settings.local.json<br/>(if save_rule provided)
        Daemon-->>UI: 200 OK
        Daemon->>MCP: SSE: approval_resolved
        MCP->>Daemon: GET /api/v1/approvals/123
        Daemon-->>MCP: {approved: true, updatedInput: {...}}
        MCP-->>Claude: {behavior: "allow", updatedInput: {...}}
    end
```

## Cloud Sync Approval Flow

```mermaid
sequenceDiagram
    participant Mobile as Mobile App
    participant Cloud as Cloud API
    participant Daemon as Local Daemon
    participant Claude as Claude Code
    participant MCP as MCP Server

    Note over Daemon,Cloud: Daemon polls cloud every 1-2 seconds

    Claude->>MCP: request_permission(Edit, params)
    MCP->>Daemon: POST /api/v1/approvals
    Daemon->>Daemon: Create & enrich approval

    Mobile->>Cloud: GET /api/v1/approvals
    Cloud->>Cloud: Queue command for daemon

    Daemon->>Cloud: POST /sync/poll<br/>{updates: [...], wait_for_commands: true}
    Cloud-->>Daemon: {commands: [{method: "getApprovals"}]}
    Daemon->>Cloud: POST /sync/results<br/>{approvals: [...]}

    Cloud-->>Mobile: Enriched approvals
    Mobile->>Mobile: Display to user
    Mobile->>Cloud: PUT /api/v1/approvals/123/decide
    Cloud->>Cloud: Queue decision command

    Daemon->>Cloud: POST /sync/poll
    Cloud-->>Daemon: {commands: [{method: "decideApproval", params: {...}}]}
    Daemon->>Daemon: Process decision
    Daemon->>MCP: Approval resolved
    MCP-->>Claude: {behavior: "allow", updatedInput: {...}}
```

## Session Settings Toggle Flow

```mermaid
sequenceDiagram
    participant User as User
    participant UI as WUI
    participant Daemon as Daemon
    participant Session as Session State

    User->>UI: Press Shift+Tab
    UI->>Daemon: POST /api/v1/sessions/{id}/settings<br/>{auto_accept_edits: true}
    Daemon->>Session: Update settings
    Daemon-->>UI: 200 OK
    UI->>User: Show "Auto-accepting edits" indicator

    Note over Daemon: Next Edit/Write tool call

    Daemon->>Daemon: Check session settings
    Note over Daemon: auto_accept_edits = true<br/>Skip approval creation
    Daemon-->>MCP: Immediate approval

    User->>UI: Press Shift+Tab again
    UI->>Daemon: POST /api/v1/sessions/{id}/settings<br/>{auto_accept_edits: false}
    Daemon-->>UI: 200 OK
    UI->>User: Remove indicator
```

## Streaming Context Flow

```mermaid
sequenceDiagram
    participant UI as UI Client
    participant Daemon as Daemon
    participant FS as File System

    UI->>Daemon: GET /api/v1/approvals/123
    Daemon-->>UI: Approval with large context indicator

    UI->>UI: Detect context > 1MB
    UI->>Daemon: GET /api/v1/approvals/123/context/stream
    Daemon->>FS: Read file in chunks

    loop Stream chunks
        FS-->>Daemon: File chunk
        Daemon-->>UI: SSE: context_chunk
        UI->>UI: Display partial content
    end

    Daemon-->>UI: SSE: context_complete
    UI->>UI: Enable approval buttons
```

## Auto-Approval Rule Creation

```mermaid
sequenceDiagram
    participant User as User
    participant UI as UI
    participant Daemon as Daemon
    participant Settings as .claude/<br/>settings.local.json

    UI->>User: Show approval dialog<br/>[Approve] [Approve Always] [Deny]
    User->>UI: Click "Approve Always"

    UI->>Daemon: PUT /api/v1/approvals/123/decide
    Note over UI: {<br/>  decision: "approve",<br/>  response_data: {<br/>    save_rule: {<br/>      scope: "local",<br/>      pattern: "Edit(/src/*.go)"<br/>    }<br/>  }<br/>}

    Daemon->>Settings: Read current settings
    Settings-->>Daemon: Current allowed tools
    Daemon->>Daemon: Add new pattern
    Daemon->>Settings: Write updated settings
    Daemon-->>UI: 200 OK

    Note over Daemon: Future Edit on /src/*.go files<br/>will auto-approve
```

## Why These Flows?

1. **Local Flow**: Minimal latency, direct communication
2. **Cloud Sync**: Preserves local decision-making while enabling remote access
3. **Settings Toggle**: Mimics Claude Code's shift+tab UX
4. **Streaming**: Handles large files without memory issues
5. **Rule Creation**: Progressive automation based on user behavior

Each flow is designed to be resilient, with fallbacks and error handling at every step.
