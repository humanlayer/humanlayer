"""Core functionality for HumanLayer LangGraph integration."""

import logging
from typing import List, Dict, Any, Optional, Callable
from langchain_core.tools import BaseTool
from humanlayer import HumanLayer

from .nodes import HumanLayerToolNode, HumanApprovalNode, HumanInputNode
from .subgraph import build_humanlayer_subgraph

logger = logging.getLogger(__name__)

__all__ = [
    "build_humanlayer_subgraph",
    "create_human_approval_node",
    "create_human_input_node",
]


# Import build_humanlayer_subgraph from subgraph module


def create_human_approval_node(
    human_layer: HumanLayer,
    message_template: str = "Please approve this action: {action}",
    timeout: Optional[int] = 300,
) -> HumanApprovalNode:
    """Create a node that requests human approval.

    Args:
        human_layer: HumanLayer instance for human interaction
        message_template: Template for the approval message
        timeout: Timeout in seconds for the approval request

    Returns:
        A HumanApprovalNode that can be used in a graph
    """
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
    """Create a node that requests input from a human.

    Args:
        human_layer: HumanLayer instance for human interaction
        prompt_template: Template for the input prompt
        timeout: Timeout in seconds for the input request
        response_key: Key to store the human response in the state

    Returns:
        A HumanInputNode that can be used in a graph
    """
    return HumanInputNode(
        human_layer=human_layer,
        prompt_template=prompt_template,
        timeout=timeout,
        response_key=response_key,
    )