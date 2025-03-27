from typing import Any, Literal, Tuple, Union
from pydantic import BaseModel
import logging

from humanlayer import FunctionCallSpec, HumanLayer, HumanLayerException
from langgraph.store.base import BaseStore
from langchain_core.messages import AIMessage, ToolMessage, AnyMessage, ToolCall
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.types import interrupt
from langgraph.prebuilt import ToolNode
from langgraph.errors import NodeInterrupt
from langgraph.types import Command

logger = logging.getLogger(__name__)


def split_answered_unanswered_tool_calls(
    messages: list[AnyMessage],
) -> tuple[list[ToolCall], list[ToolCall]]:
    """Split tool calls into answered and unanswered ones."""
    index = -1
    already_answered_tool_calls = []
    while True:
        msg: AnyMessage = messages[index]
        if isinstance(msg, AIMessage):
            break
        if isinstance(msg, ToolMessage):
            already_answered_tool_calls.append(msg.tool_call_id)
        else:
            raise ValueError(
                f"found non tool message {type(msg)} while rewinding to find initial list of tool calls"
            )
        index -= 1

    answered_tool_calls = [
        t for t in msg.tool_calls if t["id"] in already_answered_tool_calls
    ]
    unanswered_tool_calls = [
        t for t in msg.tool_calls if t["id"] not in already_answered_tool_calls
    ]
    return answered_tool_calls, unanswered_tool_calls


class HumanLayerSubgraphState(MessagesState):
    """State for the HumanLayer subgraph."""
    thread_id: str


def build_humanlayer_subgraph(
    tools: list,
    hl: HumanLayer,
):
    """Build the HumanLayer subgraph with the new structure.
    
    The graph follows this structure:
    START -> Human Feedback Node -> Decision -> Run Tools Node -> END
    """
    graph_builder = StateGraph(HumanLayerSubgraphState)
    
    # Add nodes
    graph_builder.add_node("human_feedback", human_feedback_node(hl))
    graph_builder.add_node("run_tools", IncrementalToolNode(tools))
    
    # Add edges
    graph_builder.add_edge(START, "human_feedback")
    graph_builder.add_conditional_edges(
        "human_feedback",
        decision_node(),
    )
    graph_builder.add_edge("run_tools", "human_feedback")  # Loop back for next tool calls
    
    return graph_builder.compile()


def human_feedback_node(hl: HumanLayer, end_on_any_rejection: bool = True):
    def human_feedback(state):
        logger.info("---human_feedback---")
        tool_call_ai_message = state["messages"][-1]
        assert isinstance(tool_call_ai_message, AIMessage)
        assert tool_call_ai_message.tool_calls is not None

        new_messages = []
        needs_interrupt = False
        for tool_call in tool_call_ai_message.tool_calls:
            assert tool_call["id"] is not None

            try:
                call = hl.get_function_call(call_id=tool_call["id"])
                logger.info(f"got function call: {call.spec.fn} ({call.call_id})")
            except HumanLayerException:
                call = hl.create_function_call(
                    call_id=tool_call["id"],
                    spec=FunctionCallSpec(
                        fn=tool_call["name"],
                        kwargs=tool_call["args"],
                        state=state,
                    ),
                )
                logger.info(
                    f"created function call: {call.spec.fn} ({call.call_id}), will interrupt graph"
                )
                needs_interrupt = True

            if call.status.approved is None:
                logger.info("---function call status is None, will interrupt graph---")
                needs_interrupt = True
            elif call.status.approved:
                logger.info("---function call approved, doing nothing---")
            else:
                logger.info("---function call denied, appending tool message---")
                msg = ToolMessage(
                    tool_call_id=tool_call["id"],
                    name=tool_call["name"],
                    content=f"User denied {tool_call['name']} with feedback: {call.status.comment}",
                )
                logger.info(msg.model_dump_json())
                new_messages.append(msg)

        return {"messages": new_messages}

    return human_feedback


def decision_node():
    """Implements the Decision Node.
    
    Checks if all tool calls have been answered and routes accordingly.
    """
    def decision(state):
        logger.info("---decision_node---")
        
        # Split tool calls
        rejected_tool_calls, approved_unexecuted_tool_calls = (
            split_answered_unanswered_tool_calls(state["messages"])
        )
        
        # If we have rejected tool calls, end the graph
        if rejected_tool_calls:
            logger.info("---tool calls were rejected, ending graph---")
            return END
            
        # If we have approved but unexecuted tool calls, run them
        if approved_unexecuted_tool_calls:
            logger.info("---some tool calls are unanswered, proceeding to run_tools---")
            return "run_tools"
            
        # All tool calls are answered, end the graph
        logger.info("---all tool calls answered, ending graph---")
        return END

    return decision


class IncrementalToolNode(ToolNode):
    """Node that executes approved tools incrementally."""
    
    def __init__(self, tools: list) -> None:
        super().__init__(tools)

    def _parse_input(
        self,
        input: Union[list[AnyMessage], dict[str, Any], BaseModel],
        store: BaseStore,
    ) -> Tuple[list[ToolCall], Literal["list", "dict"]]:
        """Parse input to get unanswered tool calls."""
        input_type: Literal["list", "dict"]
        if isinstance(input, list):
            input_type = "list"
            the_messages: list[AnyMessage] = input
        elif isinstance(input, dict) and (messages := input.get(self.messages_key, [])):
            input_type = "dict"
            the_messages = messages
        elif messages := getattr(input, self.messages_key, None):
            input_type = "dict"
            the_messages = messages
        else:
            raise ValueError("No message found in input")

        _, unanswered_tool_calls = split_answered_unanswered_tool_calls(the_messages)
        tool_calls = [
            self._inject_tool_args(call, input, store) for call in unanswered_tool_calls
        ]

        return tool_calls, input_type