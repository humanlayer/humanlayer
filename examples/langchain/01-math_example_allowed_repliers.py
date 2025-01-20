from dotenv import load_dotenv
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
import langchain.tools
from langchain.agents import AgentExecutor, create_tool_calling_agent

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
    langchain.tools.StructuredTool.from_function(add),
    langchain.tools.StructuredTool.from_function(multiply),
]

llm = ChatOpenAI(model="gpt-4", temperature=0)

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
    result = agent_executor.invoke({"input": "What is (4 + 5) * 3?"})
    print("\n\n----------Result----------\n\n")
    print(result)
