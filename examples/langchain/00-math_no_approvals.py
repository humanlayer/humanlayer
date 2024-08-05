#
# for comparison, a bare-bones math example
# with no approvals required
#
from langchain.agents import initialize_agent
from langchain.agents import AgentType
from langchain.tools import tool
from langchain_openai import ChatOpenAI

from dotenv import load_dotenv

load_dotenv()


@tool
def add(x: int, y: int) -> int:
    """Add two numbers together."""
    return x + y


@tool
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

if __name__ == "__main__":
    result = agent.run("multiply 2 and 5, then add 32 to the result")
    print("\n\n----------Result----------\n\n")
    print(result)
