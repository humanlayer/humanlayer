---
title: "OpenCode API Specification"
version: "1.0.0"
description: "Complete API documentation for OpenCode - AI coding assistant platform"
base_url: "http://localhost"
openapi: "3.0.0"
---

# OpenCode API Specification

## Overview

OpenCode provides both a local server API and a cloud-based sharing API. The local server handles session management, AI model interaction, and development tools, while the cloud API enables session sharing and real-time synchronization.

## Authentication & Authorization

- **Local API**: No authentication required (localhost access)
- **Cloud API**: Secret-based authentication for shared sessions
- **Rate Limiting**: Not explicitly implemented
- **CORS**: Not specified in current implementation

## Base URLs

- **Local Server**: `http://localhost:{port}` (configurable port)
- **Cloud Share API**: `https://opencode.ai/api`

---

## Local Server API

### Error Handling

All endpoints use standardized error responses:

```json
{
  "data": {
    "type": "string",
    "message": "string",
    "details": {}
  }
}
```

**Status Codes:**
- `200`: Success
- `400`: Bad Request (validation errors, named errors)

### Middleware

All requests include:
- Request logging (method, path)
- Response timing
- Error handling with NamedError conversion

### Content Negotiation

- **Request**: `application/json`
- **Response**: `application/json`, `text/event-stream` (for SSE)

---

## Endpoints

### 1. API Documentation

#### GET /openapi

**Description**: Get OpenAPI specification

**Response:**
- **200**: OpenAPI 3.0 specification
  ```json
  {
    "openapi": "3.0.0",
    "info": {
      "title": "opencode",
      "version": "1.0.0",
      "description": "opencode api"
    },
    "paths": {...}
  }
  ```

