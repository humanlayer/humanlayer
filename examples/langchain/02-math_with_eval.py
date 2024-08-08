#
# A higher-stakes math example
# where the wrapped method could potentially
# perform arbitrary code execution
#
from langchain.agents import initialize_agent
from langchain.agents import AgentType
from langchain.tools import tool
from langchain_openai import ChatOpenAI
from functionlayer import FunctionLayer, ApprovalMethod

from dotenv import load_dotenv

load_dotenv()

fl = FunctionLayer(approval_method=ApprovalMethod.CLOUD)


@tool
@fl.require_approval()
def run_python_code(code: str) -> str:
    """run a snippet of python code and return the stdout"""
    return str(eval(code))


tools = [run_python_code.as_tool()]

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
