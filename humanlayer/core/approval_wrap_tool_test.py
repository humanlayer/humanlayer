from unittest.mock import Mock

import pytest

from humanlayer import (
    AgentBackend,
    ContactChannel,
    FunctionCall,
    FunctionCallSpec,
    HumanLayer,
    ResponseOption,
    SlackContactChannel,
)
from humanlayer.core.models import FunctionCallStatus
from humanlayer.core.protocol import AgentStore, HumanLayerException


# Mock tool classes for testing
class MockLangChainTool:
    def __init__(self, name: str, description: str):
        self.name = name
        self.description = description
    
    def _run(self, query: str) -> str:
        return f"LangChain tool '{self.name}' executed with: {query}"
    
    async def _arun(self, query: str) -> str:
        return f"Async LangChain tool '{self.name}' executed with: {query}"


class MockCrewAITool:
    def __init__(self, name: str, description: str):
        self.name = name
        self.description = description
        self.args_schema = None  # CrewAI-specific attribute
    
    def _run(self, query: str) -> str:
        return f"CrewAI tool '{self.name}' executed with: {query}"


class MockGenericTool:
    def __init__(self, name: str):
        self.name = name
    
    def execute(self, data: str) -> str:
        return f"Generic tool '{self.name}' executed with: {data}"


class MockUnknownTool:
    def __init__(self, name: str):
        self.name = name
    
    def some_method(self, data: str) -> str:
        return f"Unknown tool '{self.name}' executed with: {data}"


def test_wrap_tool_langchain() -> None:
    """Test wrapping a LangChain-style tool."""
    mock_backend = Mock(spec=AgentBackend)
    functions = Mock(spec=AgentStore[FunctionCall, FunctionCallStatus])
    mock_backend.functions.return_value = functions

    function_call = FunctionCall(
        run_id="generated-id",
        call_id="generated-id",
        spec=FunctionCallSpec(fn="_run", kwargs={"query": "test"}, channel=None),
    )
    functions.add.return_value = function_call
    functions.get.return_value = function_call.model_copy(
        deep=True, update={"status": FunctionCallStatus(approved=True)}
    )

    hl = HumanLayer(
        backend=mock_backend,
        genid=lambda x: "generated-id",
        sleep=lambda x: None,
    )

    # Create original tool
    original_tool = MockLangChainTool("search", "Search for information")
    
    # Wrap it
    wrapped_tool = hl.wrap_tool(original_tool)
    
    # Verify the wrapped tool preserves original attributes
    assert wrapped_tool.name == "search"
    assert wrapped_tool.description == "Search for information"
    assert type(wrapped_tool).__name__ == "WrappedLangChainTool"
    
    # Test execution goes through approval
    result = wrapped_tool._run("test query")
    assert result == "LangChain tool 'search' executed with: test query"
    
    # Verify approval was called
    functions.add.assert_called_once()
    functions.get.assert_called_once_with("generated-id")


def test_wrap_tool_crewai() -> None:
    """Test wrapping a CrewAI-style tool."""
    mock_backend = Mock(spec=AgentBackend)
    functions = Mock(spec=AgentStore[FunctionCall, FunctionCallStatus])
    mock_backend.functions.return_value = functions

    function_call = FunctionCall(
        run_id="generated-id",
        call_id="generated-id",
        spec=FunctionCallSpec(fn="_run", kwargs={"query": "test"}, channel=None),
    )
    functions.add.return_value = function_call
    functions.get.return_value = function_call.model_copy(
        deep=True, update={"status": FunctionCallStatus(approved=True)}
    )

    hl = HumanLayer(
        backend=mock_backend,
        genid=lambda x: "generated-id",
        sleep=lambda x: None,
    )

    # Create original tool
    original_tool = MockCrewAITool("analyze", "Analyze data")
    
    # Wrap it
    wrapped_tool = hl.wrap_tool(original_tool)
    
    # Verify the wrapped tool preserves original attributes
    assert wrapped_tool.name == "analyze"
    assert wrapped_tool.description == "Analyze data"
    assert wrapped_tool.args_schema is None
    assert type(wrapped_tool).__name__ == "WrappedCrewAITool"
    
    # Test execution goes through approval
    result = wrapped_tool._run("test data")
    assert result == "CrewAI tool 'analyze' executed with: test data"
    
    # Verify approval was called
    functions.add.assert_called_once()
    functions.get.assert_called_once_with("generated-id")


def test_wrap_tool_generic() -> None:
    """Test wrapping a generic tool."""
    mock_backend = Mock(spec=AgentBackend)
    functions = Mock(spec=AgentStore[FunctionCall, FunctionCallStatus])
    mock_backend.functions.return_value = functions

    function_call = FunctionCall(
        run_id="generated-id",
        call_id="generated-id",
        spec=FunctionCallSpec(fn="execute", kwargs={"data": "test"}, channel=None),
    )
    functions.add.return_value = function_call
    functions.get.return_value = function_call.model_copy(
        deep=True, update={"status": FunctionCallStatus(approved=True)}
    )

    hl = HumanLayer(
        backend=mock_backend,
        genid=lambda x: "generated-id",
        sleep=lambda x: None,
    )

    # Create original tool
    original_tool = MockGenericTool("processor")
    
    # Wrap it
    wrapped_tool = hl.wrap_tool(original_tool)
    
    # Verify the wrapped tool preserves original attributes
    assert wrapped_tool.name == "processor"
    assert type(wrapped_tool).__name__ == "WrappedGenericTool"
    
    # Test execution goes through approval
    result = wrapped_tool.execute("test data")
    assert result == "Generic tool 'processor' executed with: test data"
    
    # Verify approval was called
    functions.add.assert_called_once()
    functions.get.assert_called_once_with("generated-id")


