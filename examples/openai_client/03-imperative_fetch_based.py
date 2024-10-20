# look. i get it. sometimes you hate frameworks
#
# if you're a top-tier extra-based AI engineer,
# you're probably thinking
# "i can just use the chat completions api."
# "I don't need to import 20k lines of framework bloat just to get one 150-line while loop"
# "Heck. Gimme the unfiltered raw API. I'm a big kid now."
#
# Welcome. We're glad you're here.
#
# Below is an example of how to use humanlayer imperatively
# in your own hand-rolled loop or even outside the context
# of an agentic tool-calling loop.
#
# For example
#
#  hl.create(call: FunctionCall) -> FunctionCall
#
#  call = hl.get(call_id: str) -> FunctionCall
#  while call.approved is None:
#      asyncio.sleep(5) # i don't know, roll your own loop however you want
#      call = hl.get(call_id)
#  if call.approved:
#      return functions[call.fn](**call.kwargs)
#  else:
#      raise Exception(f"call {call.fn} not approved")
#
#
#
# Go ahead. Take the reins off. You're an adult, you can do whatever you want, and you earned this.
#
# . stay based friend
#
import json
import logging
import time

from dotenv import load_dotenv
from openai import OpenAI

from humanlayer import HumanLayer
from humanlayer.core.models import FunctionCallSpec

load_dotenv()

hl = HumanLayer(
    verbose=True,
    # run_id is optional -it can be used to identify the agent in approval history
    run_id="openai-imperative-fetch-03",
)

PROMPT = "multiply 2 and 5, then add 32 to the result"


def add(x: int, y: int) -> int:
    """Add two numbers together."""
    return x + y


def multiply(x: int, y: int) -> int:
    """multiply two numbers"""
    return x * y


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


def run_chain(prompt: str, tools_openai: list[dict]) -> str:
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
                function_args = json.loads(tool_call.function.arguments)
                function_response_json: str

                # who needs hash maps? switch statements are the purest form of polymorphism
                if function_name == "add":
                    logger.info("CALL tool %s with %s", function_name, function_args)
                    function_result = add(**function_args)
                    function_response_json = json.dumps(function_result)

                # you're in charge now. go forth and multiply
                elif function_name == "multiply":
                    logger.info("CALL tool %s with %s", function_name, function_args)
                    call = hl.create_function_call(
                        spec=FunctionCallSpec(
                            fn="add",
                            kwargs=function_args,
                        ),
                        # call_id is optional but you can supply it if you want,
                        # in this case the openai tool_call_id is a natural choice
                        call_id=tool_call.id,
                    )
                    # loop until the call is approved
                    while (not call.status) or (call.status.approved is None):
                        time.sleep(5)
                        call = hl.get_function_call(call_id=tool_call.id)
                    if call.status.approved:
                        function_result = multiply(**function_args)
                        function_response_json = json.dumps(function_result)
                    else:
                        function_response_json = json.dumps(
                            {"error": f"call {call.spec.fn} not approved, comment was {call.status.comment}"}
                        )

                else:
                    raise Exception(f"unknown function {function_name}")  # noqa: TRY002

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

    result = run_chain(PROMPT, math_tools_openai)
    print("\n\n----------Result----------\n\n")
    print(result)
