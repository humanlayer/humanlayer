"""
the summer marketing intern wrote an onboarding assistant
to keep up to date with customers by emailing
them suggestions.

they want the agent to collaborate with their boss, the head of
marketing to ensure emails are well-written and likely to
achieve the desired outcome.

The intern doesn't want the agent to annoy the head of marketing
or ask questions that don't make sense, so they
wrap the "contact head of marketing" tool in an
approval requirement, so they can review any messages that would
be sent to the head of marketing.

"""

import langchain_core.tools as langchain_tools
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

from humanlayer import (
    HumanLayer,
)
from langchain.agents import AgentType, initialize_agent

from channels import (
    dm_with_head_of_marketing,
    dm_with_summer_intern,
)

load_dotenv()

hl = HumanLayer(
    verbose=True,
    # run_id is optional -it can be used to identify the agent in approval history
    run_id="langchain-approvals-and-humans-composite",
)

task_prompt = """

You are the email onboarding assistant. You check on the progress customers
are making and get other information, then based on that info, you
send friendly and encouraging emails to customers to help them

Before sending an email, you check with the head of marketing for feedback,
and incorporate that feedback into your email before sending. You repeat the
feedback process until the head of marketing approves the request

Your task is to prepare an email to send to the customer danny@metacorp.com

"""


def get_info_about_customer(customer_email: str) -> str:
    """get info about a customer"""
    return """
    This customer has completed most of the onboarding steps,
    but still needs to invite a few team members before they can be considered fully onboarded
    """


def send_email(email: str, message: str) -> str:
    """Send an email to a user"""
    return f"Email sent to {email} with message: {message}"


tools = [
    langchain_tools.StructuredTool.from_function(get_info_about_customer),
    langchain_tools.StructuredTool.from_function(send_email),
    langchain_tools.StructuredTool.from_function(
        # allow the agent to contact the head of marketing,
        # but require approval from the summer intern before sending
        hl.require_approval(contact_channel=dm_with_summer_intern).wrap(
            hl.human_as_tool(contact_channel=dm_with_head_of_marketing)
        )
    ),
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
