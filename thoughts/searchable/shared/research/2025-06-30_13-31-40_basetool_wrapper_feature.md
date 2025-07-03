---
date: 2025-06-30 13:31:40 PDT
researcher: allison
git_commit: 097c6626056b89a26d52547eb9de5babece75959
branch: claude/issue-258-20250630_191418
repository: humanlayer
topic: "BaseTool Wrapper Feature for LangChain/CrewAI Integration"
tags: [research, codebase, langchain, crewai, basetool, integration, issue-92]
status: complete
last_updated: 2025-06-30
last_updated_by: allison
---

# Research: BaseTool Wrapper Feature for LangChain/CrewAI Integration

**Date**: 2025-06-30 13:31:40 PDT
**Researcher**: allison
**Git Commit**: 097c6626056b89a26d52547eb9de5babece75959
**Branch**: claude/issue-258-20250630_191418
**Repository**: humanlayer

## Research Question
GitHub Issue #92 requests a feature to wrap existing BaseTool objects from frameworks like LangChain and CrewAI with HumanLayer approval. The user wants to avoid "jumping through hoops" to apply approval to existing tool instances.

## Summary
The requested feature is **highly feasible** and would provide significant value. Currently, users must manually create wrapper classes or rewrite tools as decorated functions to add HumanLayer approval. A built-in `wrap_tool()` method could leverage the existing `HumanLayerWrapper` infrastructure to dynamically wrap tool objects while preserving their functionality and metadata.

## Detailed Findings

### Current HumanLayer Wrapper System
- `HumanLayerWrapper` class provides flexible wrapping infrastructure (`humanlayer/core/approval.py:59-72`)
- Supports both direct decoration and explicit wrapping via `.wrap()` method
- Uses `@wraps` decorator to preserve function metadata (`humanlayer/core/approval.py:191,237`)
- Handles both sync and async operations (`humanlayer/core/async_approval.py:38-54`)

### LangChain Integration Patterns
Current approach requires manual conversion:
- Users decorate Python functions with `@hl.require_approval()`
- Must use `langchain.tools.StructuredTool.from_function()` for each function
- No direct support for wrapping existing `BaseTool` instances
- Examples show consistent pattern but significant boilerplate (`examples/langchain/01-math_example.py:28-37`)

### CrewAI Integration Patterns
Similar manual approach:
- Stack `@tool` and `@hl.require_approval()` decorators
- Works cleanly but only for new tool definitions
- Cannot wrap existing CrewAI tool instances
- Pattern shown in `examples/crewai/crewai_math.py:24-28`

### Pain Points Identified
1. **Double Definition**: Tool schemas defined twice (framework + HumanLayer)
2. **Manual Wrapping**: Each function needs individual wrapping
3. **No Tool Instance Support**: Cannot wrap existing tool objects from toolkits
4. **Framework Knowledge Required**: Users need deep understanding of each framework
5. **Type Safety Loss**: Wrapping process often loses type information

### PR #129 Pattern
Established framework-specific package approach:
- Created `humanlayer-ts-vercel-ai-sdk` as separate package
- Provides framework-native API that wraps core functionality
- Lives in own directory with separate npm publication
- Pattern could be applied to Python frameworks

## Code References
- `humanlayer/core/approval.py:59-72` - HumanLayerWrapper class definition
- `humanlayer/core/approval.py:153-174` - require_approval() method implementation
- `examples/langchain/01-math_example.py:28-37` - Current LangChain integration pattern
- `examples/crewai/crewai_math.py:24-28` - Current CrewAI integration pattern
- `humanlayer-ts-vercel-ai-sdk/src/approval.ts` - Framework-specific package example

## Architecture Insights

### Proposed Implementation Approaches

**Option 1: Core Method Enhancement**
Add `wrap_tool()` method to main `HumanLayer` class:
```python
def wrap_tool(self, tool: Any, **approval_kwargs) -> Any:
    """Wrap an existing framework tool with approval."""
    # Detect tool type (LangChain BaseTool, CrewAI tool, etc.)
    # Create dynamic wrapper class preserving tool interface
    # Override execution method (_run, execute, etc.) with approval
    # Return wrapped tool maintaining original type
```

**Option 2: Framework-Specific Packages**
Following PR #129 pattern:
- `humanlayer-langchain/` - LangChain-specific integrations
- `humanlayer-crewai/` - CrewAI-specific integrations
- Each provides native APIs for that framework

### Technical Feasibility
1. **Tool Method Interception**: Both frameworks have predictable execution methods (`_run()`, `execute()`)
2. **Metadata Preservation**: Can use class inheritance to maintain tool properties
3. **Type Safety**: Python's dynamic nature allows runtime class generation
4. **Existing Infrastructure**: `HumanLayerWrapper` already handles function wrapping logic

## Historical Context (from thoughts/)
- HumanLayer designed for framework integration from the start
- Decorator patterns chosen for flexibility
- Framework compatibility issues acknowledged (exception handling)
- No prior discussion found about wrapping external tool objects

## Related Research
- PR #129 established pattern for framework-specific packages
- Vercel AI SDK integration shows successful framework-native approach

## Open Questions
1. Should this be a core feature or framework-specific package?
2. How to handle tools with multiple execution methods?
3. Should wrapped tools maintain exact type signatures or use duck typing?
4. How to handle tool-specific features like async execution or streaming?

## Recommendation
Start with **Option 1** (core method) for faster adoption and broader compatibility. This would add a `wrap_tool()` method that:
1. Detects framework type via duck typing
2. Creates dynamic wrapper class inheriting from original
3. Overrides execution method with approval logic
4. Returns wrapped instance maintaining framework compatibility

If demand grows, consider **Option 2** for deeper framework-specific integrations.