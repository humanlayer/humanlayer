"""Subgraph implementation for HumanLayer LangGraph integration."""

import logging
from typing import TypedDict, Optional

from humanlayer import HumanLayer
from langchain_core.messages import AnyMessage
from langchain_core.tools import BaseTool

from .nodes import HumanLayerToolNode, HumanApprovalNode, HumanInputNode

logger = logging.getLogger(__name__)


class HumanLayerSubgraphState(TypedDict):
    """State for the HumanLayer subgraph."""

    messages: list[AnyMessage]
    thread_id: str
    require_approval: bool


def build_humanlayer_subgraph(
    tools: list[BaseTool],
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


def create_humanlayer_node(
    tools: list[BaseTool],
    human_layer: HumanLayer,
    require_approval: bool = True,
) -> HumanLayerToolNode:
    """Create a HumanLayer tool node.

    Alias for build_humanlayer_subgraph.

    Args:
        tools: List of tools to use
        human_layer: HumanLayer instance for human interaction
        require_approval: Whether to require human approval before executing tools

    Returns:
        A HumanLayerToolNode that can be used in a LangGraph
    """
    return build_humanlayer_subgraph(tools, human_layer, require_approval)


def create_human_approval_node(
    human_layer: HumanLayer,
    message_template: str = "Please approve this action: {action}",
    timeout: Optional[int] = 300,
) -> HumanApprovalNode:
    """Create a node that requests human approval before proceeding.

    Args:
        human_layer: The HumanLayer instance to use
        message_template: Template for the approval message
        timeout: Timeout in seconds for the approval request

    Returns:
        A HumanApprovalNode that can be used in a LangGraph
    """
    logger.info("Creating human approval node")
    return HumanApprovalNode(
        human_layer=human_layer,
        message_template=message_template,
        timeout=timeout,
    )


def create_human_input_node(
    human_layer: HumanLayer,
    prompt_template: str = "Please provide input: {prompt}",
    timeout: Optional[int] = 300,
    response_key: str = "_humanlayer_input",
) -> HumanInputNode:
    """Create a node that requests human input.

    Args:
        human_layer: The HumanLayer instance to use
        prompt_template: Template for the input prompt
        timeout: Timeout in seconds for the input request
        response_key: Key to store the input in the state

    Returns:
        A HumanInputNode that can be used in a LangGraph
    """
    logger.info("Creating human input node")
    return HumanInputNode(
        human_layer=human_layer,
        prompt_template=prompt_template,
        timeout=timeout,
        response_key=response_key,
    )
