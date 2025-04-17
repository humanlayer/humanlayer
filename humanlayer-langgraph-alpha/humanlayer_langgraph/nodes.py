"""Node implementations for HumanLayer integration with LangGraph following the graph structure."""

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional, Union

from humanlayer import ContactChannel, FunctionCallSpec, HumanLayer, SlackContactChannel
from langchain_core.messages import AIMessage, AnyMessage, ToolMessage
from langchain_core.tools import BaseTool
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class NodeInterrupt(Exception):
    """Exception raised to interrupt graph execution while waiting for human feedback."""

    def __init__(self, message="Waiting for human feedback", state=None):
        self.message = message
        self.state = state
        super().__init__(self.message)


class HumanFeedbackNode:
    """A Node that handles human feedback for tool execution approval.
    
    This node implements the "Human Feedback Node" subgraph from the diagram.
    It checks for tool calls, requests human approval, and either continues
    execution or interrupts the graph based on approval status.
    """

    def __init__(
        self,
        human_layer: HumanLayer,
        tools: List[BaseTool],
        messages_key: str = "messages",
        thread_id_key: str = "thread_id",
    ):
        """Initialize a HumanFeedbackNode.

        Args:
            human_layer: The HumanLayer instance to use for feedback
            tools: The tools to use (for validation)
            messages_key: The key for messages in the state
            thread_id_key: The key for thread_id in the state
        """
        self.human_layer = human_layer
        self.tools = {tool.name: tool for tool in tools}
        self.messages_key = messages_key
        self.thread_id_key = thread_id_key
    
    def __call__(
        self, state: Union[List[AnyMessage], Dict[str, Any], BaseModel]
    ) -> Union[List[AnyMessage], Dict[str, Any]]:
        """Check tool calls and request human feedback."""
        logger.info("---human_feedback_node---")
        
        # Extract messages and thread_id from state
        if isinstance(state, list):
            messages = state
            thread_id = None  # No thread_id in list-based state
            input_type = "list"
        elif isinstance(state, dict):
            messages = state.get(self.messages_key, [])
            thread_id = state.get(self.thread_id_key)
            input_type = "dict"
        else:
            messages = getattr(state, self.messages_key, [])
            thread_id = getattr(state, self.thread_id_key, None)
            input_type = "dict"
        
        # Find the last AI message with tool calls
        ai_message = None
        for msg in reversed(messages):
            if isinstance(msg, AIMessage) and getattr(msg, "tool_calls", None):
                ai_message = msg
                break
        
        if not ai_message:
            logger.info("No AI message with tool calls found")
            return state
        
        # Get answered tool calls
        answered_ids = {
            msg.tool_call_id
            for msg in messages
            if isinstance(msg, ToolMessage) and hasattr(msg, "tool_call_id")
        }
        
        # Process each tool call
        new_tool_messages = []
        needs_interrupt = False
        
        for tool_call in ai_message.tool_calls:
            tool_id = tool_call["id"]
            
            # Skip if already answered
            if tool_id in answered_ids:
                logger.info(f"Tool call {tool_id} already answered, skipping")
                continue
            
            tool_name = tool_call["name"]
            tool_args = tool_call["args"]
            
            # Validate tool exists
            if tool_name not in self.tools:
                error_msg = f"Tool {tool_name} not found. Available tools: {', '.join(self.tools.keys())}"
                logger.error(error_msg)
                new_tool_messages.append(
                    ToolMessage(
                        content=error_msg,
                        tool_call_id=tool_id,
                        name=tool_name,
                    )
                )
                continue
            
            # Create function call spec
            spec = FunctionCallSpec(
                fn=tool_name,
                kwargs=tool_args,
                state=state,
            )
            
            # Request approval
            logger.info(f"Requesting approval for {tool_name}...")
            approval = self.human_layer.fetch_approval(spec=spec)
            
            if approval.approved:
                logger.info("---function call approved, doing nothing---")
            else:
                logger.info("---function call denied, appending tool message---")
                msg = ToolMessage(
                    tool_call_id=tool_id,
                    name=tool_name,
                    content=f"User denied {tool_name} with feedback: {approval.comment}",
                )
                logger.info(msg.model_dump_json())
                new_tool_messages.append(msg)
        
        # Update state with new tool messages
        if input_type == "list":
            updated_state = messages + new_tool_messages
        else:
            updated_state = {**state, self.messages_key: messages + new_tool_messages}
        
        # Interrupt if needed
        if any(isinstance(msg, ToolMessage) for msg in new_tool_messages):
            logger.info("Interrupting graph execution while waiting for human feedback")
            raise NodeInterrupt("Waiting for human approval on tool calls", updated_state)
        
        return updated_state


