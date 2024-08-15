import langchain_core.tools as langchain_tools
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

from humanlayer import (
    ContactChannel,
    HumanLayer,
    SlackContactChannel,
)
from langchain.agents import AgentType, initialize_agent

load_dotenv()

hl = HumanLayer()

task_prompt = """
figure out the wizard's favorite color,
contact a human for help if you need it
"""

tools = [
    # langchain_tools.StructuredTool.from_function(hl.human_as_tool()),
    langchain_tools.StructuredTool.from_function(
        hl.human_as_tool(
            contact_channel=ContactChannel(
                slack=SlackContactChannel(
                    channel_or_user_id="C07BU3B7DBM",
                    context_about_channel_or_user="a DM with a bridge troll",
                ),
            )
        )
    ),
    langchain_tools.StructuredTool.from_function(
        hl.human_as_tool(
            contact_channel=ContactChannel(
                slack=SlackContactChannel(
                    channel_or_user_id="C07BU3B7DBM",
                    context_about_channel_or_user="a DM with the wizard",
                ),
            )
        )
    ),
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
