# WUI Marketing Demo States Appendix

This document provides comprehensive JSON state examples for all currently supported UI states in the WUI application. Each state can be used in demo sequences for marketing purposes.

## Important Notes

1. **Store State vs Component State**: This document focuses on the main application store state. UI-specific states (like whether a modal is open) are managed at the component level.

2. **Actual Types**: All examples use the actual TypeScript types from the codebase:
   - `SessionStatus`: `starting`, `running`, `waiting_input`, `completing`, `completed`, `failed`
   - `ApprovalType`: `function_call`, `human_contact`
   - `Decision`: `approve`, `deny`, `respond`

3. **Event Handling**: Conversation events are fetched separately via API, not stored in the main state.

4. **Notifications**: Toast notifications are handled by the Sonner library and triggered by actions, not stored in state.

## Table of Contents

1. [Session Table States](#session-table-states)
2. [Session Launcher States](#session-launcher-states)
3. [Session View States](#session-view-states)
4. [Approval States](#approval-states)
5. [Notification & Toast States](#notification--toast-states)
6. [Search & Filter States](#search--filter-states)
7. [Error & Loading States](#error--loading-states)
8. [Combined Scenario States](#combined-scenario-states)

---

## Session Table States

### 1.1 Empty Session Table
```json
{
  "state": {
    "sessions": [],
    "focusedSession": null,
    "activeSessionId": null,
    "isLoading": false,
    "notifiedItems": []
  },
  "delay": 2000
}
```
*Description*: Initial empty state when no sessions have been created yet.

### 1.2 Single Session (Starting)
```json
{
  "state": {
    "sessions": [
      {
        "id": "session-1",
        "query": "Analyzing repository structure",
        "status": "starting",
        "claude_session_id": null,
        "current_directory": "/Users/dev/project",
        "agent_flags": [],
        "commit_sha": "abc123def456",
        "branch": "main",
        "created_at": "2024-01-15T10:30:00Z",
        "model": "claude-3-opus"
      }
    ],
    "focusedSession": null,
    "activeSessionId": null
  },
  "delay": 1500
}
```
*Description*: A single session in the starting phase before Claude session ID is assigned.

### 1.3 Multiple Sessions (Various States)
```json
{
  "state": {
    "sessions": [
      {
        "id": "session-1",
        "query": "Implement user authentication",
        "status": "completed",
        "claude_session_id": "claude-abc123",
        "current_directory": "/Users/dev/project",
        "agent_flags": [],
        "commit_sha": "abc123",
        "branch": "main",
        "created_at": "2024-01-15T09:00:00Z",
        "model": "claude-3-opus"
      },
      {
        "id": "session-2",
        "query": "Debug payment integration",
        "status": "running",
        "claude_session_id": "claude-def456",
        "current_directory": "/Users/dev/project",
        "agent_flags": [],
        "commit_sha": "def456",
        "branch": "feature/payments",
        "created_at": "2024-01-15T10:00:00Z",
        "model": "claude-3-sonnet"
      },
      {
        "id": "session-3",
        "query": "Refactor database schema",
        "status": "waiting_input",
        "claude_session_id": "claude-ghi789",
        "current_directory": "/Users/dev/project",
        "agent_flags": [],
        "commit_sha": "ghi789",
        "branch": "refactor/db",
        "created_at": "2024-01-15T10:30:00Z",
        "model": "claude-3-opus"
      },
      {
        "id": "session-4",
        "query": "Add test coverage",
        "status": "failed",
        "claude_session_id": "claude-jkl012",
        "current_directory": "/Users/dev/project",
        "agent_flags": [],
        "commit_sha": "jkl012",
        "branch": "tests",
        "created_at": "2024-01-15T08:00:00Z",
        "model": "claude-3-haiku"
      }
    ],
    "focusedSession": null,
    "activeSessionId": "session-2"
  },
  "delay": 3000
}
```
*Description*: Table showing multiple sessions in different states - completed, running, waiting_input (for approval), and failed.

### 1.4 Filtered Session Table
```json
{
  "state": {
    "sessions": [
      {
        "id": "session-2",
        "query": "Debug payment integration",
        "status": "running",
        "claude_session_id": "claude-def456",
        "current_directory": "/Users/dev/project",
        "agent_flags": [],
        "commit_sha": "def456",
        "branch": "feature/payments",
        "created_at": "2024-01-15T10:00:00Z",
        "model": "claude-3-sonnet"
      },
      {
        "id": "session-5",
        "query": "Optimize API performance",
        "status": "running",
        "claude_session_id": "claude-mno345",
        "current_directory": "/Users/dev/project",
        "agent_flags": [],
        "commit_sha": "mno345",
        "branch": "perf/api",
        "created_at": "2024-01-15T11:00:00Z",
        "model": "claude-3-opus"
      }
    ],
    "focusedSession": null,
    "activeSessionId": null
  },
  "delay": 2000
}
```
*Description*: Sessions filtered by status (component-level filtering, not store state).

---

## Session Launcher States

*Note: The session launcher is a separate component not part of the main store. These states would be managed by the launcher component itself.*

### 2.1 New Session Being Created
```json
{
  "state": {
    "sessions": [],
    "focusedSession": null,
    "activeSessionId": null,
    "isLoading": true
  },
  "delay": 1000
}
```
*Description*: State while a new session is being created.

### 2.2 Session Just Created
```json
{
  "state": {
    "sessions": [
      {
        "id": "session-new",
        "query": "Fix the bug in authentication",
        "status": "starting",
        "claude_session_id": null,
        "current_directory": "/Users/dev/project",
        "agent_flags": [],
        "commit_sha": "abc123",
        "branch": "main",
        "created_at": "2024-01-15T12:00:00Z",
        "model": "claude-3-opus"
      }
    ],
    "focusedSession": null,
    "activeSessionId": "session-new",
    "isLoading": false
  },
  "delay": 2000
}
```
*Description*: New session created and added to the list.

---

## Session View States

### 3.1 Empty Session View
```json
{
  "state": {
    "activeSessionId": "session-1",
    "sessions": [{
      "id": "session-1",
      "query": "New session",
      "status": "starting",
      "claude_session_id": null,
      "current_directory": "/Users/dev/project",
      "agent_flags": [],
      "commit_sha": "abc123",
      "branch": "main",
      "created_at": "2024-01-15T10:00:00Z",
      "model": "claude-3-opus"
    }],
    "focusedSession": null
  },
  "delay": 1000
}
```
*Description*: New session with no conversation events yet.

### 3.2 Session with Conversation Events
```json
{
  "state": {
    "activeSessionId": "session-1",
    "sessions": [{
      "id": "session-1",
      "query": "Fix authentication bug",
      "status": "running",
      "claude_session_id": "claude-123",
      "current_directory": "/Users/dev/project",
      "agent_flags": [],
      "commit_sha": "abc123",
      "branch": "main",
      "created_at": "2024-01-15T10:00:00Z",
      "model": "claude-3-opus"
    }]
  },
  "delay": 3000
}
```
*Description*: Active session with conversation events (events are fetched separately via API, not stored in session state).

### 3.3 Session with Code Changes
```json
{
  "state": {
    "activeSessionId": "session-1",
    "sessions": [{
      "id": "session-1",
      "title": "Implement new feature",
      "status": "running",
      "messages": [
        {
          "id": "msg-5",
          "type": "tool_use",
          "tool": "edit_file",
          "arguments": {
            "path": "/src/components/UserProfile.tsx",
            "changes": {
              "before": "const UserProfile = ({ userId }) => {",
              "after": "const UserProfile = ({ userId, showEmail = true }) => {"
            }
          },
          "status": "pending_approval",
          "timestamp": "2024-01-15T10:05:00Z"
        }
      ]
    }]
  },
  "delay": 2000
}
```
*Description*: Session with pending code change approval.

### 3.4 Session with Streaming Response
```json
{
  "state": {
    "activeSessionId": "session-1",
    "sessions": [{
      "id": "session-1",
      "title": "Explain the architecture",
      "status": "running",
      "messages": [
        {
          "id": "msg-6",
          "type": "assistant",
          "content": "Let me explain the application architecture:\n\n1. **Frontend Layer**: The application uses React with TypeScript for type safety. The component structure follows...",
          "isStreaming": true,
          "timestamp": "2024-01-15T10:10:00Z"
        }
      ],
      "streamingProgress": 45
    }]
  },
  "delay": 100
}
```
*Description*: Assistant actively streaming a response.

---

## Approval States

### 4.1 Single Pending Approval
```json
{
  "state": {
    "approvals": [
      {
        "id": "approval-1",
        "callId": "call-abc123",
        "runId": "run-xyz789",
        "type": "function_call",
        "title": "Edit authentication config",
        "description": "Update OAuth redirect URL in /src/config/auth.ts",
        "tool": "Edit",
        "parameters": {
          "file_path": "/src/config/auth.ts",
          "old_string": "redirectUrl: 'http://localhost:3000/callback'",
          "new_string": "redirectUrl: 'https://app.example.com/auth/callback'"
        },
        "createdAt": "2024-01-15T10:15:00Z",
        "sessionId": "session-1",
        "sessionQuery": "Fix authentication bug",
        "sessionModel": "claude-3-opus"
      }
    ]
  },
  "delay": 2000
}
```
*Description*: Single function call (Edit tool) awaiting approval.

### 4.2 Multiple Pending Approvals
```json
{
  "state": {
    "approvals": [
      {
        "id": "approval-1",
        "callId": "call-abc123",
        "runId": "run-xyz789",
        "type": "function_call",
        "title": "Create new test file",
        "description": "Write a new test file",
        "tool": "Write",
        "parameters": {
          "file_path": "/src/tests/auth.test.ts",
          "content": "describe('Authentication', () => { ... })"
        },
        "createdAt": "2024-01-15T10:15:00Z",
        "sessionId": "session-1",
        "sessionQuery": "Add authentication tests",
        "sessionModel": "claude-3-opus"
      },
      {
        "id": "approval-2",
        "callId": "call-def456",
        "runId": "run-xyz789",
        "type": "function_call",
        "title": "Run database migration",
        "description": "Execute npm run migrate:latest",
        "tool": "Bash",
        "parameters": {
          "command": "npm run migrate:latest"
        },
        "createdAt": "2024-01-15T10:16:00Z",
        "sessionId": "session-1",
        "sessionQuery": "Update database schema",
        "sessionModel": "claude-3-opus"
      },
      {
        "id": "approval-3",
        "callId": "call-ghi789",
        "runId": "run-abc456",
        "type": "human_contact",
        "title": "Need clarification",
        "description": "Should I remove the legacy authentication module?",
        "tool": null,
        "parameters": null,
        "createdAt": "2024-01-15T10:17:00Z",
        "sessionId": "session-2",
        "sessionQuery": "Refactor authentication",
        "sessionModel": "claude-3-sonnet"
      }
    ]
  },
  "delay": 2500
}
```
*Description*: Multiple approvals of different types (function_call and human_contact) pending review.

### 4.3 Approval Being Denied
```json
{
  "state": {
    "approvals": [{
      "id": "approval-1",
      "callId": "call-abc123",
      "runId": "run-xyz789",
      "type": "function_call",
      "title": "Update database schema",
      "description": "Modify production database",
      "tool": "Bash",
      "parameters": {
        "command": "psql -c 'ALTER TABLE users ADD COLUMN email_verified BOOLEAN'"
      },
      "createdAt": "2024-01-15T10:15:00Z",
      "sessionId": "session-1",
      "sessionQuery": "Add email verification",
      "sessionModel": "claude-3-opus"
    }]
  },
  "delay": 2000
}
```
*Description*: Approval in the process of being denied (deny form is handled by component state, not store).

### 4.4 Recently Processed Approvals
```json
{
  "state": {
    "approvals": [
      {
        "id": "approval-1",
        "status": "approved",
        "title": "Update API endpoint",
        "approvedAt": "2024-01-15T10:20:00Z",
        "approvedBy": "current_user"
      },
      {
        "id": "approval-2",
        "status": "denied",
        "title": "Delete user data",
        "deniedAt": "2024-01-15T10:18:00Z",
        "deniedBy": "current_user",
        "denyReason": "This would violate data retention policy"
      },
      {
        "id": "approval-3",
        "status": "pending",
        "title": "Install new dependency"
      }
    ]
  },
  "delay": 2000
}
```
*Description*: Mix of approved, denied, and pending approvals.

---

## Notification States

*Note: Toast notifications are handled by Sonner library and not stored in the main app state. These examples show what triggers toasts.*

### 5.1 After Successful Approval
```json
{
  "state": {
    "approvals": [],
    "notifiedItems": ["approval-1-resolved"]
  },
  "delay": 500
}
```
*Description*: State after an approval is processed successfully (toast would be triggered by the action).

### 5.2 After Failed Action
```json
{
  "state": {
    "sessions": [{
      "id": "session-1",
      "query": "Run tests",
      "status": "failed",
      "claude_session_id": "claude-123",
      "current_directory": "/Users/dev/project",
      "agent_flags": [],
      "commit_sha": "abc123",
      "branch": "main",
      "created_at": "2024-01-15T10:00:00Z",
      "model": "claude-3-opus"
    }]
  },
  "delay": 500
}
```
*Description*: Session moved to failed state (error toast would be triggered).

---

## Session Filtering States

*Note: Search and filtering are handled at the component level, not in the store state.*

### 6.1 Sessions with Focus
```json
{
  "state": {
    "sessions": [
      {
        "id": "session-1",
        "query": "Fix authentication bug",
        "status": "completed",
        "claude_session_id": "claude-123",
        "current_directory": "/Users/dev/project",
        "agent_flags": [],
        "commit_sha": "abc123",
        "branch": "main",
        "created_at": "2024-01-15T09:00:00Z",
        "model": "claude-3-opus"
      },
      {
        "id": "session-2",
        "query": "Implement OAuth authentication",
        "status": "running",
        "claude_session_id": "claude-456",
        "current_directory": "/Users/dev/project",
        "agent_flags": [],
        "commit_sha": "def456",
        "branch": "feature/oauth",
        "created_at": "2024-01-15T10:00:00Z",
        "model": "claude-3-opus"
      }
    ],
    "focusedSession": {
      "id": "session-2",
      "query": "Implement OAuth authentication",
      "status": "running",
      "claude_session_id": "claude-456",
      "current_directory": "/Users/dev/project",
      "agent_flags": [],
      "commit_sha": "def456",
      "branch": "feature/oauth",
      "created_at": "2024-01-15T10:00:00Z",
      "model": "claude-3-opus"
    }
  },
  "delay": 1500
}
```
*Description*: Multiple sessions with one focused for keyboard navigation.

---

## Loading States

### 7.1 Initial Loading
```json
{
  "state": {
    "isLoading": true,
    "sessions": [],
    "focusedSession": null,
    "approvals": []
  },
  "delay": 1500
}
```
*Description*: Initial app loading state.

### 7.2 Sessions Loaded
```json
{
  "state": {
    "isLoading": false,
    "sessions": [
      {
        "id": "session-1",
        "query": "Previous work",
        "status": "completed",
        "claude_session_id": "claude-old-123",
        "current_directory": "/Users/dev/project",
        "agent_flags": [],
        "commit_sha": "xyz789",
        "branch": "main",
        "created_at": "2024-01-14T16:00:00Z",
        "model": "claude-3-opus"
      }
    ],
    "focusedSession": null
  },
  "delay": 1000
}
```
*Description*: Sessions loaded from daemon.

---

## Combined Scenario States

### 8.1 Busy Developer Workflow
```json
{
  "state": {
    "sessions": [
      {
        "id": "session-1",
        "query": "Implement user settings",
        "status": "running",
        "claude_session_id": "claude-abc",
        "current_directory": "/Users/dev/project",
        "agent_flags": [],
        "commit_sha": "abc123",
        "branch": "feature/settings",
        "created_at": "2024-01-15T10:00:00Z",
        "model": "claude-3-opus"
      },
      {
        "id": "session-2",
        "query": "Fix critical bug",
        "status": "waiting_input",
        "claude_session_id": "claude-def",
        "current_directory": "/Users/dev/project",
        "agent_flags": [],
        "commit_sha": "def456",
        "branch": "hotfix/bug",
        "created_at": "2024-01-15T10:30:00Z",
        "model": "claude-3-sonnet"
      }
    ],
    "focusedSession": null,
    "activeSessionId": "session-1",
    "approvals": [
      {
        "id": "approval-1",
        "callId": "call-xyz",
        "runId": "run-def",
        "type": "function_call",
        "title": "Fix null pointer exception",
        "description": "Update error handling",
        "tool": "Edit",
        "parameters": {
          "file_path": "/src/utils/validator.ts",
          "old_string": "return obj.value",
          "new_string": "return obj?.value || default"
        },
        "createdAt": "2024-01-15T10:35:00Z",
        "sessionId": "session-2",
        "sessionQuery": "Fix critical bug",
        "sessionModel": "claude-3-sonnet"
      }
    ],
    "notifiedItems": ["approval-1-new"]
  },
  "delay": 3000
}
```
*Description*: Multiple active sessions with pending approval notification.

### 8.2 Code Review Scenario
```json
{
  "state": {
    "activeSessionId": "session-1",
    "sessions": [{
      "id": "session-1",
      "query": "Refactor payment module",
      "status": "waiting_input",
      "claude_session_id": "claude-review-123",
      "current_directory": "/Users/dev/project",
      "agent_flags": [],
      "commit_sha": "review123",
      "branch": "refactor/payments",
      "created_at": "2024-01-15T11:00:00Z",
      "model": "claude-3-opus"
    }],
    "focusedSession": null,
    "approvals": [
      {
        "id": "approval-review-1",
        "callId": "call-review",
        "runId": "run-review",
        "type": "function_call",
        "title": "Refactor payment processor",
        "description": "Update payment module structure",
        "tool": "MultiEdit",
        "parameters": {
          "file_path": "/src/payments/processor.ts",
          "edits": [
            {"old_string": "// old code", "new_string": "// new code"},
            {"old_string": "// more old", "new_string": "// more new"}
          ]
        },
        "createdAt": "2024-01-15T11:05:00Z",
        "sessionId": "session-1",
        "sessionQuery": "Refactor payment module",
        "sessionModel": "claude-3-opus"
      }
    ]
  },
  "delay": 2500
}
```
*Description*: Session with pending MultiEdit approval for code review.

### 8.3 Multi-session State
```json
{
  "state": {
    "sessions": [
      { 
        "id": "s1", 
        "query": "Morning standup prep", 
        "status": "completed",
        "claude_session_id": "claude-s1",
        "current_directory": "/Users/dev/project",
        "agent_flags": [],
        "commit_sha": "s1hash",
        "branch": "main",
        "created_at": "2024-01-15T08:00:00Z",
        "model": "claude-3-haiku"
      },
      { 
        "id": "s2", 
        "query": "Debug API timeout", 
        "status": "running",
        "claude_session_id": "claude-s2",
        "current_directory": "/Users/dev/project",
        "agent_flags": [],
        "commit_sha": "s2hash",
        "branch": "fix/timeout",
        "created_at": "2024-01-15T09:00:00Z",
        "model": "claude-3-opus"
      },
      { 
        "id": "s3", 
        "query": "Write unit tests", 
        "status": "running",
        "claude_session_id": "claude-s3",
        "current_directory": "/Users/dev/project",
        "agent_flags": [],
        "commit_sha": "s3hash",
        "branch": "tests",
        "created_at": "2024-01-15T10:00:00Z",
        "model": "claude-3-sonnet"
      },
      { 
        "id": "s4", 
        "query": "Update documentation", 
        "status": "starting",
        "claude_session_id": null,
        "current_directory": "/Users/dev/project",
        "agent_flags": [],
        "commit_sha": "s4hash",
        "branch": "docs",
        "created_at": "2024-01-15T11:00:00Z",
        "model": "claude-3-opus"
      }
    ],
    "focusedSession": { 
      "id": "s2", 
      "query": "Debug API timeout", 
      "status": "running",
      "claude_session_id": "claude-s2",
      "current_directory": "/Users/dev/project",
      "agent_flags": [],
      "commit_sha": "s2hash",
      "branch": "fix/timeout",
      "created_at": "2024-01-15T09:00:00Z",
      "model": "claude-3-opus"
    },
    "activeSessionId": "s2",
    "approvals": [
      {
        "id": "a1",
        "callId": "call-a1",
        "runId": "run-s3",
        "type": "function_call",
        "title": "Write test file",
        "description": "Create user.test.ts",
        "tool": "Write",
        "parameters": {"file_path": "/tests/user.test.ts", "content": "// test content"},
        "createdAt": "2024-01-15T10:30:00Z",
        "sessionId": "s3",
        "sessionQuery": "Write unit tests",
        "sessionModel": "claude-3-sonnet"
      },
      {
        "id": "a2",
        "callId": "call-a2",
        "runId": "run-s3",
        "type": "function_call",
        "title": "Write another test",
        "description": "Create auth.test.ts",
        "tool": "Write",
        "parameters": {"file_path": "/tests/auth.test.ts", "content": "// test content"},
        "createdAt": "2024-01-15T10:35:00Z",
        "sessionId": "s3",
        "sessionQuery": "Write unit tests",
        "sessionModel": "claude-3-sonnet"
      }
    ],
    "notifiedItems": ["a1-new", "a2-new"]
  },
  "delay": 4000
}
```
*Description*: Power user with multiple sessions and pending approvals.

### 8.4 Demo Completion State
```json
{
  "state": {
    "sessions": [
      {
        "id": "demo-session",
        "query": "Deploy new user feature",
        "status": "completed",
        "claude_session_id": "claude-demo-complete",
        "current_directory": "/Users/dev/project",
        "agent_flags": [],
        "commit_sha": "deploy123",
        "branch": "feature/users",
        "created_at": "2024-01-15T11:00:00Z",
        "model": "claude-3-opus"
      }
    ],
    "focusedSession": null,
    "activeSessionId": "demo-session",
    "approvals": [],
    "notifiedItems": ["demo-session-completed"]
  },
  "delay": 5000
}
```
*Description*: Successfully completed session (success notifications handled by UI).

---

## Usage Examples

### Creating a Demo Sequence
```typescript
import { SessionStatus } from '@/lib/daemon/types'

const newFeatureDemo: AnimationStep[] = [
  // Start with empty state
  { state: { sessions: [], focusedSession: null }, delay: 1000 },
  
  // Session created
  { 
    state: { 
      sessions: [{
        id: 'demo-1',
        query: 'Fix authentication bug',
        status: SessionStatus.Starting,
        claude_session_id: null,
        // ... other required fields
      }],
      activeSessionId: 'demo-1'
    }, 
    delay: 2000 
  },
  
  // Session running
  { 
    state: { 
      sessions: [{
        id: 'demo-1',
        query: 'Fix authentication bug',
        status: SessionStatus.Running,
        claude_session_id: 'claude-123',
        // ... other fields
      }]
    }, 
    delay: 3000 
  },
  
  // Approval needed
  { 
    state: { 
      sessions: [{
        id: 'demo-1',
        status: SessionStatus.WaitingInput,
        // ... other fields
      }],
      approvals: [{
        id: 'approval-1',
        type: 'function_call',
        // ... approval details
      }]
    }, 
    delay: 2000 
  },
  
  // Final state
  { 
    state: { 
      sessions: [{
        id: 'demo-1',
        status: SessionStatus.Completed,
        // ... other fields
      }],
      approvals: []
    }, 
    delay: 5000 
  }
]
```

### Loading from JSON
```typescript
// marketing-site/demos/authentication-fix.json
{
  "name": "Authentication Bug Fix Demo",
  "duration": 45000,
  "steps": [
    { "stateRef": "emptySessionTable", "delay": 2000 },
    { "stateRef": "launcherOpen", "delay": 1500 },
    { "state": { /* custom state */ }, "delay": 3000 }
  ]
}
```

---

## Notes for Marketing Team

1. **Timing is Critical**: Delays should feel natural - not too fast, not too slow
2. **Tell a Story**: Each sequence should demonstrate a clear workflow
3. **Show Value**: Highlight time savings, error prevention, and ease of use
4. **Keep it Realistic**: Use believable file names, error messages, and scenarios
5. **Test on Different Speeds**: Some users may have slow connections
6. **Accessibility**: Ensure animations can be paused/played with keyboard

## Extending States

To add new states:
1. Identify all UI elements that change
2. Capture the complete state object
3. Add meaningful description
4. Test the state in isolation
5. Verify it works in sequences

Remember: The goal is to show real workflows that developers experience daily, making the demo relatable and compelling.