# LangGraph and HumanLayer

This repository demonstrates how to integrate human-in-the-loop approval workflows using [LangGraph](https://github.com/langchain-ai/langgraph) and [HumanLayer](https://humanlayer.dev).

## Quick Start

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Copy dotenv.example and/or set environment variables:
```bash
export OPENAI_API_KEY=your_key_here
export HUMANLAYER_API_KEY=your_key_here
```

3. Run either example:
```bash
# Script version
python 01-research-approval.py

# FastAPI server
python 01-research-approval-fastapi.py
```

## Integration Patterns

There are several ways to integrate HumanLayer with LangGraph workflows:

### 1. As a Node in StateGraph

The script example (`01-research-approval.py`) demonstrates using HumanLayer as a node in a LangGraph `StateGraph`:

```python
def human_approval_node(state: ResearchState):
    if state["complexity"] in ["medium", "complex"]:
        try:
            research_approval(
                query=state["query"],
                complexity=state["complexity"],
                proposed_path=proposed_path
            )
            state["current_path"] = proposed_path
        except HumanLayerException as e:
            state["final_result"] = f"Research rejected: {str(e)}"
            return END
    return state

graph.add_node("human_approval", human_approval_node)
```

This pattern is useful when:
- You need synchronous approval workflows
- The graph should wait for human input before proceeding
- You want to visualize the entire workflow as a graph

### 2. As an Async Service with NodeInterrupt

The FastAPI example (`01-research-approval-fastapi.py`) shows how to use HumanLayer with `NodeInterrupt` for asynchronous workflows:

```python
@app.post("/research")
async def research_endpoint(query: str):
    try:
        research_approval(query=query)
        raise NodeInterrupt("Waiting for approval")
    except NodeInterrupt:
        return {"status": "pending", "message": "Waiting for approval"}
```

This pattern is ideal when:
- You need asynchronous, non-blocking approvals
- Your application needs to handle multiple concurrent requests
- You want to integrate with web services or APIs

### 3. As a Custom Subgraph (Future)

HumanLayer could be integrated as a custom subgraph in LangGraph, similar to other built-in tools:

```python
from humanlayer_langgraph import HumanLayerGraph

# Future API concept
approval_subgraph = HumanLayerGraph(
    approval_type="research",
    reject_options=reject_options,
    webhook_config={...}
)

main_graph.add_subgraph("approval", approval_subgraph)
```

This pattern would offer:
- Reusable approval workflows
- Built-in state management
- Automatic webhook handling
- Integration with LangGraph's tooling ecosystem

## Webhook Integration

HumanLayer's webhook feature enables asynchronous workflow resumption. When configured, HumanLayer sends approval decisions to your endpoint:

```python
@app.post("/webhook/inbound")
async def webhook_inbound(webhook: dict):
    event = webhook['event']
    if event['status'].get('approved'):
        # Resume workflow with approved state
        return await process_research(state)
    else:
        # Handle rejection
        return {"status": "rejected"}
```

## State Management

Both examples use TypedDict for state management:

```python
class ResearchState(TypedDict):
    query: str
    findings: List[str]
    complexity: str
    current_path: str
    final_result: str
    thread_id: str
```

The script version manages state through the graph, while the FastAPI version reconstructs state from webhook data.

## Future Development

The integration patterns shown here could evolve into a `humanlayer_langgraph` library providing:

1. **Custom Node Types**
   - Pre-built approval nodes
   - State management helpers
   - Webhook handlers

2. **Graph Components**
   - Reusable approval subgraphs
   - Custom edge conditions
   - State validation

3. **Tools Integration**
   - LangGraph tool compatibility
   - Custom tool factories
   - Built-in logging and monitoring
