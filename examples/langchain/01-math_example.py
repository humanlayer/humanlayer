#
# an example that runs some langchain math operations
# where the multiply function requires approval
# via humanlayer
#
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

from humanlayer.core.approval import HumanLayer
from langchain.agents import AgentType, initialize_agent
from langchain.tools import tool

load_dotenv()

hl = HumanLayer(
    verbose=True,
    # run_id is optional -it can be used to identify the agent in approval history
    run_id="langchain-math",
)


@tool
def add(x: int, y: int) -> int:
    """Add two numbers together."""
    return x + y


@tool
@hl.require_approval()
def multiply(x: int, y: int) -> int:
    """multiply two numbers"""
    return x * y


tools = [add.as_tool(), multiply.as_tool()]

llm = ChatOpenAI(model="gpt-4o", temperature=0)
agent = initialize_agent(
    tools,
    llm,
    agent=AgentType.OPENAI_FUNCTIONS,
    verbose=True,
    handle_parsing_errors=True,
)


def main():
    result = agent.run("multiply 2 and 5, then add 32 to the result")
    print("\n\n----------Result----------\n\n")
    print(result)


if __name__ == "__main__":
    main()
