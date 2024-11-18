import json
import logging

from openai import AsyncOpenAI
from humanlayer import HumanLayer, FunctionCallSpec
import chainlit as cl

from dotenv import load_dotenv
import os, time

load_dotenv()


hl = HumanLayer.cloud(verbose=True)


# add can be called without approval
@cl.step(type="tool")
async def fetch_active_orders(email: str) -> int:
    """Fetch active orders."""
    return [1]


@cl.step(type="tool")
async def reimburse_order(order_id, reason) -> int:
    import uuid

    call = await cl.make_async(hl.create_function_call)(
        spec=FunctionCallSpec(
            fn="reimburse_order",
            kwargs={"order_id": order_id, "reason": reason},
        ),
    )
    with cl.Step(name="Checking with Human") as step:
        while (not call.status) or (call.status.approved is None):
            await cl.sleep(3)
            call = hl.get_function_call(call_id=call.call_id)
        if call.status.approved:
            # some reimbursement logic here
            function_response_json = json.dumps(True)
        else:
            function_response_json = json.dumps(
                {"error": f"call {call.spec.fn} not approved, comment was {call.status.comment}"}
            )
        step.output = function_response_json
    return function_response_json


math_tools_map = {
    "reimburse_order": reimburse_order,
    "fetch_active_orders": fetch_active_orders,
}

math_tools_openai = [
    {
        "type": "function",
        "function": {
            "name": "reimburse_order",
            "description": "Reimburses an order.",
            "parameters": {
                "type": "object",
                "properties": {
                    "order_id": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["order_id", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_active_orders",
            "description": "Fetches active orders using the user's email.",
            "parameters": {
                "type": "object",
                "properties": {
                    "email": {"type": "string"},
                },
            },
        },
    },
]

logger = logging.getLogger(__name__)


async def run_chain(messages: list[dict], tools_openai: list[dict], tools_map: dict) -> str:
    client = AsyncOpenAI()
    response = await client.chat.completions.create(
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
            logger.info("last message led to %s tool calls", len(tool_calls))
            for tool_call in tool_calls:
                function_name = tool_call.function.name
                function_to_call = tools_map[function_name]
                function_args = json.loads(tool_call.function.arguments)
                logger.info("CALL tool %s with %s", function_name, function_args)

                function_response_json: str
                try:
                    function_response = await function_to_call(**function_args)
                    function_response_json = json.dumps(function_response)
                except Exception as e:
                    function_response_json = json.dumps(
                        {
                            "error": str(e),
                        }
                    )

                logger.info("tool %s responded with %s", function_name, function_response_json[:200])
                messages.append(
                    {
                        "tool_call_id": tool_call.id,
                        "role": "tool",
                        "name": function_name,
                        "content": function_response_json,
                    }
                )  # extend conversation with function response
        response = await client.chat.completions.create(
            model="gpt-4o",
            temperature=0.3,
            messages=messages,
            tools=tools_openai,
        )

    return response.choices[0].message.content


@cl.on_chat_start
def start_chat():
    cl.user_session.set(
        "message_history",
        # could pass user email as a parameter
        [
            {
                "role": "system",
                "content": f"You are a helpful assistant, helping john@gmail.com. If the user asks for anything that requires order information, you should use the fetch_active_orders tool first.",
            }
        ],
    )


@cl.on_message
async def on_message(message: cl.Message):
    message_history = cl.user_session.get("message_history")
    message_history.append({"role": "user", "content": message.content})

    logging.basicConfig(level=logging.INFO)

    result = await run_chain(message_history, math_tools_openai, math_tools_map)
    await cl.Message(content=result).send()
