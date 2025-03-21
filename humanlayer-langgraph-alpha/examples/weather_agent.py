"""Example of using HumanLayer with LangGraph to create a weather agent with human-in-the-loop approval."""

import asyncio
import logging
import json
import inspect
from typing import List, Dict, Any, TypedDict, Union
from uuid import uuid4

from humanlayer import HumanLayer
from humanlayer_langgraph import build_humanlayer_subgraph
from humanlayer_langgraph.nodes import HumanLayerToolNode
from langchain_core.tools import BaseTool
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.graph import START, END, StateGraph

# Configure logging
from humanlayer_langgraph.logger import LoggerFactory

logger = LoggerFactory()


class MessagesState(TypedDict):
    """State containing messages and other metadata for the conversation flow."""
    messages: List[Union[HumanMessage, AIMessage, ToolMessage]]
    thread_id: str
    require_approval: bool


@tool
def get_weather(location: str) -> str:
    """Get the current weather for a location.
    
    Args:
        location: The city or location to get weather for.
        
    Returns:
        A string describing the current weather conditions.
    """
    logger.info(f"Getting weather for: {location}")
    
    # Handle different input formats
    if isinstance(location, dict):
        # If location is a dict with nested info
        if "location" in location:
            location = location["location"]
    elif isinstance(location, str):
        # If location is a string, check if it's JSON
        try:
            parsed = json.loads(location)
            if isinstance(parsed, dict) and "location" in parsed:
                location = parsed["location"]
        except (json.JSONDecodeError, TypeError):
            # Not JSON or not valid, use as is
            pass
    
    if not location:
        logger.warning("Empty location provided")
        return "Please provide a location to get weather information."
        
    # Convert to lowercase for case-insensitive comparison
    location_str = str(location).lower()
    
    # Log what we're checking
    logger.info(f"Checking weather for location (processed): {location_str}")
    
    # Only respond to San Francisco and New York
    if "san francisco" in location_str or location_str == "sf":
        logger.info("It's 60 degrees and foggy in San Francisco.")
        return "It's 60 degrees and foggy in San Francisco."
    elif "new york" in location_str or location_str == "ny":
        logger.info("It's 75 degrees and partly cloudy in New York.")
        return "It's 75 degrees and partly cloudy in New York."
    else:
        logger.info(f"Weather data not available for {location_str}.")
        return f"Sorry, I can only provide weather for San Francisco and New York. Weather data not available for {location_str}."


def build_graph(tools: list, human_layer: HumanLayer):
    """Build the complete graph with HumanLayer integration for human-in-the-loop approval."""
    graph_builder = StateGraph(MessagesState)

    # Define the LLM with tools
    llm = ChatOpenAI(model="gpt-4", temperature=0).bind_tools(tools)

    # Create a HumanLayer tool node that requires approval for tools
    from humanlayer_langgraph.subgraph import build_humanlayer_subgraph
    
    # Use the subgraph builder to create a tool node with approval
    tools_node = build_humanlayer_subgraph(
        tools=tools, 
        human_layer=human_layer,
        require_approval=True
    )
    logger.info("Created HumanLayer tools node with approval REQUIRED")

    # Define the chatbot node
    def chatbot(state: MessagesState):
        """Chatbot node that generates responses based on the conversation history."""
        logger.info("Processing chatbot node")
        messages = state["messages"]
        
        # Ensure we have at least one message
        if not messages:
            logger.warning("No messages in state, creating default message")
            return {"messages": [HumanMessage(content="What's the weather?")]}
        
        # Log current message state for debugging
        log_messages(messages)
        
        # Check if the last message is already an AI message without tool calls
        last_message = messages[-1] if messages else None
        if isinstance(last_message, AIMessage) and not getattr(last_message, "tool_calls", None):
            logger.info("Last message is already an AI response without tool calls")
            return {"messages": messages}
            
        # Generate a response from the LLM
        try:
            response = llm.invoke(messages)
            tool_calls = getattr(response, "tool_calls", None)
            
            if tool_calls:
                logger.info(f"LLM generated tool calls: {[tc['name'] for tc in tool_calls]}")
            else:
                logger.info(f"LLM response: {response.content}")
                
            # Add the response to the messages list
            return {"messages": messages + [response]}
        except Exception as e:
            logger.error(f"Error invoking LLM: {str(e)}")
            return {"messages": messages + [AIMessage(content=f"Error: {str(e)}")]}

    # Helper function to log messages
    def log_messages(messages):
        logger.info("Current messages:")
        for i, msg in enumerate(messages):
            if isinstance(msg, HumanMessage):
                logger.info(f"  {i}: Human: {msg.content}")
            elif isinstance(msg, AIMessage):
                if getattr(msg, "tool_calls", None):
                    logger.info(f"  {i}: AI (tool calls): {[tc['name'] for tc in msg.tool_calls]}")
                else:
                    logger.info(f"  {i}: AI: {msg.content}")
            elif isinstance(msg, ToolMessage):
                logger.info(f"  {i}: Tool ({msg.name}): {msg.content}")

    # Define a condition to check if we should go to tools
    def should_use_tools(state):
        """Determine if we should route to tools or end the graph."""
        messages = state["messages"]
        if not messages:
            return False
        
        # Find the last AI message
        for msg in reversed(messages):
            if isinstance(msg, AIMessage):
                # Check if the message has tool calls
                if getattr(msg, "tool_calls", None):
                    # Check if all tool calls have been answered
                    tool_call_ids = {tc["id"] for tc in msg.tool_calls}
                    answered_ids = {
                        msg.tool_call_id for msg in messages 
                        if isinstance(msg, ToolMessage) and hasattr(msg, "tool_call_id")
                    }
                    
                    # If there are unanswered tool calls, route to tools
                    if not tool_call_ids.issubset(answered_ids):
                        logger.info(f"Found unanswered tool calls: {len(tool_call_ids - answered_ids)}")
                        return True
                break
        
        logger.info("No unanswered tool calls, ending node")
        return False

    # Add nodes to the graph
    graph_builder.add_node("chatbot", chatbot)
    graph_builder.add_node("tools", tools_node)

    # Define edges
    graph_builder.add_edge(START, "chatbot")
    
    # Add conditional edge from chatbot to either tools or END based on tool calls
    graph_builder.add_conditional_edges(
        "chatbot",
        should_use_tools,
        {
            True: "tools",
            False: END,
        }
    )
    
    # From tools back to chatbot for further processing
    graph_builder.add_edge("tools", "chatbot")

    # Compile the graph
    return graph_builder.compile()


