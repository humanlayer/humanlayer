import langchain_core.tools as langchain_tools
from dotenv import load_dotenv
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_tool_calling_agent

from humanlayer import (
    HumanLayer,
)

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

# Prompt for creating Tool Calling Agent
prompt = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You are a helpful assistant.",
        ),
        ("placeholder", "{chat_history}"),
        ("human", "{input}"),
        ("placeholder", "{agent_scratchpad}"),
    ]
)

# Construct the Tool Calling Agent
agent = create_tool_calling_agent(llm, tools, prompt)
agent_executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

if __name__ == "__main__":
    result = agent_executor.invoke({"input": task_prompt})
    print("\n\n----------Result----------\n\n")
    print(result)
