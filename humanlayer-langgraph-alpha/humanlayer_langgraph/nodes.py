"""Node implementation for HumanLayer integration with LangGraph."""

import asyncio
import json
import logging
from typing import Any, Optional, Union

from humanlayer import ContactChannel, FunctionCallSpec, HumanLayer, SlackContactChannel
from langchain_core.messages import AIMessage, AnyMessage, ToolMessage
from langchain_core.tools import BaseTool
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class HumanLayerToolNode:
    """A Node that integrates with HumanLayer for tool execution with approval."""

    def __init__(
        self,
        tools: list[BaseTool],
        human_layer: HumanLayer,
        require_approval: bool = True,
        messages_key: str = "messages",
    ):
        """Initialize a HumanLayerToolNode.

        Args:
            tools: The tools to use
            human_layer: The HumanLayer instance to use for logging
            require_approval: Whether to require human approval before executing tools
            messages_key: The key for messages in the state
        """
        self.human_layer = human_layer
        self.require_approval = require_approval
        self.tools = {tool.name: tool for tool in tools}
        self.messages_key = messages_key
        self.store = None  # Will be set by the graph when compiled

    def __call__(
        self, state: Union[list[AnyMessage], dict[str, Any], BaseModel]
    ) -> Union[list[AnyMessage], dict[str, Any]]:
        """Invoke the tools based on the state."""
        logger.info("Processing HumanLayerToolNode")

        # Extract messages from state
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

        # Get unanswered tool calls
        answered_ids = {
            msg.tool_call_id
            for msg in messages
            if isinstance(msg, ToolMessage) and hasattr(msg, "tool_call_id")
        }

        unanswered_tool_calls = [tc for tc in ai_message.tool_calls if tc["id"] not in answered_ids]

        if not unanswered_tool_calls:
            logger.info("All tool calls already answered")
            return state

        # Process each unanswered tool call
        new_tool_messages = []
        for tool_call in unanswered_tool_calls:
            tool_name = tool_call["name"]
            tool_args = tool_call["args"]
            tool_id = tool_call["id"]

            logger.info(f"Processing tool call: {tool_name}({json.dumps(tool_args)})")

            if tool_name not in self.tools:
                error_msg = (
                    f"Tool {tool_name} not found. Available tools: {', '.join(self.tools.keys())}"
                )
                logger.error(error_msg)
                new_tool_messages.append(
                    ToolMessage(
                        content=error_msg,
                        tool_call_id=tool_id,
                        name=tool_name,
                    )
                )
                continue

            # Get approval if required
            approved = True
            approval_comment = ""

            if self.require_approval:
                try:
                    logger.info(f"Requesting approval for {tool_name}...")

                    # Create contact channel for Slack notifications
                    contact = ContactChannel(
                        slack=SlackContactChannel(
                            channel_or_user_id="C08EDEYS1SB",
                            experimental_slack_blocks=True,
                        )
                    )

                    # Create function call spec with contact channel
                    spec = FunctionCallSpec(
                        fn=tool_name,
                        kwargs=tool_args,
                        channel=contact,
                    )

                    # Wait for human approval using fetch_approval
                    logger.info("Waiting for human approval via Slack...")
                    completed = self.human_layer.fetch_approval(spec=spec)
                    logger.info(f"Approval result: {completed.call}")

                    # Process approval result
                    approved = completed.call.status.approved
                    approval_comment = completed.call.status.comment or ""
                    logger.info(f"Approval result: {approved}, comment: '{approval_comment}'")

                except Exception as e:
                    logger.error(f"Error getting approval: {e}")
                    approved = False
                    approval_comment = f"Error getting approval: {str(e)}"

            # Execute the tool if approved
            if approved:
                logger.info(f"Executing tool: {tool_name}")
                try:
                    tool = self.tools[tool_name]

                    # LangChain decorated tools require special handling
                    # For @tool decorated functions or BaseTool objects
                    if hasattr(tool, "_run") and callable(tool._run):
                        logger.info(f"Using _run method for tool {tool_name}")
                        # Tools from @tool decorator
                        if isinstance(tool_args, dict):
                            # Convert dict to string for LangChain tool
                            tool_args_str = json.dumps(tool_args)
                            # Pass the required config parameter for StructuredTool._run
                            result = tool._run(tool_args_str, config={})
                        else:
                            # Pass the required config parameter for StructuredTool._run
                            result = tool._run(str(tool_args), config={})
                    elif hasattr(tool, "func") and callable(tool.func):
                        logger.info(f"Using func method for tool {tool_name}")
                        # For @tool decorated functions
                        if isinstance(tool_args, dict):
                            result = tool.func(**tool_args)
                        else:
                            result = tool.func(tool_args)
                    elif hasattr(tool, "invoke") and callable(tool.invoke):
                        logger.info(f"Using invoke method for tool {tool_name}")
                        # LangChain BaseTool invoke pattern
                        try:
                            if isinstance(tool_args, dict):
                                # Convert dict to string for LangChain tool input
                                tool_args_str = json.dumps(tool_args)
                                result = tool.invoke(input=tool_args_str, config={})
                            else:
                                result = tool.invoke(input=str(tool_args), config={})
                        except TypeError as e:
                            # Fallback to old style without config
                            if "unexpected keyword argument 'config'" in str(e):
                                logger.info("Falling back to invoke without config parameter")
                                if isinstance(tool_args, dict):
                                    tool_args_str = json.dumps(tool_args)
                                    result = tool.invoke(tool_args_str)
                                else:
                                    result = tool.invoke(str(tool_args))
                            else:
                                raise
                    elif callable(tool) and callable(tool.__call__):
                        logger.info(f"Using direct call for tool {tool_name}")
                        # If the tool is directly callable
                        if isinstance(tool_args, dict):
                            result = tool(**tool_args)
                        else:
                            result = tool(tool_args)
                    else:
                        raise ValueError(f"Cannot determine how to invoke tool {tool_name}")

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
            else:
                # Create a tool message with the denial
                denial_msg = f"Tool execution denied: {approval_comment}"
                logger.info(denial_msg)
                new_tool_messages.append(
                    ToolMessage(
                        content=denial_msg,
                        tool_call_id=tool_id,
                        name=tool_name,
                    )
                )

        # Update the state with the new tool messages
        if input_type == "list":
            return messages + new_tool_messages
        else:
            return {**state, self.messages_key: messages + new_tool_messages}


