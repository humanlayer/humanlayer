import os
from typing import Any
from humanlayer import ContactChannel, EmailContactChannel
from langchain_core.prompts import ChatPromptTemplate
import langchain_core.tools as langchain_tools
from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_tool_calling_agent

from dotenv import load_dotenv

from humanlayer.core.approval import HumanLayer

load_dotenv()

run_id = "ceos-email-assistant"

hl = HumanLayer(
    verbose=True,
    contact_channel=ContactChannel(
        email=EmailContactChannel(
            address=os.getenv("HL_EXAMPLE_CONTACT_EMAIL", "dexter@humanlayer.dev"),
            context_about_user="the user you are helping",
            template="""
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        line-height: 1.6;
                        color: #333;
                        max-width: 800px;
                        margin: 0 auto;
                        padding: 20px;
                        background-color: #faf5ff;
                    }
                    .greeting {
                        font-size: 1.2em;
                        color: #6b46c1;
                        border-bottom: 2px solid #9f7aea;
                        padding-bottom: 8px;
                        display: inline-block;
                    }
                    .content {
                        margin: 20px 0;
                        background-color: white;
                        padding: 20px;
                        border-radius: 8px;
                        border-left: 4px solid #805ad5;
                    }
                    .signature {
                        color: #553c9a;
                        font-style: italic;
                        text-shadow: 1px 1px 2px rgba(107, 70, 193, 0.1);
                    }
                </style>
            </head>
            <body>
                <div class="content">
                    {{event.spec.msg}}
                </div>
            </body>
            </html>
            """,
        )
    ),
    # run_id is optional -it can be used to identify the agent in approval history
    run_id=run_id,
)

approval_channel = ContactChannel(
    email=EmailContactChannel(
        address=os.getenv("HL_EXAMPLE_CONTACT_EMAIL", "dexter@humanlayer.dev"),
        context_about_user="the user you are helping",
        template="""
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        line-height: 1.6;
                        color: #333;
                        max-width: 800px;
                        margin: 0 auto;
                        padding: 20px;
                        background-color: #f8f4ff;
                    }
                    .header {
                        background: linear-gradient(135deg, #6b46c1, #805ad5);
                        color: white;
                        padding: 20px;
                        border-radius: 8px;
                        margin-bottom: 30px;
                        box-shadow: 0 4px 6px rgba(107, 70, 193, 0.2);
                    }
                    .function-name {
                        font-size: 1.5em;
                        font-weight: bold;
                        margin-bottom: 10px;
                        text-shadow: 1px 1px 2px rgba(0,0,0,0.2);
                    }
                    .parameters {
                        background-color: white;
                        padding: 20px;
                        border-radius: 8px;
                        box-shadow: 0 2px 8px rgba(107, 70, 193, 0.15);
                        border-left: 4px solid #9f7aea;
                    }
                    .param-row {
                        display: flex;
                        padding: 10px 0;
                        border-bottom: 1px solid #e9d8fd;
                        transition: background-color 0.2s;
                    }
                    .param-row:hover {
                        background-color: #faf5ff;
                    }
                    .param-key {
                        font-weight: bold;
                        width: 200px;
                        color: #553c9a;
                    }
                    .param-value {
                        flex: 1;
                        color: #2d3748;
                    }
                    .signature {
                        margin-top: 30px;
                        color: #6b46c1;
                        font-style: italic;
                        border-top: 2px solid #9f7aea;
                        padding-top: 15px;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="function-name">Function Call: {{event.spec.fn}}</div>
                </div>
                <div class="parameters">
                    {% for key, value in event.spec.kwargs.items() %}
                    <div class="param-row">
                        <div class="param-key">{{key}}</div>
                        <div class="param-value">{{value}}</div>
                    </div>
                    {% endfor %}
                </div>

                <div class="signature">
                    Best regards,<br>
                    Your Assistant
                </div>
            </body>
            </html>
        """,
    )
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


@hl.require_approval(contact_channel=approval_channel)
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
    result = agent_executor.invoke({"input": task_prompt})
    print("\n\n----------Result----------\n\n")
    print(result)
