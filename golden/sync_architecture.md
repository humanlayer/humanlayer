# Riptide Sync Architecture

This document describes the synchronization architecture for the Riptide system, including the API contracts, Electric SQL sync, and the interruption system.

## System Overview

```mermaid
flowchart TB
    subgraph "Client Layer"
        UI[riptide-ui<br/>React + TanStack Router]
        Daemon[riptide-daemon<br/>Bun + Claude SDK]
    end

    subgraph "API Layer"
        API[riptide-api<br/>Hono + oRPC]
        Proxy[riptide-electric-proxy<br/>Hono Auth Proxy]
    end

    subgraph "Data Layer"
        Electric[Electric SQL<br/>Sync Service]
        PG[(PostgreSQL<br/>Database)]
    end

    subgraph "External"
        WorkOS[WorkOS<br/>Auth Provider]
        Claude[Claude Code<br/>SDK]
    end

    UI -->|"JWT Auth<br/>/rpc/api/v1/*"| API
    Daemon -->|"RS256 Token<br/>/rpc/daemon/v1/*"| API

    UI -->|"Bearer Token<br/>Shape Streams"| Proxy
    Daemon -->|"x-daemon-authorization<br/>Shape Streams"| Proxy

    Proxy -->|"Filtered Shapes"| Electric
    Electric -->|"Logical Replication"| PG
    API -->|"Drizzle ORM"| PG

    UI -->|"JWKS Validation"| WorkOS
    API -->|"JWKS Validation"| WorkOS

    Daemon -->|"query() API"| Claude
```

## Contract Architecture

The `riptide-api-contract` package defines two separate oRPC contract hierarchies:

```mermaid
flowchart LR
    subgraph "contracts/riptide-api-contract"
        direction TB

        subgraph "RiptideApiContract (UI Side)"
            direction TB
            Auth1[auth.user.info]
            Auth2[auth.user.organizations.list]
            Auth3[auth.daemon.token.create]
            Sess1[sessions.create]
            Sess2[sessions.launch]
            Sess3[sessions.update]
            Sess4[sessions.continue]
            Sess5[sessions.interrupt]
            Task1[tasks.create/update/archive]
        end

        subgraph "RiptideDaemonApiContract (Daemon Side)"
            direction TB
            Host1[hosts.heartbeat]
            DSess1[sessions.update]
            DSess2[sessions.events.create]
        end
    end

    subgraph "apps/riptide-api"
        direction TB
        APIRouter[apiRouter<br/>/rpc/api/v1/*]
        DaemonRouter[daemonRouter<br/>/rpc/daemon/v1/*]
    end

    Auth1 --> APIRouter
    Sess5 --> APIRouter
    Host1 --> DaemonRouter
    DSess1 --> DaemonRouter
```

## Authentication Flow

```mermaid
sequenceDiagram
    participant UI as riptide-ui
    participant API as riptide-api
    participant WorkOS
    participant Daemon as riptide-daemon

    Note over UI,WorkOS: UI Authentication (JWT)
    UI->>WorkOS: Login via AuthKit
    WorkOS-->>UI: JWT with claims
    UI->>API: Request with Bearer token
    API->>WorkOS: Fetch JWKS (cached 30s)
    API->>API: Validate JWT signature
    API->>API: Extract userId, orgId from claims
    API-->>UI: Authenticated response

    Note over UI,Daemon: Daemon Token Creation
    UI->>API: POST auth.daemon.token.create
    API->>API: Sign RS256 token with private key
    API-->>UI: Signed daemon token
    UI->>Daemon: Pass token at startup

    Note over Daemon,API: Daemon Authentication
    Daemon->>API: Request with x-daemon-authorization
    API->>API: Verify RS256 signature
    API->>API: Extract userId, orgId, hostId
    API-->>Daemon: Authenticated response
```

## Electric SQL Sync Flow

```mermaid
flowchart TB
    subgraph "Write Path"
        direction TB
        Mutation[API Mutation]
        TX[Postgres Transaction]
        TXID[Return txid]
    end

    subgraph "Sync Path"
        direction TB
        Replication[Logical Replication]
        Electric[Electric SQL Service]
        Proxy[Electric Proxy]
        Shape[Shape Stream]
    end

    subgraph "Client Collections"
        direction TB
        UICol[UI TanStack DB Collection]
        DaemonCol[Daemon TanStack DB Collection]
    end

    Mutation --> TX
    TX --> TXID
    TX --> Replication
    Replication --> Electric
    Electric --> Proxy
    Proxy -->|"WHERE org_id=$1<br/>AND created_by=$2"| Shape
    Shape --> UICol
    Shape --> DaemonCol

    TXID -.->|"awaitTxId()"| UICol
```

## Electric Proxy Authorization