**File Reference**: [packages/opencode/src/server/server.ts#L72-L84](file:///Users/allison/git/opencode/packages/opencode/src/server/server.ts#L72-L84)

---

### 2. Event Stream

#### GET /event

**Description**: Server-sent events stream for real-time updates

**Response:**
- **200**: SSE stream
  - **Content-Type**: `text/event-stream`
  - **Schema**: Bus events (session updates, deletions, etc.)

**Event Types:**
- `session.updated`: Session information changed
- `session.deleted`: Session removed
- Tool execution events
- Message events

**Connection Handling:**
- Automatic cleanup on abort
- Heartbeat with empty initial message

**File Reference**: [packages/opencode/src/server/server.ts#L85-L124](file:///Users/allison/git/opencode/packages/opencode/src/server/server.ts#L85-L124)

---

### 3. Application Info

#### POST /app_info

**Description**: Get application information and paths

**Request Body**: None

**Response:**
- **200**: Application info
  ```json
  {
    "path": {
      "root": "string",
      "data": "string", 
      "cwd": "string"
    },
    "time": {
      "started": "number"
    }
  }
  ```

**File Reference**: [packages/opencode/src/server/server.ts#L125-L143](file:///Users/allison/git/opencode/packages/opencode/src/server/server.ts#L125-L143)

---

### 4. Configuration

#### POST /config_get

**Description**: Get current configuration

**Request Body**: None

**Response:**
- **200**: Configuration object
  ```json
  {
    "providers": {
      "anthropic": {...},
      "github-copilot": {...}
    },
    "models": {...},
    "features": {...}
  }
  ```

**File Reference**: [packages/opencode/src/server/server.ts#L144-L162](file:///Users/allison/git/opencode/packages/opencode/src/server/server.ts#L144-L162)

---

### 5. Application Lifecycle

#### POST /app_initialize

**Description**: Initialize the application

**Request Body**: None

**Response:**
- **200**: Success
  ```json
  true
  ```

**File Reference**: [packages/opencode/src/server/server.ts#L163-L182](file:///Users/allison/git/opencode/packages/opencode/src/server/server.ts#L163-L182)

---

### 6. Path Information

#### POST /path_get

**Description**: Get application paths

**Request Body**: None

**Response:**
- **200**: Path information
  ```json
  {
    "root": "string",
    "data": "string",
    "cwd": "string", 
    "config": "string"
  }
  ```

**File Reference**: [packages/opencode/src/server/server.ts#L212-L243](file:///Users/allison/git/opencode/packages/opencode/src/server/server.ts#L212-L243)

---

## Session Management

### 7. Initialize Session

#### POST /session_initialize

**Description**: Analyze app and create AGENTS.md file

**Request Body:**
```json
{
  "sessionID": "string",
  "providerID": "string", 
  "modelID": "string"
}
```

**Validation:**
- `sessionID`: Required string
- `providerID`: Required string  
- `modelID`: Required string

**Response:**
- **200**: Success
  ```json
  true
  ```

**File Reference**: [packages/opencode/src/server/server.ts#L183-L211](file:///Users/allison/git/opencode/packages/opencode/src/server/server.ts#L183-L211)

---

### 8. Create Session

#### POST /session_create

**Description**: Create new session

**Request Body**: None

**Response:**
- **200**: Session created
  ```json
  {
    "id": "string",
    "parentID": "string?",
    "share": {
      "url": "string"
    }?,
    "title": "string",
    "version": "string",
    "time": {
      "created": "number",
      "updated": "number"
    }
  }
  ```
- **400**: Error creating session

**File Reference**: [packages/opencode/src/server/server.ts#L244-L264](file:///Users/allison/git/opencode/packages/opencode/src/server/server.ts#L244-L264)

---

### 9. Share Session

#### POST /session_share

**Description**: Enable session sharing

**Request Body:**
```json
{
  "sessionID": "string"
}
```

**Response:**
- **200**: Session shared
  ```json
  {
    "id": "string",
    "share": {
      "url": "string"
    },
    "title": "string",
    "version": "string",
    "time": {
      "created": "number",
      "updated": "number"
    }
  }
  ```

**File Reference**: [packages/opencode/src/server/server.ts#L265-L292](file:///Users/allison/git/opencode/packages/opencode/src/server/server.ts#L265-L292)

---

### 10. Unshare Session

#### POST /session_unshare

**Description**: Disable session sharing

**Request Body:**
```json
{
  "sessionID": "string"
}
```

**Response:**
- **200**: Session unshared
  ```json
  {
    "id": "string",
    "share": null,
    "title": "string",
    "version": "string", 
    "time": {
      "created": "number",
      "updated": "number"
    }
  }
  ```

**File Reference**: [packages/opencode/src/server/server.ts#L293-L320](file:///Users/allison/git/opencode/packages/opencode/src/server/server.ts#L293-L320)

---

### 11. Get Session Messages

#### POST /session_messages

**Description**: Get all messages for a session

**Request Body:**
```json
{
  "sessionID": "string"
}
```

**Response:**
- **200**: Array of messages
  ```json
  [
    {
      "id": "string",
      "sessionID": "string",
      "role": "user" | "assistant",
      "parts": [
        {
          "type": "text",
          "text": "string"
        }
      ],
      "time": {
        "created": "number"
      },
      "error": {...}?
    }
  ]
  ```

**File Reference**: [packages/opencode/src/server/server.ts#L321-L346](file:///Users/allison/git/opencode/packages/opencode/src/server/server.ts#L321-L346)

---

### 12. List Sessions

#### POST /session_list

**Description**: Get all sessions

**Request Body**: None

**Response:**
- **200**: Array of sessions
  ```json
  [
    {
      "id": "string",
      "parentID": "string?",
      "share": {
        "url": "string"
      }?,
      "title": "string",
      "version": "string",
      "time": {
        "created": "number",
        "updated": "number"
      }
    }
  ]
  ```

**File Reference**: [packages/opencode/src/server/server.ts#L347-L366](file:///Users/allison/git/opencode/packages/opencode/src/server/server.ts#L347-L366)

---

### 13. Abort Session

#### POST /session_abort

**Description**: Abort running session

**Request Body:**
```json
{
  "sessionID": "string"
}
```

**Response:**
- **200**: Abort status
  ```json
  true
  ```

**File Reference**: [packages/opencode/src/server/server.ts#L367-L392](file:///Users/allison/git/opencode/packages/opencode/src/server/server.ts#L367-L392)

---

### 14. Delete Session

#### POST /session_delete

**Description**: Delete session and all data

**Request Body:**
```json
{
  "sessionID": "string"
}
```

**Response:**
- **200**: Success
  ```json
  true
  ```

**File Reference**: [packages/opencode/src/server/server.ts#L393-L419](file:///Users/allison/git/opencode/packages/opencode/src/server/server.ts#L393-L419)

---

### 15. Summarize Session

#### POST /session_summarize

**Description**: Generate session summary

**Request Body:**
```json
{
  "sessionID": "string",
  "providerID": "string",
  "modelID": "string"
}
```

**Response:**
- **200**: Success
  ```json
  true
  ```

**File Reference**: [packages/opencode/src/server/server.ts#L420-L448](file:///Users/allison/git/opencode/packages/opencode/src/server/server.ts#L420-L448)

---

### 16. Chat with Model

#### POST /session_chat

**Description**: Send message to AI model

**Request Body:**
```json
{
  "sessionID": "string",
  "providerID": "string", 
  "modelID": "string",
  "parts": [
    {
      "type": "text",
      "text": "string"
    }
  ]
}
```

**Message Part Types:**
- `text`: Text content
- `tool_call`: Tool invocation
- `tool_result`: Tool execution result
- `image`: Image content

**Response:**
- **200**: Message response
  ```json
  {
    "id": "string",
    "sessionID": "string", 
    "role": "assistant",
    "parts": [...],
    "time": {
      "created": "number"
    }
  }
  ```

**File Reference**: [packages/opencode/src/server/server.ts#L449-L478](file:///Users/allison/git/opencode/packages/opencode/src/server/server.ts#L449-L478)

---

## Provider & Model Management

### 17. List Providers

#### POST /provider_list

**Description**: Get available AI providers and models

**Request Body**: None

**Response:**
- **200**: Provider information
  ```json
  {
    "providers": [
      {
        "id": "string",
        "name": "string",
        "models": {
          "modelId": {
            "id": "string",
            "name": "string",
            "cost": {
              "input": "number",
              "output": "number"
            },
            "limit": {
              "input": "number",
              "output": "number"
            }
          }
        }
      }
    ],
    "default": {
      "providerId": "defaultModelId"
    }
  }
  ```

**File Reference**: [packages/opencode/src/server/server.ts#L479-L511](file:///Users/allison/git/opencode/packages/opencode/src/server/server.ts#L479-L511)

---

## File Operations

### 18. File Search

#### POST /file_search

**Description**: Search for files using ripgrep

**Request Body:**
```json
{
  "query": "string"
}
```

**Parameters:**
- `query`: Search pattern/filename
- **Limit**: 10 results max

**Response:**
- **200**: File paths
  ```json
  [
    "path/to/file1.ts",
    "path/to/file2.js"
  ]
  ```

**File Reference**: [packages/opencode/src/server/server.ts#L512-L543](file:///Users/allison/git/opencode/packages/opencode/src/server/server.ts#L512-L543)

---

## Installation

### 19. Installation Info

#### POST /installation_info

**Description**: Get installation information

**Request Body**: None

**Response:**
- **200**: Installation details
  ```json
  {
    "version": "string",
    "platform": "string",
    "arch": "string"
  }
  ```

**File Reference**: [packages/opencode/src/server/server.ts#L544-L562](file:///Users/allison/git/opencode/packages/opencode/src/server/server.ts#L544-L562)

---

## Cloud Share API

The cloud API handles session sharing through Cloudflare Workers and Durable Objects.

### Base URL
`https://opencode.ai/api`

### 20. Create Share

#### POST /share_create

**Description**: Create shareable session

**Request Body:**
```json
{
  "sessionID": "string"
}
```

**Response:**
- **200**: Share created
  ```json
  {
    "secret": "string",
    "url": "string"
  }
  ```

**File Reference**: [packages/function/src/api.ts#L113-L129](file:///Users/allison/git/opencode/packages/function/src/api.ts#L113-L129)

---

### 21. Delete Share

#### POST /share_delete

**Description**: Remove shared session

**Request Body:**
```json
{
  "sessionID": "string",
  "secret": "string"
}
```

**Response:**
- **200**: Share deleted
  ```json
  {}
  ```

**File Reference**: [packages/function/src/api.ts#L131-L141](file:///Users/allison/git/opencode/packages/function/src/api.ts#L131-L141)

---

### 22. Sync Share Data

#### POST /share_sync

**Description**: Sync data to shared session

**Request Body:**
```json
{
  "sessionID": "string",
  "secret": "string",
  "key": "string",
  "content": "any"
}
```

**Key Patterns:**
- `session/info/{sessionID}`: Session metadata
- `session/message/{sessionID}/{messageID}`: Message data

**Response:**
- **200**: Data synced
  ```json
  {}
  ```

**File Reference**: [packages/function/src/api.ts#L143-L157](file:///Users/allison/git/opencode/packages/function/src/api.ts#L143-L157)

---

### 23. WebSocket Polling

#### GET /share_poll

**Description**: WebSocket connection for real-time updates

**Query Parameters:**
- `id`: Share ID

**Headers:**
- `Upgrade: websocket` (required)

**Response:**
- **101**: WebSocket connection established
- **400**: Missing share ID
- **426**: Upgrade header required

**WebSocket Messages:**
```json
{
  "key": "string",
  "content": "any"
}
```

**File Reference**: [packages/function/src/api.ts#L159-L172](file:///Users/allison/git/opencode/packages/function/src/api.ts#L159-L172)

---

### 24. Get Share Data

#### GET /share_data

**Description**: Get shared session data

**Query Parameters:**
- `id`: Share ID

**Response:**
- **200**: Session data
  ```json
  {
    "info": {
      "id": "string",
      "title": "string",
      "version": "string",
      "time": {
        "created": "number",
        "updated": "number"
      }
    },
    "messages": {
      "messageId": {
        "id": "string",
        "role": "user" | "assistant",
        "parts": [...],
        "time": {
          "created": "number"
        }
      }
    }
  }
  ```
- **400**: Missing share ID

**File Reference**: [packages/function/src/api.ts#L174-L206](file:///Users/allison/git/opencode/packages/function/src/api.ts#L174-L206)

---

## API Versioning Strategy

- **Version**: 1.0.0 (specified in OpenAPI spec)
- **Strategy**: Not explicitly implemented
- **Backward Compatibility**: Not specified

## Security Considerations

- **Local API**: Localhost-only access
- **Cloud API**: Secret-based authentication
- **Data Validation**: Zod schemas for all inputs
- **Error Handling**: Sanitized error responses
- **Session Isolation**: Sessions isolated by ID and secret

## Performance & Limits

- **File Search**: Limited to 10 results
- **WebSocket**: Idle timeout disabled (idleTimeout: 0)
- **Request Logging**: All requests logged with timing
- **Concurrent Connections**: No explicit limits

## Data Persistence

- **Local**: File-based storage
- **Cloud**: Cloudflare Durable Objects + R2 Bucket
- **Session Data**: JSON serialization
- **Message History**: Persistent across sessions

---

## OpenAPI 3.0 Specification

The complete OpenAPI specification can be generated by calling:

```bash
GET /openapi
```

This returns a full OpenAPI 3.0 document with all schemas, endpoints, and validation rules.

**Generated OpenAPI Location**: Available at runtime via `/openapi` endpoint

**File Reference**: [packages/opencode/src/server/server.ts#L567-L580](file:///Users/allison/git/opencode/packages/opencode/src/server/server.ts#L567-L580)
