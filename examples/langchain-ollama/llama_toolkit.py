import functools
import os
import json
from typing import Any, Callable, Dict

from langchain.agents import AgentType, initialize_agent
from langchain.callbacks.base import BaseCallbackHandler
from langchain.prompts import PromptTemplate
from langchain.schema import AgentAction
from langchain.tools import StructuredTool
from langchain_ollama import OllamaLLM
from dotenv import load_dotenv


load_dotenv()


class FunctionInvocationHandler(BaseCallbackHandler):
    """Handles function invocation display and logging"""

    def on_tool_start(
        self,
        serialized: Dict[str, Any],
        input_str: str,
        **kwargs: Any,
    ) -> None:
        """Display function invocation in a structured format"""
        tool_name = serialized.get("name", "unknown_tool")
        try:
            # Parse input and format it nicely
            if isinstance(input_str, str):
                try:
                    input_dict = json.loads(input_str)
                except:
                    input_dict = {"input": input_str}
            else:
                input_dict = input_str

            print(f"\nInvoking: `{tool_name}` with arguments:")
            for key, value in input_dict.items():
                print(f"  - {key}: {value}")
        except Exception as e:
            print(f"\nInvoking: `{tool_name}` with: {input_str}")

    def on_tool_end(self, output: str, **kwargs: Any) -> None:
        """Display function output"""
        print(f"Result: {output}\n")

    def on_agent_action(self, action: AgentAction, **kwargs: Any) -> Any:
        """Log agent's thought process"""
        print(f"Thought: {action.log}")


class LlamaToolkit:
    """Toolkit for managing custom functions with Llama"""

    def __init__(self, model_name: str = "llama3.1", temperature: float = 0.1):
        self.tools = []
        self.model_name = model_name
        self.temperature = temperature
        self.callback_handler = FunctionInvocationHandler()

    def add_function(self, name: str = None, description: str = None):
        """A decorator to add a function to the toolkit"""

        def decorator(func: Callable):
            nonlocal name, description
            if name is None:
                name = func.__name__
            if description is None:
                description = func.__doc__ or f"Tool that calls the {name} function"

            @functools.wraps(func)
            def wrapped_func(*args, **kwargs):
                try:
                    result = func(*args, **kwargs)
                    return result
                except Exception as e:
                    return f"Error in {name}: {str(e)}"

            tool = StructuredTool.from_function(
                func=wrapped_func, name=name, description=description, return_direct=False
            )

            self.tools.append(tool)
            return wrapped_func

        return decorator

    def create_agent(self):
        """Create a Llama agent with the registered tools"""
        llm = OllamaLLM(model=self.model_name, temperature=self.temperature)

        # Custom prompt template
        template = """you are math expert that can answer math questions.

        When performing tasks:
            1. If a suitable tool is available, you may use it
            2. If no tool is available, use your own intelligence to solve the problem
            3. Never refuse to help just because a tool is missing



        Available functions:
        {tools}

        Human: {input}
        Assistant: Let me help you solve this step by step.
        {agent_scratchpad}
        """

        prompt = PromptTemplate(input_variables=["tools", "input", "agent_scratchpad"], template=template)

        return initialize_agent(
            tools=self.tools,
            llm=llm,
            agent=AgentType.STRUCTURED_CHAT_ZERO_SHOT_REACT_DESCRIPTION,
            verbose=True,
            callbacks=[self.callback_handler],
            handle_parsing_errors=True,
            max_iterations=5,
            agent_kwargs={"prompt": prompt},
        )
