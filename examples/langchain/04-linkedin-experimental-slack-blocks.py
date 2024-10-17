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
    run_id="langchain-linkedin-experimental-slack-blocks",
)

task_prompt = """

You are the linkedin inbox assistant. You check on
the CEO's linkedin inbox and decide if there are any messages
that seem interesting.

Don't respond to spam-looking messages

Send replies to new messages that seem legitimate, and offer to schedule time.

For users who have not responded to a previous message in a few days, follow up with a reminder.

"""


class LinkedInMessage(BaseModel):
    from_name: str
    date: str
    message: str


class LinkedInThread(BaseModel):
    thread_id: str
    thread_url: str
    with_name: str
    messages: list[LinkedInMessage]


def get_time() -> str:
    """get the current time"""
    return datetime.now().isoformat()


def get_linkedin_threads() -> list[LinkedInThread]:
    """get the linkedin threads in the inbox"""
    return [
        LinkedInThread(
            thread_id="123",
            thread_url="https://linkedin.com/in/msg/123",
            with_name="Danny",
            messages=[
                LinkedInMessage(
                    message="Hello, i am wondering if you are interested to try our excellent offshore "
                    "developer service",
                    from_name="Danny",
                    date="2024-08-17",
                )
            ],
        ),
        LinkedInThread(
            thread_id="124",
            with_name="Sarah",
            thread_url="https://linkedin.com/in/msg/124",
            messages=[
                LinkedInMessage(
                    message="Hello, I am interested in your product, what's the best way to get started",
                    from_name="Sarah",
                    date="2024-08-16",
                )
            ],
        ),
        LinkedInThread(
            thread_id="125",
            with_name="Terri",
            thread_url="https://linkedin.com/in/msg/125",
            messages=[
                LinkedInMessage(
                    message="Hello, I am interested in your product, what's the best way to get started",
                    from_name="Terri",
                    date="2024-08-12",
                ),
                LinkedInMessage(
                    message="I would be happy to give you a demo - please let me know when you're "
                    "available, or you can book time at http://calendly.com/im-the-ceo",
                    from_name="you",
                    date="2024-08-12",
                ),
            ],
        ),
    ]


channel = ContactChannel(
    slack=SlackContactChannel(
        channel_or_user_id="C07HR5JL15F",
        context_about_channel_or_user="the dm with the CEO",
        experimental_slack_blocks=True,
    ),
)


@hl.require_approval(contact_channel=channel)
def send_linkedin_messages(message: list[Any]) -> str:
    """send a set messages on LinkedIn"""
    return f"messages successfully sent"


tools = [
    langchain_tools.StructuredTool.from_function(get_linkedin_threads),
    langchain_tools.StructuredTool.from_function(send_linkedin_messages),
    langchain_tools.StructuredTool.from_function(get_time),
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