class HumanApprovalNode:
    """A node that requests human approval before proceeding."""

    def __init__(
        self,
        human_layer: HumanLayer,
        message_template: str = "Please approve this action: {action}",
        timeout: Optional[int] = 300,
    ):
        """Initialize a HumanApprovalNode.

        Args:
            human_layer: The HumanLayer instance to use
            message_template: Template for the approval message
            timeout: Timeout in seconds for the approval request
        """
        self.human_layer = human_layer
        self.message_template = message_template
        self.timeout = timeout

    async def ainvoke(
        self, state: dict[str, Any], action: str = "Continue execution"
    ) -> dict[str, Any]:
        """Request human approval for an action.

        Args:
            state: The current state
            action: Description of the action requiring approval

        Returns:
            Updated state with approval information
        """
        message = self.message_template.format(action=action)

        logger.info(f"Requesting human approval: {message}")

        # In a real implementation, this would wait for human approval
        # approval_result = await self.human_layer.require_approval(
        #     message=message,
        #     context={"state": state},
        #     run_id=self.human_layer.run_id,
        #     timeout=self.timeout,
        # )

        # For this example, we'll simulate approval
        logger.info("Simulating human approval (would wait for response in real implementation)")
        approval_result = type(
            "ApprovalResult",
            (),
            {
                "approved": True,
                "feedback": "Automatically approved for example",
                "timestamp": "2025-03-21T12:00:00Z",
            },
        )

        # Update state with approval result
        return {
            **state,
            "_humanlayer_approval": {
                "approved": approval_result.approved,
                "feedback": approval_result.feedback,
                "timestamp": approval_result.timestamp,
            },
        }

    def invoke(self, state: dict[str, Any], action: str = "Continue execution") -> dict[str, Any]:
        """Synchronous version of ainvoke."""
        loop = asyncio.get_event_loop()
        return loop.run_until_complete(self.ainvoke(state, action))


class HumanInputNode:
    """A node that requests input from a human."""

    def __init__(
        self,
        human_layer: HumanLayer,
        prompt_template: str = "Please provide input: {prompt}",
        timeout: Optional[int] = 300,
        response_key: str = "_humanlayer_input",
    ):
        """Initialize a HumanInputNode.

        Args:
            human_layer: The HumanLayer instance to use
            prompt_template: Template for the input prompt
            timeout: Timeout in seconds for the input request
            response_key: Key to store the human response in the state
        """
        self.human_layer = human_layer
        self.prompt_template = prompt_template
        self.timeout = timeout
        self.response_key = response_key

    async def ainvoke(
        self, state: dict[str, Any], prompt: str = "Your input is needed"
    ) -> dict[str, Any]:
        """Request input from a human.

        Args:
            state: The current state
            prompt: The prompt to display to the human

        Returns:
            Updated state with human input
        """
        formatted_prompt = self.prompt_template.format(prompt=prompt)

        logger.info(f"Requesting human input: {formatted_prompt}")

        # In a real implementation, this would wait for human input
        # input_result = await self.human_layer.request_human_input(
        #     prompt=formatted_prompt,
        #     context={"state": state},
        #     run_id=self.human_layer.run_id,
        #     timeout=self.timeout,
        # )

        # For this example, we'll simulate input
        logger.info("Simulating human input (would wait for response in real implementation)")
        input_result = type(
            "InputResult",
            (),
            {"response": "Simulated human response", "timestamp": "2025-03-21T12:00:00Z"},
        )

        # Update state with input result
        return {
            **state,
            self.response_key: {
                "response": input_result.response,
                "timestamp": input_result.timestamp,
            },
        }

    def invoke(self, state: dict[str, Any], prompt: str = "Your input is needed") -> dict[str, Any]:
        """Synchronous version of ainvoke."""
        loop = asyncio.get_event_loop()
        return loop.run_until_complete(self.ainvoke(state, prompt))
