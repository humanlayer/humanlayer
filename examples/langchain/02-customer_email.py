from humanlayer import ContactChannel, SlackContactChannel
from langchain.agents import AgentType, initialize_agent
import langchain_core.tools as langchain_tools
from langchain_openai import ChatOpenAI

from dotenv import load_dotenv


from humanlayer.core.approval import HumanLayer

load_dotenv()

hl = HumanLayer(
    verbose=True,
    contact_channel=ContactChannel(
        slack=SlackContactChannel(
            channel_or_user_id="",
            experimental_slack_blocks=True,
        )
    ),
    # run_id is optional -it can be used to identify the agent in approval history
    run_id="langchain-customer-email",
)

task_prompt = """

You are the email onboarding assistant. You check on the progress customers
are making and then based on that info, you
send friendly and encouraging emails to customers to help them fully onboard
into the product.

Your task is to send an email to the customer danny@example.com

"""


def get_info_about_customer(customer_email: str) -> str:
    """get info about a customer"""
    return """
    This customer has completed most of the onboarding steps,
    but still needs to invite a few team members before they can be
    considered fully onboarded
    """


# require approval to send an email
@hl.require_approval()
def send_email(to: str, subject: str, body: str) -> str:
    """Send an email to a user"""
    return f"Email sent to {to} with subject: {subject}"


tools = [
    langchain_tools.StructuredTool.from_function(get_info_about_customer),
    langchain_tools.StructuredTool.from_function(send_email),
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
