import json
import logging

from dotenv import load_dotenv
from openai import OpenAI

from humanlayer import HumanLayer

load_dotenv()

hl = HumanLayer(
    verbose=True,
    # run_id is optional -it can be used to identify the agent in approval history
    run_id="openai-math-example",
)

PROMPT = "multiply 2 and 5, then add 32 to the result"


def add(x: int, y: int) -> int:
    """Add two numbers together."""
    return x + y


@hl.require_approval()
def multiply(x: int, y: int) -> int:
    """multiply two numbers"""
    return x * y


math_tools_map = {
    "add": add,
    "multiply": multiply,
}

math_tools_openai = [
    {
        "type": "function",
        "function": {
            "name": "add",
            "description": "Add two numbers together.",
            "parameters": {
                "type": "object",
                "properties": {
                    "x": {"type": "number"},
                    "y": {"type": "number"},
                },
                "required": ["x", "y"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "multiply",
            "description": "multiply two numbers",
            "parameters": {
                "type": "object",
                "properties": {
                    "x": {"type": "number"},
                    "y": {"type": "number"},
                },
                "required": ["x", "y"],
            },
        },
    },
]

logger = logging.getLogger(__name__)


def run_chain(prompt: str, tools_openai: list[dict], tools_map: dict) -> str:
    client = OpenAI()
    messages = [{"role": "user", "content": prompt}]
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=messages,
        tools=tools_openai,
        tool_choice="auto",
    )

    while response.choices[0].finish_reason != "stop":
        response_message = response.choices[0].message
        tool_calls = response_message.tool_calls
        if tool_calls:
            messages.append(response_message)  # extend conversation with assistant's reply
            logger.info(
                "last message led to %s tool calls: %s",
                len(tool_calls),
                [(tool_call.function.name, tool_call.function.arguments) for tool_call in tool_calls],
            )
            for tool_call in tool_calls:
                function_name = tool_call.function.name
                function_to_call = tools_map[function_name]
                function_args = json.loads(tool_call.function.arguments)
                logger.info("CALL tool %s with %s", function_name, function_args)

                function_response_json: str
                try:
                    function_response = function_to_call(**function_args)
                    function_response_json = json.dumps(function_response)
                except Exception as e:
                    function_response_json = json.dumps(
                        {
                            "error": str(e),
                        }
                    )

                logger.info(
                    "tool %s responded with %s",
                    function_name,
                    function_response_json[:200],
                )
                messages.append(
                    {
                        "tool_call_id": tool_call.id,
                        "role": "tool",
                        "name": function_name,
                        "content": function_response_json,
                    }
                )  # extend conversation with function response
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            tools=tools_openai,
        )

    return response.choices[0].message.content


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    result = run_chain(PROMPT, math_tools_openai, math_tools_map)
    print("\n\n----------Result----------\n\n")
    print(result)
