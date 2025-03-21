from dotenv import load_dotenv
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
import langchain.tools
from langchain.agents import AgentExecutor, create_tool_calling_agent
from humanlayer import HumanLayer, ContactChannel, SlackContactChannel, FunctionCallSpec, HumanContactSpec
import time

load_dotenv()

hl = HumanLayer(
    verbose=True,
    run_id="langchain-thread-example",
)


def create_thread(message: str) -> str:
    """Creates initial thread message and returns thread_ts"""

    contact = ContactChannel(
        slack=SlackContactChannel(
            channel_or_user_id="C08EDEYS1SB",
            experimental_slack_blocks=True,
        )
    )

    call = hl.fetch_approval(
        spec=FunctionCallSpec(
            fn="test_message",
            kwargs={"message": "Initial thread message", "timestamp": time.time()},
            channel=contact,
        )
    )
    return call.call.status.slack_message_ts


def reply_in_thread(message: str, thread_ts: str) -> str:
    """Sends a reply in an existing thread"""
    contact = ContactChannel(
        slack=SlackContactChannel(channel_or_user_id="C08EDEYS1SB", experimental_slack_blocks=True, thread_ts=thread_ts)
    )
    call = hl.fetch_human_response(
        spec=HumanContactSpec(
            msg=message,
            channel=contact,
        )
    )
    return call.call.status.slack_message_ts


tools = [
    langchain.tools.StructuredTool.from_function(create_thread),
    langchain.tools.StructuredTool.from_function(reply_in_thread),
]

llm = ChatOpenAI(model="gpt-4", temperature=0)

# Enhanced prompt for the agent
prompt = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            """You are a helpful assistant that manages Slack thread conversations.

        IMPORTANT WORKFLOW:
        1. First create a thread using create_thread(), which will return a thread_ts identifier
        2. Wait for the thread_ts to be returned
        3. Use EXACTLY that thread_ts value when calling reply_in_thread()
        4. Never call create_thread() more than once unless explicitly asked

        The thread_ts is crucial for ensuring messages appear in the same thread.
        Always save the output from create_thread() and use it as the thread_ts parameter for reply_in_thread().
        """,
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
    # Create thread and send replies
    result = agent_executor.invoke(
        {
            "input": "Create a new thread with message 'Starting a new discussion' and then send a reply saying 'First reply in the thread'."
        }
    )
    print("\n\n----------Result----------\n\n")
    print(result)
