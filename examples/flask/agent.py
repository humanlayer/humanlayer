from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain.agents import AgentType, initialize_agent
from langchain.tools import tool
from humanlayer.core.approval import HumanLayer

load_dotenv()

hl = HumanLayer(
    verbose=True,
    run_id="flask-langchain-math",
)


# add can be called without approval
@tool
def add(x: int, y: int) -> int:
    """Add two numbers together."""
    return x + y


# multiply requires approval
@tool
@hl.require_approval()
def multiply(x: int, y: int) -> int:
    """multiply two numbers"""
    return x * y


def run_agent(prompt: str) -> str:
    """Run the agent with the given prompt and return the result"""
    tools = [add.as_tool(), multiply.as_tool()]
    llm = ChatOpenAI(model="gpt-4", temperature=0)

    agent = initialize_agent(
        tools,
        llm,
        agent=AgentType.OPENAI_FUNCTIONS,
        verbose=True,
        handle_parsing_errors=True,
    )

    return agent.run(prompt)