def test_wrap_tool_with_contact_channel() -> None:
    """Test wrapping a tool with a contact channel."""
    mock_backend = Mock(spec=AgentBackend)
    functions = Mock(spec=AgentStore[FunctionCall, FunctionCallStatus])
    mock_backend.functions.return_value = functions

    contact_channel = ContactChannel(
        slack=SlackContactChannel(
            channel_or_user_id="U8675309",
            context_about_channel_or_user="a dm with the librarian",
        )
    )

    function_call = FunctionCall(
        run_id="generated-id",
        call_id="generated-id",
        spec=FunctionCallSpec(fn="_run", kwargs={"query": "test"}, channel=contact_channel),
    )
    functions.add.return_value = function_call
    functions.get.return_value = function_call.model_copy(
        deep=True, update={"status": FunctionCallStatus(approved=True)}
    )

    hl = HumanLayer(
        backend=mock_backend,
        genid=lambda x: "generated-id",
        sleep=lambda x: None,
    )

    # Create and wrap tool with contact channel
    original_tool = MockLangChainTool("search", "Search for information")
    wrapped_tool = hl.wrap_tool(original_tool, contact_channel=contact_channel)
    
    # Test execution
    result = wrapped_tool._run("test query")
    assert result == "LangChain tool 'search' executed with: test query"
    
    # Verify approval was called with contact channel
    functions.add.assert_called_once()
    call_args = functions.add.call_args[0][0]
    assert call_args.spec.channel == contact_channel


def test_wrap_tool_with_reject_options() -> None:
    """Test wrapping a tool with reject options."""
    mock_backend = Mock(spec=AgentBackend)
    functions = Mock(spec=AgentStore[FunctionCall, FunctionCallStatus])
    mock_backend.functions.return_value = functions

    reject_options = [
        ResponseOption(
            name="deny",
            title="Deny Request",
            description="Deny this request",
            prompt_fill="Request denied",
        )
    ]

    function_call = FunctionCall(
        run_id="generated-id",
        call_id="generated-id",
        spec=FunctionCallSpec(fn="_run", kwargs={"query": "test"}, channel=None, reject_options=reject_options),
    )
    functions.add.return_value = function_call
    functions.get.return_value = function_call.model_copy(
        deep=True, update={"status": FunctionCallStatus(approved=True)}
    )

    hl = HumanLayer(
        backend=mock_backend,
        genid=lambda x: "generated-id",
        sleep=lambda x: None,
    )

    # Create and wrap tool with reject options
    original_tool = MockLangChainTool("search", "Search for information")
    wrapped_tool = hl.wrap_tool(original_tool, reject_options=reject_options)
    
    # Test execution
    result = wrapped_tool._run("test query")
    assert result == "LangChain tool 'search' executed with: test query"
    
    # Verify approval was called
    functions.add.assert_called_once()


def test_wrap_tool_unique_reject_option_names() -> None:
    """Test that wrap_tool validates unique reject option names."""
    hl = HumanLayer()
    original_tool = MockLangChainTool("search", "Search for information")
    
    with pytest.raises(HumanLayerException) as e:
        hl.wrap_tool(
            original_tool,
            reject_options=[
                ResponseOption(
                    name="foo",
                    title="foo",
                    description="foo",
                    prompt_fill="foo",
                ),
                ResponseOption(
                    name="foo",
                    title="bar",
                    description="bar",
                    prompt_fill="bar",
                ),
            ]
        )

    assert "reject_options must have unique names" in str(e.value)


def test_wrap_tool_unknown_type_fails() -> None:
    """Test that wrapping an unknown tool type fails gracefully."""
    hl = HumanLayer()
    unknown_tool = MockUnknownTool("unknown")
    
    with pytest.raises(HumanLayerException) as e:
        hl.wrap_tool(unknown_tool)
    
    assert "Could not find any wrappable methods" in str(e.value)
    assert "MockUnknownTool" in str(e.value)


def test_wrap_tool_cli_mode() -> None:
    """Test wrapping a tool in CLI mode."""
    hl = HumanLayer.cli()
    
    # Create original tool
    original_tool = MockLangChainTool("search", "Search for information")
    
    # Wrap it (should not raise)
    wrapped_tool = hl.wrap_tool(original_tool)
    
    # Verify the wrapped tool preserves original attributes
    assert wrapped_tool.name == "search"
    assert wrapped_tool.description == "Search for information"
    assert type(wrapped_tool).__name__ == "WrappedLangChainTool"
    
    # Note: We can't easily test CLI execution without mocking input()


def test_is_langchain_tool() -> None:
    """Test LangChain tool detection."""
    hl = HumanLayer()
    
    langchain_tool = MockLangChainTool("search", "Search for information")
    crewai_tool = MockCrewAITool("analyze", "Analyze data")
    generic_tool = MockGenericTool("processor")
    
    assert hl._is_langchain_tool(langchain_tool) is True
    assert hl._is_langchain_tool(crewai_tool) is False  # CrewAI has additional attributes
    assert hl._is_langchain_tool(generic_tool) is False


def test_is_crewai_tool() -> None:
    """Test CrewAI tool detection."""
    hl = HumanLayer()
    
    langchain_tool = MockLangChainTool("search", "Search for information")
    crewai_tool = MockCrewAITool("analyze", "Analyze data")
    generic_tool = MockGenericTool("processor")
    
    assert hl._is_crewai_tool(langchain_tool) is False
    assert hl._is_crewai_tool(crewai_tool) is True
    assert hl._is_crewai_tool(generic_tool) is False