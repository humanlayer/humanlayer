---
date: 2025-06-24 08:57:54 PDT
researcher: allison
git_commit: 1de077e72067885e0a999eef9de08f10703e0821
branch: summary
repository: humanlayer
topic: "Why Async/Sync Duplication is a Necessary Evil in HumanLayer"
tags: [research, codebase, architecture]
status: complete
last_updated: 2025-06-24
last_updated_by: allison
---

# Research: Why Async/Sync Duplication is a Necessary Evil in HumanLayer

**Date**: 2025-06-24 08:57:54 PDT
**Researcher**: allison
**Git Commit**: 1de077e72067885e0a999eef9de08f10703e0821
**Branch**: summary
**Repository**: humanlayer
## Research Question

Why is the async/sync duplication in HumanLayer considered a necessary evil? Are there any alternatives to avoid the duplication?

## Summary

The async/sync duplication in HumanLayer is a deliberate architectural decision driven by the need to support diverse AI frameworks with different concurrency models. While the codebase maintains completely separate implementations for sync and async versions (leading to significant code duplication), this approach ensures maximum compatibility, type safety, and performance without introducing runtime overhead or complexity from conversion layers.

## Detailed Findings

### Current Implementation Pattern

HumanLayer maintains two separate but nearly identical implementations:

- Sync versions: `approval.py`, `cloud.py`, `protocol.py`
- Async versions: `async_approval.py`, `async_cloud.py`, `async_protocol.py`
- Total duplication: ~1,500 lines of code across core modules

### Framework Compatibility Requirements

The SDK must support frameworks with different concurrency models:

- **Sync-only frameworks**: LangChain, CrewAI, ControlFlow, Griptape
- **Async-required frameworks**: FastAPI, Chainlit, async OpenAI client
- **TypeScript SDK**: Inherently async (Promise-based)

### Why It's a "Necessary Evil"

1. **Framework Diversity**: Different AI frameworks have incompatible expectations:

   - Some frameworks (CrewAI, ControlFlow) don't support async operations
   - Others (FastAPI, Chainlit) require async for proper integration
   - No single implementation can satisfy both without compromising

2. **Developer Experience**:

   - Clean, intuitive API for each use case
   - No need for developers to understand sync/async conversion
   - Type hints work correctly without complex generic types

3. **Performance Considerations**:

   - No runtime overhead from sync/async conversion
   - Each version optimized for its execution model
   - Avoids blocking event loops or creating unnecessary threads

4. **Feature Parity Limitations**:
   - AsyncHumanLayer requires cloud backend (no CLI approval support)
   - This is due to the complexity of async terminal I/O
   - Trade-off between feature completeness and clean async implementation

### Alternatives Considered

#### 1. **Sync-to-Async Adapters** (e.g., `asgiref`, `nest_asyncio`)

- **Pros**: Single implementation, automatic conversion
- **Cons**:
  - Runtime overhead
  - Complex debugging (stack traces through adapters)
  - Type hint complications
  - Potential event loop conflicts

#### 2. **Code Generation**

- **Pros**: Single source of truth, guaranteed consistency
- **Cons**:
  - Build complexity
  - Harder to debug generated code
  - Less flexibility for version-specific optimizations

#### 3. **Asyncio.run() Wrapping**

- **Pros**: Simple implementation
- **Cons**:
  - Creates new event loops (performance impact)
  - Doesn't work well with existing event loops
  - Poor integration with async frameworks

#### 4. **Single Async Implementation**

- **Pros**: No duplication
- **Cons**:
  - Forces sync users to deal with async complexity
  - Requires all users to understand asyncio
  - Poor ergonomics for sync-only frameworks

## Code References

- `humanlayer/core/approval.py:1-520` - Sync implementation
- `humanlayer/core/async_approval.py:1-404` - Async implementation
- `humanlayer/core/async_approval.py:80-83` - AsyncHumanLayer limitation (no CLI support)
- `examples/langchain/01-math_example.py` - Sync framework usage
- `examples/fastapi/app.py` - Async framework usage

## Architecture Insights

1. **Shared models** (`models.py`) reduce duplication where possible
2. **Consistent API design** makes manual synchronization manageable
3. **Clear separation** allows each version to be optimized independently
4. **Type safety** maintained without complex generic types or unions

## Historical Context (from thoughts/)

- Multi-framework support was a core design goal from the beginning
- The architecture supports multiple transports (Unix sockets, HTTP, WebSockets)
- Developer experience ("2-3 second approval cycles") was prioritized
- No complaints about maintenance burden found in historical discussions

## Related Research

None found in thoughts/shared/research/

## Open Questions

1. Could a hybrid approach work where only the I/O layer is duplicated?
2. Would Python 3.12+ improvements to asyncio enable better solutions?
3. Could type stubs or protocols reduce the duplication while maintaining type safety?
4. Is there a way to support CLI approvals in the async version without blocking?

## Conclusion

The async/sync duplication in HumanLayer appears to be a pragmatic engineering decision that prioritizes developer experience and framework compatibility over code reuse. While it creates maintenance overhead, it provides the best possible integration with diverse AI frameworks without compromising performance or type safety. The "necessary evil" label is apt - it's not ideal from a pure software engineering perspective, but it's the most practical solution given the constraints of the Python ecosystem and the diverse requirements of AI framework integrations.
