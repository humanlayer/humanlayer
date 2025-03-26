"""Example of HumanLayer LangGraph integration."""

import asyncio
import json
import logging
import os
from uuid import uuid4

from humanlayer import HumanLayer
from langchain_core.tools import tool
from langchain_core.messages import HumanMessage, AIMessage

from langchain_openai import ChatOpenAI
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.graph import START, MessagesState, StateGraph
from langgraph.graph.graph import RunnableConfig
from langgraph.prebuilt import tools_condition
from langgraph.types import Command

from humanlayer_langgraph import build_humanlayer_subgraph

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class State(MessagesState):
    """State for the main graph."""
    thread_id: str


@tool
def get_weather(location: str):
    """Call to get the current weather."""
    logger.info(f"---get_weather({json.dumps({'location': location})})---")
    if location.lower() in ["sf", "san francisco"]:
        logger.info("It's 60 degrees and foggy.")
        return "It's 60 degrees and foggy."
    else:
        logger.info("It's 90 degrees and sunny.")
        return "It's 90 degrees and sunny."
    
tools = [get_weather]
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0).bind_tools(tools)
hl = HumanLayer(run_id="langgraph-weather-demo")


def chatbot(state: State):
    """Chatbot node that generates responses based on the conversation history."""
    logger.info("---chatbot_node---")
    logger.info(f"Input state messages: {state['messages']}")
    
    # Check if we have any pending tool calls that need responses
    last_message = state["messages"][-1] if state["messages"] else None
    if isinstance(last_message, AIMessage) and last_message.tool_calls:
        # We need tool responses first
        logger.info("Found tool calls that need responses first")
        return {"messages": state["messages"]}
    
    # Generate response from LLM
    response = llm.invoke(state["messages"])
    
    # Log the response
    if response.content:
        logger.info(f"AI response: {response.content}")
    elif response.tool_calls:
        logger.info(
            f"Tool calls: {[f'{tool['name']}({json.dumps(tool['args'])})' for tool in response.tool_calls]}"
        )
    
    return {"messages": state["messages"] + [response]}


def build_graph(checkpointer):
    """Build the main graph with HumanLayer integration.
    
    The graph follows this structure:
    START -> Chatbot -> Decision -> HumanLayer Subgraph -> Chatbot
    """
    graph_builder = StateGraph(State)
    
    # Add nodes
    graph_builder.add_node("chatbot", chatbot)

    humanlayer_subgraph = build_humanlayer_subgraph(tools, hl)
    print(humanlayer_subgraph.get_graph().draw_mermaid())

    graph_builder.add_node("tools", humanlayer_subgraph)
    
    # Add edges
    graph_builder.add_edge(START, "chatbot")
    graph_builder.add_conditional_edges(
        "chatbot",
        tools_condition,
    )
    graph_builder.add_edge("tools", "chatbot")  # Loop back to chatbot for next response
    
    return graph_builder.compile(
        checkpointer=checkpointer,
    )


async def main():
    """Run the example."""
    
    # Set up checkpointing
    async with AsyncSqliteSaver.from_conn_string("checkpoints.db") as checkpointer:
        # Build and visualize the graph
        graph = build_graph(checkpointer)
        print(graph.get_graph().draw_mermaid())
        
        # Generate a thread ID for conversation tracking
        thread_id = str(uuid4())
        logger.info(f"Starting conversation with thread ID: {thread_id}")
        
        # Initial message
        initial_message = "What's the weather in San Francisco?"
        logger.info(f"Human: {initial_message}")
        
        # Initial invoke
        config = RunnableConfig({"configurable": {"thread_id": thread_id}})
        result = await graph.ainvoke(
            {
                "messages": [HumanMessage(content=initial_message)],
                "thread_id": thread_id,
            },
            config=config,
        )
        logger.info("Initial result: %s", result)
        
        # Resume after webhook received
        logger.info("---resuming after webhook---")
        resume_command = Command(resume="OK")
        result = await graph.ainvoke(
            {
                "messages": result["messages"],
                "thread_id": thread_id,
                "resume": resume_command,  # Add resume to state
            },
            config=RunnableConfig({"configurable": {"thread_id": thread_id}}),
        )
        logger.info("Resume result: %s", result)


if __name__ == "__main__":
    asyncio.run(main())