# HumanLayer Daemon (HLD) Documentation

This directory contains the architecture and API documentation for the HumanLayer Daemon.

## Contents

- [Architecture Overview](./architecture.md) - System design and key decisions
- [OpenAPI Specification](./openapi.yaml) - REST API specification
- [Event System](./events.md) - Server-Sent Events architecture
- [Cloud Sync Design](./cloud-sync.md) - Hybrid deployment architecture
- [JSON-RPC Protocol](./jsonrpc-protocol.md) - Current protocol documentation
- [Design Rationale](./design-rationale.md) - Why these technical choices + future vision
- [Approval Flow Diagrams](./approval-flow-diagrams.md) - Visual sequence diagrams

## Quick Start

The HumanLayer Daemon (HLD) is the central component that:

- Manages Claude Code sessions
- Handles approval workflows with rich context
- Provides real-time event streaming
- Supports local, self-hosted, and cloud-sync deployment modes

### Deployment Modes

1. **Local Mode** - Daemon runs on localhost:7777
2. **Self-Hosted Mode** - Access daemon from local network devices
3. **Cloud Sync Mode** - Daemon pushes to cloud for remote access
4. **Cloud Native Mode** - Future: Agents run entirely in cloud

### Key Features

- REST API with OpenAPI specification
- Server-Sent Events for real-time updates
- Automatic context enrichment for approvals
- Modified approval support (edit parameters before approving)
- Auto-approval rules and session settings
- Session interruption support (graceful shutdown)
- Schema-based responses for flexibility
- Multi-language client generation from OpenAPI spec