async def main():
    """Run the weather example with human-in-the-loop approval."""
    # Initialize HumanLayer with a unique run ID
    run_id = str(uuid4())
    logger.info(f"Creating HumanLayer run with ID: {run_id}")
    human_layer = HumanLayer(run_id=run_id)

    # Define tools
    # Use the get_weather tool directly since it's already decorated with @tool
    tools = [get_weather]

    # Generate a thread ID for conversation tracking
    thread_id = str(uuid4())
    logger.info(f"Starting conversation with thread ID: {thread_id}")

    # Build the graph
    graph = build_graph(tools, human_layer)

    try:
        # Initial message - asking about San Francisco weather
        initial_message = "What's the weather in San Francisco?"
        logger.info(f"Human: {initial_message}")
        
        # All invocations require approval
        result = await graph.ainvoke(
            {
                "messages": [HumanMessage(content=initial_message)],
                "thread_id": thread_id,
                "require_approval": True,
            }
        )
        
        # Log the response
        logger.info("Response after first query:")
        log_messages(result["messages"])
        
        # Print out more detailed debug info
        logger.info("\nDEBUG INFORMATION:")
        logger.info(f"Weather tool: {get_weather}")
        logger.info(f"Has _run: {hasattr(get_weather, '_run')}")
        logger.info(f"Has func: {hasattr(get_weather, 'func')}")
        logger.info(f"Has invoke: {hasattr(get_weather, 'invoke')}")
        logger.info(f"Tool type: {type(get_weather)}")
        logger.info(f"Tool dict: {vars(get_weather)}")
        logger.info(f"Inspect get_weather: {inspect.signature(get_weather)}")
        
        # Check tool execution directly
        try:
            logger.info("\nTesting direct tool execution:")
            test_result = get_weather.run('{"location": "San Francisco"}')
            logger.info(f"Test result: {test_result}")
        except Exception as e:
            logger.error(f"Direct tool execution error: {e}")
            
        # Process another message - asking about New York weather
        follow_up_message = "What's the weather in New York?"
        logger.info(f"\nHuman: {follow_up_message}")
        
        # Add the new message to the result
        messages = result["messages"] + [HumanMessage(content=follow_up_message)]
        
        # Invoke the graph again with the second message
        result = await graph.ainvoke(
            {
                "messages": messages,
                "thread_id": thread_id,
                "require_approval": True,
            }
        )
        
        # Log the final conversation state
        logger.info("\nFinal conversation state:")
        log_messages(result["messages"])
        
        # Log additional state information
        logger.info("\nFINAL STATE:")
        logger.info(f"Thread ID: {result.get('thread_id', 'N/A')}")
        logger.info(f"Require Approval: {result.get('require_approval', False)}")
        logger.info(f"Total messages: {len(result['messages'])}")
        logger.info(f"HumanLayer Run ID: {human_layer.run_id}")
        
        logger.info("\nNOTE: Tools required human approval before execution!")
        
    except Exception as e:
        logger.error(f"Error during graph execution: {e}")
        import traceback
        logger.error(traceback.format_exc())


# Helper function to log messages
def log_messages(messages):
    for msg in messages:
        if isinstance(msg, HumanMessage):
            logger.info(f"Human: {msg.content}")
        elif isinstance(msg, AIMessage):
            if getattr(msg, "tool_calls", None):
                logger.info(f"AI (tool calls): {[tc['name'] for tc in msg.tool_calls]}")
            else:
                logger.info(f"AI: {msg.content}")
        elif isinstance(msg, ToolMessage):
            logger.info(f"Tool ({msg.name}): {msg.content}")


if __name__ == "__main__":
    asyncio.run(main())