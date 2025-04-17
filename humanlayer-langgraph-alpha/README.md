# HumanLayer for LangGraph

[![PyPI version](https://badge.fury.io/py/humanlayer-langgraph-alpha.svg)](https://badge.fury.io/py/humanlayer-langgraph-alpha)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An integration package for using [HumanLayer](https://humanlayer.com) with [LangGraph](https://github.com/langchain-ai/langgraph) to build human-in-the-loop agents.

## Installation

```bash
pip install humanlayer-langgraph-alpha
```

## Features

- Seamlessly integrate HumanLayer with LangGraph agents
- Log tool calls and results to HumanLayer
- Request human approval for critical actions
- Collect human input within agent workflows
- Build complete human-in-the-loop subgraphs

## Quick Start

```python
from humanlayer import HumanLayer
from humanlayer_langgraph import build_humanlayer_subgraph
from langchain_core.tools import tool
from langgraph.graph import StateGraph
from langgraph.graph import MessagesState

# Initialize HumanLayer
hl = HumanLayer(run_id="my-agent-run")

# Define your tools
@tool
def get_weather(location: str):
    """Get the current weather for a location."""
    return f"The weather in {location} is sunny."

# Build your graph
graph_builder = StateGraph(MessagesState)

# Create a HumanLayer-integrated tool node
tools_node = build_humanlayer_subgraph([get_weather], hl)

# Add the node to your graph
graph_builder.add_node("tools", tools_node)
```

## Human Approval Workflows

For critical actions, you can require human approval:

```python
from humanlayer_langgraph import create_human_approval_node

# Create a node that requires human approval
approval_node = create_human_approval_node(
    human_layer=hl,
    message_template="Please approve this action: {action}",
    timeout=300  # 5 minutes
)

# Add the node to your graph
graph_builder.add_node("human_approval", approval_node)

# Add conditional edges
graph_builder.add_conditional_edges(
    "chatbot",
    lambda state: "requires_approval" if needs_approval(state) else "direct_execution",
    {
        "requires_approval": "human_approval",
        "direct_execution": "tools"
    }
)
```

## Human Input Collection

Collect input from humans during agent execution:

```python
from humanlayer_langgraph import create_human_input_node

# Create a node that requests human input
input_node = create_human_input_node(
    human_layer=hl,
    prompt_template="Please provide input: {prompt}",
    timeout=300
)

# Add the node to your graph
graph_builder.add_node("human_input", input_node)
```

## Examples

See the `examples/` directory for complete examples of HumanLayer integration with LangGraph. You can run the examples with:

```bash
make run-examples
```

## Development

### Setting Up Development Environment

1. Clone the repository:
   ```bash
   git clone https://github.com/humanlayer/humanlayer-langgraph-alpha.git
   cd humanlayer-langgraph-alpha
   ```

2. Create a virtual environment and install development dependencies:
   ```bash
   make setup-dev
   ```

3. Run the tests:
   ```bash
   make test
   ```

### Development Commands

- `make format`: Format code with black
- `make lint`: Run linters (ruff, mypy)
- `make test`: Run tests
- `make run-examples`: Run example scripts
- `make clean`: Clean build artifacts
- `make build`: Build package

## Publishing

### Local Publishing

To release a new version:

1. Bump the version (patch, minor, or major):
   ```bash
   make bump-patch  # or bump-minor, bump-major
   ```

2. Build and publish:
   ```bash
   make publish  # or publish-test for TestPyPI
   ```

### GitHub Actions

This package uses GitHub Actions to automate the release process:

1. Go to the "Actions" tab in the GitHub repository
2. Select the "Publish Package" workflow
3. Click "Run workflow"
4. Select the release type (patch, minor, or major)
5. Click "Run workflow"

The action will:
- Run tests
- Bump the version
- Build the package
- Push the new tag
- Publish to PyPI

## Documentation

Full documentation is available at [docs.humanlayer.com](https://docs.humanlayer.com).

## License

MIT
