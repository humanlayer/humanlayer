#!/usr/bin/env python3
"""
Example demonstrating the new wrap_tool() method for LangChain tools.

This shows how to wrap existing BaseTool instances directly, eliminating the need 
for manual function decoration and tool recreation.

Before (manual approach):
    @hl.require_approval()
    def multiply(x: int, y: int) -> int:
        return x * y
    tools = [langchain.tools.StructuredTool.from_function(multiply)]

After (wrap_tool approach):
    tools = SomeToolKit().get_tools()
    safe_tools = [hl.wrap_tool(tool) for tool in tools if 'dangerous' in tool.name]
"""

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.prompts import ChatPromptTemplate
import langchain.tools

from humanlayer.core.approval import HumanLayer

load_dotenv()

hl = HumanLayer(
    verbose=True,
    run_id="langchain-tool-wrapping",
)


def add(x: int, y: int) -> int:
    """Add two numbers together."""
    return x + y


def multiply(x: int, y: int) -> int:
    """multiply two numbers"""
    return x * y


def divide(x: int, y: int) -> float:
    """divide two numbers"""
    if y == 0:
        raise ValueError("Cannot divide by zero")
    return x / y


def main() -> None:
    print("=== LangChain Tool Wrapping Example ===\n")
    
    # Create tools the traditional way (no approval yet)
    all_tools = [
        langchain.tools.StructuredTool.from_function(add),
        langchain.tools.StructuredTool.from_function(multiply),
        langchain.tools.StructuredTool.from_function(divide),
    ]
    
    print("Original tools:")
    for tool in all_tools:
        print(f"  - {tool.name}: {tool.description}")
    
    # NEW APPROACH: Use wrap_tool() to add approval to existing tool instances
    # This demonstrates the requested feature from Issue #92
    print("\nWrapping tools with approval using wrap_tool()...")
    
    # Wrap only the "dangerous" operations that need approval
    safe_tools = []
    for tool in all_tools:
        if tool.name in ['multiply', 'divide']:  # These need approval
            wrapped_tool = hl.wrap_tool(tool)
            safe_tools.append(wrapped_tool)
            print(f"  ✓ Wrapped {tool.name} with approval")
        else:
            safe_tools.append(tool)  # Safe operations don't need approval
            print(f"  - Kept {tool.name} without approval")
    
    print(f"\nWrapped tools:")
    for tool in safe_tools:
        print(f"  - {tool.name}: {tool.description} [type: {type(tool).__name__}]")
    
    # The rest works exactly the same as before
    llm = ChatOpenAI(model="gpt-4o", temperature=0)
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are a helpful assistant."),
        ("placeholder", "{chat_history}"),
        ("human", "{input}"),
        ("placeholder", "{agent_scratchpad}"),
    ])
    
    agent = create_tool_calling_agent(llm, safe_tools, prompt)
    agent_executor = AgentExecutor(agent=agent, tools=safe_tools, verbose=True)
    
    print("\n=== Comparison: Before vs After ===")
    print("Before (manual approach):")
    print("  @hl.require_approval()")
    print("  def multiply(x: int, y: int) -> int:")
    print("      return x * y")
    print("  tools = [langchain.tools.StructuredTool.from_function(multiply)]")
    
    print("\nAfter (wrap_tool approach):")
    print("  tools = SomeToolKit().get_tools()")
    print("  safe_tools = [hl.wrap_tool(tool) for tool in tools if 'dangerous' in tool.name]")
    
    print("\n🎉 No more manual wrapper classes or function recreation needed!")
    
    # Note: Commented out the actual execution to avoid needing OpenAI API in testing
    # Uncomment to test with real agent:
    # result = agent_executor.invoke({"input": "multiply 2 and 5, then add 32 to the result"})
    # print(f"\n\nResult: {result}")


if __name__ == "__main__":
    main()