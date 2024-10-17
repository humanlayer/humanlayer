import langchain_core.tools as langchain_tools
from channels import (
    dm_with_ceo,
    dm_with_head_of_marketing,
    dm_with_summer_intern,
)
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

from humanlayer.core.approval import (
    HumanLayer,
)
from langchain.agents import AgentType, initialize_agent

load_dotenv()

hl = HumanLayer(
    verbose=True,
    # run_id is optional -it can be used to identify the agent in approval history
    run_id="langchain-human-as-tool-onboarding",
)

task_prompt = """

You are the email onboarding assistant. You check on the progress customers
are making and get other information, then based on that info, you
send friendly and encouraging emails to customers to help them fully onboard
into the product.

Before sending an email, you check with the head of marketing for feedback,
and incorporate that feedback into your email before sending. You repeat the
feedback process until the head of marketing approves the request

Your task is to prepare an email to send to the customer danny@metacorp.com

"""


def get_info_about_customer(customer_email: str) -> str:
    """get info about a customer"""
    return """
    This customer has completed most of the onboarding steps,
    but still needs to invite a few team members before they can be
    considered fully onboarded
    """


# require CEO approval to send an email
@hl.require_approval(contact_channel=dm_with_ceo)
def send_email(to: str, subject: str, body: str) -> str:
    """Send an email to a user"""
    return f"Email sent to {to} with subject: {subject}"


tools = [
    langchain_tools.StructuredTool.from_function(get_info_about_customer),
    langchain_tools.StructuredTool.from_function(send_email),
    langchain_tools.StructuredTool.from_function(
        # allow the agent to contact the head of marketing for help
        hl.human_as_tool(
            contact_channel=dm_with_head_of_marketing,
        )
    ),
    langchain_tools.StructuredTool.from_function(
        # allow the agent to contact the summer intern
        hl.human_as_tool(
            contact_channel=dm_with_summer_intern,
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
