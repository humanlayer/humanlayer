from typing import Any
from humanlayer import ContactChannel, EmailContactChannel
from langchain.agents import AgentType, initialize_agent
import langchain_core.tools as langchain_tools
from langchain_openai import ChatOpenAI

from dotenv import load_dotenv

from humanlayer.core.approval import HumanLayer

load_dotenv()

run_id = "ceos-email-assistant"

hl = HumanLayer(
    verbose=True,
    contact_channel=ContactChannel(
        email=EmailContactChannel(
            address="dexter@humanlayer.dev",
            context_about_user="the user you are helping",
        )
    ),
    # run_id is optional -it can be used to identify the agent in approval history
    run_id=run_id,
)

task_prompt = f"""
You are the ceo's assistant, he contacts you via email with various tasks.

Your name is {run_id}

YOU WRITE EMAILS THAT ARE SHORT AND READABLE.
write in all lowercase, in a very informal style

The ceo has asked you to perform the following task:

----------------------------------

contact me via email and ask for help with this

To: assistant@humanlayer.dev
From: ceo@humanlayer.dev
Subject: Fwd: Your annual Corportate report is ready

--

From: compliance@mosey.com
To: ceo@humanlayer.dev
Subject: Your annual Corportate report is ready

Hi Dexter,

Dear Dexter,

I hope this email finds you well. I am writing to inform you regarding your annual California Statement of Information (Form SI-550) submission requirement. Our records indicate that your report is now ready for filing with the California Secretary of State.

Please be advised that to avoid any late filing fees or penalties from the state of California, the submission deadline is November 31st. The current filing fee is $25, and late submissions may incur a $250 penalty. We strongly encourage you to complete this important California compliance requirement before the specified date.

Should you require any assistance with the filing process through the California Secretary of State's website or have any questions about California corporate filing requirements, please don't hesitate to reach out to our support team.

Best regards,
Compliance Team
Mosey Corporation

"""


def get_linear_projects() -> Any:
    """get all linear projects"""
    return [
        {"id": "1", "name": "operations"},
        {"id": "2", "name": "marketing"},
        {"id": "3", "name": "engineering"},
        {"id": "4", "name": "design"},
    ]


def get_linear_assignees() -> Any:
    """get all linear assignees"""

    return [
        {"id": "1", "name": "Austin"},
        {"id": "2", "name": "Dexter"},
    ]


@hl.require_approval()
def create_linear_ticket(title: str, assignee: str, description: str, project: str, due_date: str) -> str:
    """create a ticket in linear"""
    if project != "operations":
        return "that project does not exist"

    return "issue created"


tools = [
    langchain_tools.StructuredTool.from_function(get_linear_projects),
    langchain_tools.StructuredTool.from_function(get_linear_assignees),
    langchain_tools.StructuredTool.from_function(create_linear_ticket),
    langchain_tools.StructuredTool.from_function(hl.human_as_tool()),
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
