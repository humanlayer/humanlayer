from dotenv import load_dotenv
from langchain.agents import AgentType, initialize_agent
from langchain_openai import ChatOpenAI
from langchain.tools import StructuredTool

from humanlayer import ContactChannel, HumanLayer, SlackContactChannel

load_dotenv()

hl = HumanLayer(
    verbose=True,
    run_id="langchain-math-allowed-repliers",
)

# Define channels with specific allowed responders
add_approver_channel = ContactChannel(
    slack=SlackContactChannel(
        channel_or_user_id="C07HR5JL15F",  # Using the same channel as other examples
        context_about_channel_or_user="the channel for add operations",
        allowed_responder_ids=["U07HR5DNQBB"],  # Only this user can approve add operations
    )
)

multiply_approver_channel = ContactChannel(
    slack=SlackContactChannel(
        channel_or_user_id="C07HR5JL15F",  # Using the same channel as other examples
        context_about_channel_or_user="the channel for multiply operations",
        allowed_responder_ids=["U07H7AGMA22"],  # Only this user can approve multiply operations
    )
)


@hl.require_approval(contact_channel=add_approver_channel)
def add(a: float, b: float) -> float:
    """Add two numbers"""
    return a + b


@hl.require_approval(contact_channel=multiply_approver_channel)
def multiply(a: float, b: float) -> float:
    """Multiply two numbers"""
    return a * b


tools = [
    StructuredTool.from_function(add),
    StructuredTool.from_function(multiply),
]

llm = ChatOpenAI(model="gpt-4", temperature=0)
agent = initialize_agent(
    tools=tools,
    llm=llm,
    agent=AgentType.OPENAI_FUNCTIONS,
    verbose=True,
)

if __name__ == "__main__":
    result = agent.run("What is (4 + 5) * 3?")
    print("\n\n----------Result----------\n\n")
    print(result)
