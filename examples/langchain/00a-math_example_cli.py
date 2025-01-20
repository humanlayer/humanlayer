#
# an example that runs some langchain math operations
# where the multiply function requires approval
# via HumanLayer, and HumanLayer is configured to
# use local / CLI mode
#
from dotenv import load_dotenv
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

import langchain.tools
from humanlayer import HumanLayer
from langchain.agents import AgentExecutor, create_tool_calling_agent

load_dotenv()

hl = HumanLayer(
    verbose=True,
    # run_id is optional -it can be used to identify the agent in approval history
    run_id="langchain-math",
)


def add(x: int, y: int) -> int:
    """Add two numbers together."""
    return x + y


@hl.require_approval()
def multiply(x: int, y: int) -> int:
    """multiply two numbers"""
    return x * y


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

def main() -> None:
    result = agent_executor.invoke({"input": "multiply 2 and 5, then add 32 to the result"})
    print("\n\n----------Result----------\n\n")
    print(result)


if __name__ == "__main__":
    main()
