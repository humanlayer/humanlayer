# HumanLayer Go SDK

A minimal, idiomatic Go client for HumanLayer API, designed for the TUI and other Go applications.

## Design Principles

1. **Minimal Surface Area** - Only implement what's needed
2. **Idiomatic Go** - Follow Go conventions, not generated code patterns
3. **No Code Generation** - Hand-written for clarity and simplicity
4. **Context-First** - Use context.Context for cancellation and timeouts
5. **Functional Options** - Clean configuration pattern

## Installation

```bash
go get github.com/humanlayer/humanlayer-go
```

## Usage

```go
package main

import (
    "context"
    "log"
    
    "github.com/humanlayer/humanlayer-go"
)

func main() {
    // Create client with options
    client, err := humanlayer.NewClient(
        humanlayer.WithAPIKey("your-api-key"),
        humanlayer.WithBaseURL("https://api.humanlayer.dev"),
    )
    if err != nil {
        log.Fatal(err)
    }
    
    ctx := context.Background()
    
    // Get pending approvals
    approvals, err := client.GetPendingApprovals(ctx)
    if err != nil {
        log.Fatal(err)
    }
    
    // Approve a request
    err = client.ApproveRequest(ctx, approvals[0].ID, &humanlayer.ApprovalResponse{
        Approved: true,
        Comment:  "Looks good",
    })
    
    // Get human contacts
    contacts, err := client.GetPendingHumanContacts(ctx)
    if err != nil {
        log.Fatal(err)
    }
    
    // Respond to human contact
    err = client.RespondToHumanContact(ctx, contacts[0].ID, "Use RS256 for consistency")
}
```

## API Coverage

### Core Operations
- [x] GetPendingApprovals
- [x] GetPendingHumanContacts
- [x] ApproveRequest
- [x] DenyRequest
- [x] RespondToHumanContact

### Future (as needed)
- [ ] WebSocket support for real-time updates
- [ ] Batch operations
- [ ] Channel configuration