```mermaid
flowchart TB
    Request[Incoming Request]

    subgraph "Auth Middleware"
        direction TB
        CheckBearer{Bearer Token?}
        CheckDaemon{Daemon Token?}
        ValidateJWT[Validate JWT via JWKS]
        ValidateDaemon[Validate RS256 Signature]
        ExtractCtx[Extract organizationId + userId]
    end

    subgraph "Route Handler"
        direction TB
        SetTable[Set table name]
        BuildWhere[Build WHERE clause]
        ApplyParams[Apply params to URL]
        ProxyReq[Proxy to Electric]
    end

    Request --> CheckBearer
    CheckBearer -->|Yes| ValidateJWT
    CheckBearer -->|No| CheckDaemon
    CheckDaemon -->|Yes| ValidateDaemon
    CheckDaemon -->|No| Unauthorized
    ValidateJWT --> ExtractCtx
    ValidateDaemon --> ExtractCtx
    ExtractCtx --> SetTable
    SetTable --> BuildWhere
    BuildWhere --> ApplyParams
    ApplyParams --> ProxyReq
```

## Interruption System Flow

```mermaid
sequenceDiagram
    participant User
    participant UI as riptide-ui
    participant API as riptide-api
    participant PG as PostgreSQL
    participant Electric as Electric SQL
    participant Daemon as riptide-daemon
    participant Claude as Claude Code SDK

    Note over User,Claude: User Initiates Interrupt
    User->>UI: Ctrl+X or click Interrupt

    UI->>UI: Optimistic update:<br/>status = 'interrupt_requested'

    UI->>API: POST sessions.interrupt<br/>{sessionId, message?}

    API->>PG: BEGIN TRANSACTION
    API->>PG: UPDATE sessions<br/>SET status='interrupt_requested'<br/>prompt={message}
    API->>PG: SELECT pg_current_xact_id()
    API->>PG: COMMIT
    API-->>UI: {success, transactionId}

    UI->>UI: awaitTxId(transactionId)

    PG->>Electric: Logical Replication
    Electric->>Daemon: Shape Stream Update

    Daemon->>Daemon: subscribeChanges callback
    Daemon->>Daemon: isInterruptRequestedEvent()
    Daemon->>Daemon: Set interruptState.wasInterrupted = true
    Daemon->>Daemon: Check for resume prompt

    Daemon->>Claude: eventIterator.interrupt()
    Daemon->>Daemon: closeInputStream()

    Note over Daemon,Claude: Session Processing Exits

    alt Has Resume Prompt
        Daemon->>API: sessions.events.create<br/>{role: 'user', content: prompt}
        Daemon->>Daemon: runSession() recursive call<br/>with resumeSessionId
    else No Resume Prompt
        Daemon->>API: sessions.update<br/>{status: 'interrupted'}
    end

    Electric->>UI: Shape Stream Update
    UI->>UI: Collection updated<br/>Reflects final status
```

## TanStack DB Collection Pattern

```mermaid
flowchart TB
    subgraph "Collection Creation"
        direction TB
        Schema[Zod Schema<br/>from @humanlayer/db]
        ShapeOpts[Shape Options<br/>URL + Headers]
        BackOff[Backoff Config]
        GetKey[getKey: item.id]
    end

    subgraph "electricCollectionOptions()"
        direction TB
        Electric[Electric Sync Config]
    end

    subgraph "createCollection()"
        direction TB
        Collection[TanStack DB Collection]
    end

    subgraph "Collection Cache"
        direction TB
        CacheKey["userId:organizationId"]
        CacheMap[WeakMap<key, collection>]
    end

    Schema --> Electric
    ShapeOpts --> Electric
    BackOff --> Electric
    GetKey --> Electric
    Electric --> Collection
    Collection --> CacheMap
    CacheKey --> CacheMap
```

## Session State Machine

```mermaid
stateDiagram-v2
    [*] --> draft: Create Session

    draft --> ready_for_launch: Set host
    ready_for_launch --> launching: Launch

    launching --> running: Claude starts
    launching --> failed: Error

    running --> interrupt_requested: User interrupts
    running --> ready_for_input: Awaiting input
    running --> approval_needed: Permission request
    running --> failed: Error

    interrupt_requested --> interrupted: No resume prompt
    interrupt_requested --> resuming: Has resume prompt

    interrupted --> ready_for_input: Can continue
    resuming --> running: Claude resumes

    ready_for_input --> running: User continues
    approval_needed --> running: User approves
    approval_needed --> running: User denies (with message)

    failed --> [*]
```

## Data Flow Summary

| Component | Role | Auth | Data Direction |
|-----------|------|------|----------------|
| riptide-ui | User interface | JWT (WorkOS) | Reads via Electric, Writes via API |
| riptide-api | Business logic | JWT + RS256 | Reads/Writes Postgres |
| riptide-electric-proxy | Auth filter | JWT + RS256 | Proxies Electric with WHERE filters |
| Electric SQL | Sync engine | Secret token | Streams from Postgres |
| riptide-daemon | Session runner | RS256 token | Reads via Electric, Writes via API |
| PostgreSQL | Persistence | N/A | Source of truth |

## Key Integration Points

1. **Transaction IDs**: API returns Postgres `txid` so clients can wait for Electric sync completion
2. **Optimistic Updates**: UI updates local collection immediately, reverts on error
3. **Change Subscriptions**: Daemon uses `subscribeChanges()` to react to status updates
4. **Row-Level Security**: Electric proxy applies WHERE clauses based on auth context
5. **Dual Contracts**: Same API server, different auth and procedures for UI vs daemon
