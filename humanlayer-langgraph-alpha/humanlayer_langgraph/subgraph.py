"""Subgraph implementation for HumanLayer LangGraph integration."""

import logging
from typing import List, Dict, Any, TypedDict, Callable, Optional
from humanlayer import HumanLayer
from langchain_core.tools import BaseTool
from langchain_core.messages import AIMessage, ToolMessage, HumanMessage, AnyMessage
from langgraph.graph import END, START, StateGraph

from .nodes import HumanLayerToolNode

logger = logging.getLogger(__name__)


class HumanLayerSubgraphState(TypedDict):
    """State for the HumanLayer subgraph."""
    messages: List[AnyMessage]
    thread_id: str
    require_approval: bool


def build_humanlayer_subgraph(
    tools: List[BaseTool],
    human_layer: HumanLayer,
    require_approval: bool = True,
) -> HumanLayerToolNode:
    """Build a HumanLayer tool node for LangGraph.
    
    This creates a HumanLayerToolNode that manages tool execution with human approval.
    
    Args:
        tools: List of tools to use
        human_layer: HumanLayer instance for human interaction
        require_approval: Whether to require human approval before executing tools
        
    Returns:
        A HumanLayerToolNode that can be used in a LangGraph
    """
    logger.info("Building HumanLayer tool node with approval requirement: %s", require_approval)
    
    # Create HumanLayerToolNode with approval requirements
    tool_node = HumanLayerToolNode(
        tools=tools,
        human_layer=human_layer,
        require_approval=require_approval,
    )
    
    # Log the configured approval status
    if require_approval:
        logger.info("Human approval will be required before any tool execution")
    else:
        logger.info("Tools will execute without requiring human approval")
    
    return tool_node