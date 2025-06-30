#!/usr/bin/env python3
"""
Example demonstrating the new wrap_tool() functionality for LangChain and CrewAI tools.

This shows how to wrap existing tool instances directly without needing to recreate them
or use manual wrapper classes.
"""

from humanlayer.core.approval import HumanLayer


# Mock LangChain-style tool for testing
class MockLangChainTool:
    def __init__(self, name: str, description: str):
        self.name = name
        self.description = description
    
    def _run(self, query: str) -> str:
        return f"LangChain tool '{self.name}' executed with: {query}"
    
    async def _arun(self, query: str) -> str:
        return f"Async LangChain tool '{self.name}' executed with: {query}"


# Mock CrewAI-style tool for testing  
class MockCrewAITool:
    def __init__(self, name: str, description: str):
        self.name = name
        self.description = description
        self.args_schema = None  # CrewAI-specific attribute
    
    def _run(self, query: str) -> str:
        return f"CrewAI tool '{self.name}' executed with: {query}"


# Mock generic tool for testing
class MockGenericTool:
    def __init__(self, name: str):
        self.name = name
    
    def execute(self, data: str) -> str:
        return f"Generic tool '{self.name}' executed with: {data}"


def main():
    # Initialize HumanLayer with CLI approval for testing
    hl = HumanLayer.cli(verbose=True, run_id="tool-wrapping-test")
    
    print("=== HumanLayer Tool Wrapping Example ===\n")
    
    # Test 1: LangChain-style tool
    print("1. Testing LangChain-style tool wrapping:")
    langchain_tool = MockLangChainTool("search", "Search for information")
    wrapped_langchain = hl.wrap_tool(langchain_tool)
    
    print(f"Original tool type: {type(langchain_tool).__name__}")
    print(f"Wrapped tool type: {type(wrapped_langchain).__name__}")
    print(f"Tool name preserved: {wrapped_langchain.name}")
    print(f"Tool description preserved: {wrapped_langchain.description}")
    print()
    
    # Test 2: CrewAI-style tool
    print("2. Testing CrewAI-style tool wrapping:")
    crewai_tool = MockCrewAITool("analyze", "Analyze data")
    wrapped_crewai = hl.wrap_tool(crewai_tool)
    
    print(f"Original tool type: {type(crewai_tool).__name__}")
    print(f"Wrapped tool type: {type(wrapped_crewai).__name__}")
    print(f"Tool name preserved: {wrapped_crewai.name}")
    print(f"Tool description preserved: {wrapped_crewai.description}")
    print()
    
    # Test 3: Generic tool
    print("3. Testing generic tool wrapping:")
    generic_tool = MockGenericTool("processor")
    wrapped_generic = hl.wrap_tool(generic_tool)
    
    print(f"Original tool type: {type(generic_tool).__name__}")
    print(f"Wrapped tool type: {type(wrapped_generic).__name__}")
    print(f"Tool name preserved: {wrapped_generic.name}")
    print()
    
    # Test 4: Demonstrate approval flow
    print("4. Testing approval flow (you'll be prompted for approval):")
    print("Calling wrapped LangChain tool - you should see approval prompt...")
    try:
        result = wrapped_langchain._run("test query")
        print(f"Result: {result}")
    except Exception as e:
        print(f"Error or denial: {e}")
    
    print("\n=== Example Complete ===")
    print("\nThis demonstrates how wrap_tool() eliminates the need for manual wrapper classes!")
    print("You can now wrap existing tool instances directly:")
    print("  safe_tools = [hl.wrap_tool(tool) for tool in existing_tools]")


if __name__ == "__main__":
    main()