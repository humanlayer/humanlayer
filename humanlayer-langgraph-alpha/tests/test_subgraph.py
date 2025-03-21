"""Tests for the HumanLayer LangGraph integration."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from typing import Dict, Any, List

from humanlayer import HumanLayer
from langchain_core.tools import BaseTool
from langgraph.prebuilt import ToolNode

from humanlayer_langgraph import (
    build_humanlayer_subgraph,
    create_human_approval_node,
    create_human_input_node,
)
from humanlayer_langgraph.nodes import (
    HumanLayerToolNode,
    HumanApprovalNode,
    HumanInputNode,
)


class TestTool(BaseTool):
    """A test tool that returns the input."""
    
    name: str = "test_tool"
    description: str = "A test tool that returns the input."
    
    def _run(self, input_str: str) -> str:
        """Process the input string.
        
        Args:
            input_str: The input to process.
            
        Returns:
            The processed input.
        """
        return f"Processed: {input_str}"
    
    async def _arun(self, input_str: str) -> str:
        """Process the input string asynchronously."""
        return self._run(input_str)


class MockHumanLayerResponse:
    """Mock response for HumanLayer methods."""
    
    def __init__(self, approved=True, response="Test response", feedback="Test feedback"):
        self.approved = approved
        self.response = response
        self.feedback = feedback
        self.timestamp = "2024-01-01T00:00:00Z"


@pytest.mark.asyncio
async def test_build_humanlayer_subgraph():
    """Test building a HumanLayer subgraph."""
    # Create a mock HumanLayer instance
    mock_hl = MagicMock(spec=HumanLayer)
    mock_hl.run_id = "test-run-id"
    mock_hl.log_tool_call = AsyncMock()
    mock_hl.log_tool_result = AsyncMock()
    
    # Create the subgraph
    tools = [test_tool]
    node = build_humanlayer_subgraph(tools, mock_hl)
    
    # Verify the node is created
    assert isinstance(node, HumanLayerToolNode)
    
    # Test invoking the node
    test_state = {"input": "test input"}
    result = await node.ainvoke(test_state)
    
    # Verify the expected calls
    mock_hl.log_tool_call.assert_called_once()
    mock_hl.log_tool_result.assert_called_once()


@pytest.mark.asyncio
async def test_human_approval_node():
    """Test the human approval node."""
    # Create a mock HumanLayer instance
    mock_hl = MagicMock(spec=HumanLayer)
    mock_hl.run_id = "test-run-id"
    mock_hl.require_approval = AsyncMock(return_value=MockHumanLayerResponse(approved=True))
    
    # Create the approval node
    node = create_human_approval_node(mock_hl)
    
    # Test invoking the node
    test_state = {"action": "test action"}
    result = await node.ainvoke(test_state)
    
    # Verify the result contains approval info
    assert "_humanlayer_approval" in result
    assert result["_humanlayer_approval"]["approved"] is True
    assert "feedback" in result["_humanlayer_approval"]
    
    # Verify the HumanLayer methods were called
    mock_hl.require_approval.assert_called_once()


@pytest.mark.asyncio
async def test_human_input_node():
    """Test the human input node."""
    # Create a mock HumanLayer instance
    mock_hl = MagicMock(spec=HumanLayer)
    mock_hl.run_id = "test-run-id"
    mock_hl.request_human_input = AsyncMock(return_value=MockHumanLayerResponse(response="User input"))
    
    # Create the input node
    node = create_human_input_node(mock_hl)
    
    # Test invoking the node
    test_state = {"prompt": "Please provide input"}
    result = await node.ainvoke(test_state)
    
    # Verify the result contains input info
    assert "_humanlayer_input" in result
    assert result["_humanlayer_input"]["response"] == "Test response"
    
    # Verify the HumanLayer methods were called
    mock_hl.request_human_input.assert_called_once()