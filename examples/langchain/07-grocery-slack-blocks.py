from datetime import datetime
from typing import Any

import langchain_core.tools as langchain_tools
from dotenv import load_dotenv
from langchain.agents import AgentType, initialize_agent
from langchain_openai import ChatOpenAI
from pydantic import BaseModel

from channels import (
    dm_with_ceo,
)
from humanlayer import ContactChannel, SlackContactChannel
from humanlayer.core.approval import (
    HumanLayer,
)

load_dotenv()

hl = HumanLayer(
    verbose=True,
    # run_id is optional -it can be used to identify the agent in approval history
    run_id="langchain-grocery-slack-blocks",
)

task_prompt = """

You are the mealprep power assistant.

You are responsible for planning the meals and shopping
for a very busy and high-profile and health-conscious tech CEO.

choose a meal plan based on your best judgement,
i like tacos and sushi, but i'm open to new ideas.

I like to eat healthy, and I'm trying to lose weight.

Make the best decision and order the groceries. Don't confirm with me.

"""


channel = ContactChannel(
    slack=SlackContactChannel(
        channel_or_user_id="C07HR5JL15F",
        experimental_slack_blocks=True,
    ),
)


@hl.require_approval(contact_channel=channel)
def buy_groceries(items: list[Any], total_cost: int) -> str:
    """purchase a cart of groceries. Include structured data about the quantity
    and price, for example:

    [
      {
        "item": "bananas",
        "quantity": 2,
        "price": 1.99
      },
      {
        "item": "Organic 2% Milk, 3 x 64oz",
        "quantity": 1,
        "price": 11.99
      },
      {
        "item": "Organic Chicken Breast, 2lbs",
        "quantity": 1,
        "price": 9.99
      }
    ]
    """
    return f"Items purchased, total cost: {total_cost}"


tools = [
    langchain_tools.StructuredTool.from_function(buy_groceries),
    langchain_tools.StructuredTool.from_function(hl.human_as_tool(contact_channel=channel)),
]

llm = ChatOpenAI(model="gpt-4o", temperature=0)
agent = initialize_agent(
    tools=tools,
    llm=llm,
    agent=AgentType.OPENAI_FUNCTIONS,
    verbose=True,
    handle_parsing_errors=True,
)

if __name__ == "__main__":
    result = agent.run(task_prompt)
    print("\n\n----------Result----------\n\n")
    print(result)