class RunToolsNode:
    """A Node that executes approved tools.
    
    This node implements the "Run Tools Node" subgraph from the diagram.
    It finds unanswered and approved tool calls and executes them.
    """

    def __init__(
        self,
        tools: List[BaseTool],
        messages_key: str = "messages",
    ):
        """Initialize a RunToolsNode.

        Args:
            tools: The tools to use
            messages_key: The key for messages in the state
        """
        self.tools = {tool.name: tool for tool in tools}
        self.messages_key = messages_key
    
    def __call__(
        self, state: Union[List[AnyMessage], Dict[str, Any], BaseModel]
    ) -> Union[List[AnyMessage], Dict[str, Any]]:
        """Execute approved tools based on the state."""
        logger.info("---run_tools_node---")
        
        # Get messages from state
        if isinstance(state, list):
            messages = state
            input_type = "list"
        elif isinstance(state, dict):
            messages = state.get(self.messages_key, [])
            input_type = "dict"
        else:
            messages = getattr(state, self.messages_key, [])
            input_type = "dict"
        
        # Find the last AI message with tool calls
        ai_message = None
        for msg in reversed(messages):
            if isinstance(msg, AIMessage) and getattr(msg, "tool_calls", None):
                ai_message = msg
                break
        
        if not ai_message:
            logger.info("No AI message with tool calls found")
            return state
        
        # Get answered tool calls
        answered_ids = {
            msg.tool_call_id
            for msg in messages
            if isinstance(msg, ToolMessage) and hasattr(msg, "tool_call_id")
        }
        
        # Process each unanswered tool call
        new_tool_messages = []
        for tool_call in ai_message.tool_calls:
            if tool_call["id"] in answered_ids:
                continue
                
            tool_name = tool_call["name"]
            tool_args = tool_call["args"]
            tool_id = tool_call["id"]
            
            logger.info(f"Processing tool call: {tool_name}({json.dumps(tool_args)})")
            
            if tool_name not in self.tools:
                error_msg = f"Tool {tool_name} not found. Available tools: {', '.join(self.tools.keys())}"
                logger.error(error_msg)
                new_tool_messages.append(
                    ToolMessage(
                        content=error_msg,
                        tool_call_id=tool_id,
                        name=tool_name,
                    )
                )
                continue
            
            # Execute tool
            try:
                tool = self.tools[tool_name]
                result = self._execute_tool(tool, tool_args)
                
                logger.info(f"Tool result: {result}")
                
                # Create a tool message with the result
                new_tool_messages.append(
                    ToolMessage(
                        content=str(result),
                        tool_call_id=tool_id,
                        name=tool_name,
                    )
                )
            except Exception as e:
                error_msg = f"Error executing tool {tool_name}: {str(e)}"
                logger.error(error_msg)
                new_tool_messages.append(
                    ToolMessage(
                        content=error_msg,
                        tool_call_id=tool_id,
                        name=tool_name,
                    )
                )
        
        # Update the state with the new tool messages
        if input_type == "list":
            return messages + new_tool_messages
        else:
            return {**state, self.messages_key: messages + new_tool_messages}
            
    def _execute_tool(self, tool: BaseTool, tool_args: Any) -> Any:
        """Execute a tool with the given arguments."""
        if hasattr(tool, "_run") and callable(tool._run):
            logger.info(f"Using _run method for tool {tool.name}")
            if isinstance(tool_args, dict):
                tool_args_str = json.dumps(tool_args)
                return tool._run(tool_args_str, config={})
            return tool._run(str(tool_args), config={})
            
        elif hasattr(tool, "func") and callable(tool.func):
            logger.info(f"Using func method for tool {tool.name}")
            if isinstance(tool_args, dict):
                return tool.func(**tool_args)
            return tool.func(tool_args)
            
        elif hasattr(tool, "invoke") and callable(tool.invoke):
            logger.info(f"Using invoke method for tool {tool.name}")
            try:
                if isinstance(tool_args, dict):
                    tool_args_str = json.dumps(tool_args)
                    return tool.invoke(input=tool_args_str, config={})
                return tool.invoke(input=str(tool_args), config={})
            except TypeError as e:
                if "unexpected keyword argument 'config'" in str(e):
                    logger.info("Falling back to invoke without config parameter")
                    if isinstance(tool_args, dict):
                        tool_args_str = json.dumps(tool_args)
                        return tool.invoke(tool_args_str)
                    return tool.invoke(str(tool_args))
                raise
                
        elif callable(tool) and callable(tool.__call__):
            logger.info(f"Using direct call for tool {tool.name}")
            if isinstance(tool_args, dict):
                return tool(**tool_args)
            return tool(tool_args)
            
        else:
            raise ValueError(f"Cannot determine how to invoke tool {tool.name}")


class DecisionNode:
    """A Node that checks if all tool calls have been answered.
    
    This node corresponds to the "Decision" diamond in the diagram.
    """

    def __init__(self, messages_key: str = "messages"):
        """Initialize a DecisionNode.

        Args:
            messages_key: The key for messages in the state
        """
        self.messages_key = messages_key
    
    def __call__(
        self, state: Union[List[AnyMessage], Dict[str, Any], BaseModel]
    ) -> Dict[str, Any]:
        """Check if all tool calls have been answered."""
        logger.info("---decision_node---")
        
        # Extract messages from state
        if isinstance(state, list):
            messages = state
        elif isinstance(state, dict):
            messages = state.get(self.messages_key, [])
        else:
            messages = getattr(state, self.messages_key, [])
        
        # Find the last AI message with tool calls
        ai_message = None
        for msg in reversed(messages):
            if isinstance(msg, AIMessage) and getattr(msg, "tool_calls", None):
                ai_message = msg
                break
        
        if not ai_message:
            logger.info("No AI message with tool calls found")
            return {"all_tools_answered": True}
        
        # Get answered tool calls
        answered_ids = {
            msg.tool_call_id
            for msg in messages
            if isinstance(msg, ToolMessage) and hasattr(msg, "tool_call_id")
        }
        
        # Check if all tool calls are answered
        all_answered = all(tc["id"] in answered_ids for tc in ai_message.tool_calls)
        
        logger.info(f"All tools answered: {all_answered}")
        return {"all_tools_answered": all_answered}