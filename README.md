<div align="center">

![Wordmark Logo of HumanLayer](./docs/images/humanlayer-logo.png)

</div>

**HumanLayer**: A python toolkit to enable AI agents to communicate with humans in tool-based and asynchronous workflows. By incorporating humans-in-the-loop, agentic tools can be given access to much more powerful and meaningful tool calls and tasks.

Bring your LLM (OpenAI, Llama, Claude, etc) and Framework (LangChain, CrewAI, etc) and start giving your AI agents safe access to the world.

<div align="center">

<h3>

[Homepage](https://www.humanlayer.dev/) | [Get Started](./docs/getting-started.md) | [Discord](https://discord.gg/KNATT2xK) | [Documentation](./docs) | [Examples](./examples)

</h3>

[![GitHub Repo stars](https://img.shields.io/github/stars/humanlayer/humanlayer)](https://github.com/humanlayer/humanlayer)
[![License: Apache-2](https://img.shields.io/badge/License-Apache-green.svg)](https://opensource.org/licenses/Apache-2)

</div>

## Table of contents

- [Getting Started](#getting-started)
- [Why HumanLayer?](#why-humanlayer)
- [Key Features](#key-features)
- [Examples](#examples)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## Getting Started

To get started, check out [Getting Started](./docs/getting-started.md), watch the [2:30 Getting Started Video](https://www.loom.com/share/97ead4e4a0b84b3dac4fec2ff1b410bf), or jump straight into one of the [Examples](./examples/):

- 🦜⛓️ [LangChain](./examples/langchain/01-math_example.py)
- 🚣‍ [CrewAI](./examples/crewai/crewai_math.py)
- 🦾 [ControlFlow](./examples/controlflow/controlflow_math.py)
- 🧠 [Raw OpenAI Client](./examples/openai_client/math_example.py)

```shell
pip install humanlayer
```

Example usage might look something like the below, 

```python
from humanlayer import HumanLayer
hl = HumanLayer() 

@hl.require_approval()
def send_email(to: str, subject: str, body: str):
    """Send an email to the customer"""
    ...

def run_llm_task(prompt, tools, llm):
    """
    made up method, use whatever framework you prefer
    
    see examples for langchain, openai, crewai, controlflow, etc"""
    ...

run_llm_task(
    prompt="""Send an email welcoming the customer to 
    the platform and encouraging them to invite a team member.""",
    tools=[send_email],
    llm="gpt-4o"
)
```
Check out the [framework specific examples](./examples) for something runnable.

<details>
<summary>🦜⛓️ LangChain Example w/ OpenAI</summary>

[All LangChain Examples](./examples/langchain/)

```shell
pip install langchain langchain-openai
export OPENAI_API_KEY=...
```

```python
from langchain.agents import AgentType, initialize_agent
import langchain_core.tools as langchain_tools
from langchain_openai import ChatOpenAI

from humanlayer.core.approval import (
    HumanLayer
)

hl = HumanLayer()

task_prompt = """

You are the email onboarding assistant. You check on the progress customers
are making and then based on that info, you
send friendly and encouraging emails to customers to help them fully onboard
into the product.

Your task is to send an email to the customer danny@example.com

"""

def get_info_about_customer(customer_email: str) -> str:
    """get info about a customer"""
    return """
    This customer has completed most of the onboarding steps,
    but still needs to invite a few team members before they can be
    considered fully onboarded
    """


# require approval to send an email
@hl.require_approval()
def send_email(to: str, subject: str, body: str) -> str:
    """Send an email to a user"""
    return f"Email sent to {to} with subject: {subject}"


tools = [
    langchain_tools.StructuredTool.from_function(get_info_about_customer),
    langchain_tools.StructuredTool.from_function(send_email),
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
```
</details>

By default, approvals will be requests on the CLI. 


<details>
<summary>Example CLI Response</summary>

```
Agent agent-KxoVZglhSI4 wants to call

send_email({
  "to": "danny@example.com",
  "subject": "You're Almost There!",
  "body": "Hi Danny,\n\nWe noticed that you've made great progress with your onboarding process. That's fantastic! The last step to fully onboard is to invite a few team members to join you.\n\nInviting your team will help you get the most out of our product and ensure everyone is on the same page.\n\nIf you need any assistance or have any questions, feel free to reach out. We're here to help!\n\nBest regards,\nThe Onboarding Team"
})


Hit ENTER to proceed, or provide feedback to the agent to deny:
```

</details>


Head to https://app.humanlayer.dev and grab your `HUMANLAYER_API_KEY` to start routing approvals via slack, email, or web. See [the getting started video](https://www.loom.com/share/97ead4e4a0b84b3dac4fec2ff1b410bf) for a quick walkthrough.

```shell
export HUMANLAYER_API_KEY=...
python example.py
```

Then you can start manging LLM actions in slack, email, or whatever channel you prefer:

<div align="center"><img style="width: 400px" alt="A screenshot of slack showing a human replying to the bot" src="./docs/images/slack_approval_response.png"></div>

Check out the [HumanLayer Docs](./docs/) and the [Getting Started Guide](./docs/getting-started.md) for more information.

## Why HumanLayer?

Functions and tools are a key part of [Agentic Workflows](https://www.deeplearning.ai/the-batch/how-agents-can-improve-llm-performance). They enable LLMs to interact meaningfully with the outside world and automate broad scopes of impactful work. Correct and accurate function calling is essential for AI agents that do meaningful things like book appointments, interact with customers, manage billing information, write+execute code, and more.

[![Tool Calling Loop from Louis Dupont](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*r8rEqjGZs_e6dibWeaqaQg.png)](https://louis-dupont.medium.com/transforming-software-interactions-with-tool-calling-and-llms-dc39185247e9)
_From https://louis-dupont.medium.com/transforming-software-interactions-with-tool-calling-and-llms-dc39185247e9_

**However**, the most useful functions we can give to an LLM are also the most risky. We can all imagine the value of an AI Database Administrator that constantly tunes and refactors our SQL database, but most teams wouldn't give an LLM access to run arbitrary SQL statements against a production database (heck, we mostly don't even let humans do that). That is:

<div align="center">
<h3><blockquote>Even with state-of-the-art agentic reasoning and prompt routing, LLMs are not sufficiently reliable to be given access to high-stakes functions without human oversight</blockquote></h3>
</div>

To better define what is meant by "high stakes", some examples:

- **Low Stakes**: Read Access to public data (e.g. search wikipedia, access public APIs and DataSets)
- **Low Stakes**: Communicate with agent author (e.g. an engineer might empower an agent to send them a private Slack message with updates on progress)
- **Medium Stakes**: Read Access to Private Data (e.g. read emails, access calendars, query a CRM)
- **Medium Stakes**: Communicate with strict rules (e.g. sending based on a specific sequence of hard-coded email templates)
- **High Stakes**: Communicate on my Behalf or on behalf of my Company (e.g. send emails, post to slack, publish social/blog content)
- **High Stakes**: Write Access to Private Data (e.g. update CRM records, modify feature toggles, update billing information)

<div align="center"><img style="width: 600px" alt="Image showing the levels of function stakes stacked on top of one another" src="./docs/images/function_stakes.png"></div>

The high stakes functions are the ones that are the most valuable and promise the most impact in automating away human workflows. The sooner teams can get Agents reliably and safely calling these tools, the sooner they can reap massive benefits.

HumanLayer provides a set of tools to _deterministically_ guarantee human oversight of high stakes function calls. Even if the LLM makes a mistake or hallucinates, HumanLayer is baked into the tool/function itself, guaranteeing a human in the loop.

<div align="center"><img style="width: 400px" alt="Function Layer @require_approval decorator wrapping the Commnicate on my behalf function" src="./docs/images/function_layer_require_approval.png"></div>

<div align="center">
<h3><blockquote>
HumanLayer provides a set of tools to *deterministically* guarantee human oversight of high stakes function calls
</blockquote></h3>
</div>

## Key Features

- **Require Human Approval for Function Calls**: the `@hl.require_approval()` decorator blocks specifc function calls until a human has been consulted - upon denial, feedback will be passed to the LLM
- **Human as Tool**: generic `hl.human_as_tool()` allows for contacting a human for answers, advice, or feedback
- **OmniChannel Contact**: Contact humans and collect responses across Slack, Email, Discord, and more
- **Granular Routing**: Route approvals to specific teams or individuals
- **Bring your own LLM + Framework**: Because HumanLayer is implemented at tools layer, it supports any LLM and all major orchestration frameworks that support tool calling.

## Examples

You can test different real life examples of HumanLayer in the [examples folder](./examples/):

- 🦜⛓️ [LangChain Math](./examples/langchain/01-math_example.py)
- 🦜⛓️ [LangChain Human As Tool](./examples/langchain/03-human_as_tool.py)
- 🚣‍ [CrewAI Math](./examples/crewai/crewai_math.py)
- 🦾 [ControlFlow Math](./examples/controlflow/controlflow_math.py)
- 🧠 [Raw OpenAI Client](./examples/openai_client/math_example.py)

## Roadmap

| Feature                      | Status              |
| ---------------------------- | ------------------- |
| Require Approval             | ⚗️ Alpha            |
| Human as Tool                | ⚗️ Alpha            |
| CLI Approvals                | ⚗️ Alpha            |
| CLI Human as Tool            | 🗓️ Planned          |
| Slack Approvals              | ⚗️ Alpha            |
| Langchain Support            | ⚗️ Alpha            |
| Controlflow Support          | ⚗️ Alpha            |
| CrewAI Support               | ⚗️ Alpha            |
| Open Protocol for BYO server | 🗓️ Planned          |
| Composite Contact Channels   | 🚧 Work in progress |
| Discord Approvals            | 🗓️ Planned          |
| Email Approvals              | 🗓️ Planned          |
| LLamaIndex Support           | 🗓️ Planned          |
| Haystack Support             | 🗓️ Planned          |

## Contributing

HumanLayer is open-source and we welcome contributions in the form of issues, documentation, pull requests, and more. See [CONTRIBUTING.md](./CONTRIBUTING.md) for more details.

## License

The HumanLayer SDK in this repo is licensed under the Apache 2 License.
