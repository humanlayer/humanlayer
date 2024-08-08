#
# an example that runs some langchain math operations
# where the multiply function requires approval
# via functionlayer, and FunctionLayer is configured to
# use local / CLI mode
#
from langchain.agents import initialize_agent
from langchain.agents import AgentType
from langchain.tools import tool
from langchain_openai import ChatOpenAI
from functionlayer import FunctionLayer

from dotenv import load_dotenv

load_dotenv()

fl = FunctionLayer()


@tool
def add(x: int, y: int) -> int:
    """Add two numbers together."""
    return x + y


@tool
@fl.require_approval()
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
