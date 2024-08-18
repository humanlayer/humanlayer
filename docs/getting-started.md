# Getting Started

To get started, you can check out one of the [Examples](../examples/) or follow the instructions below.

<div align="center">
<a target="_blank" href="https://www.loom.com/share/7c65d48d18d1421a864a1591ff37e2bf"><img width="60%" alt="video thumbnail showing editor" src="./images/video-thumb.png"></a>
</div>

### Installation

In your desired python environment\*\*, run:

```bash
pip install humanlayer
```

<details>
<summary>**Creating a VirtualEnv</summary>
In case you need it, you can create a fresh virtualenv with

```shell
python3 -m venv venv
source venv/bin/activate
```

</details>

### Choose an LLM Client and Write your first tool-calling agent

You'll need a short python script that defines a function that you want to gate with HumanLayer,
and an agent+prompt that will execute the function.
There are a number of different examples you can start from, including:

- 🦜⛓️ [LangChain](../examples/langchain/)
- 🚣‍ [CrewAI](../examples/crewai/)
- 🦾 [ControlFlow](../examples/controlflow/)
- 🧠 [Raw OpenAI Client](../examples/openai_client/)

We'll use LangChain and OpenAI here since it's fairly succinct for this use case.

Create a file called `math.py`

```python
from langchain.agents import initialize_agent
from langchain.agents import AgentType
from langchain.tools import tool
from langchain_openai import ChatOpenAI


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
```

Before we can run this, we need to install langchain

```bash
pip install langchain langchain-openai
```

To use LangChain with OpenAI, you'll need to set your `OPENAI_API_KEY` as well.

```bash
export OPENAI_API_KEY=sk-proj-....
```

Then you can run the script

```bash
python math.py
```

You should see a fairly straightforward set of calls, at the end of which the result `42` should be printed.

```
Invoking: `multiply` with `{'x': 2, 'y': 5}`


10
Invoking: `add` with `{'x': 10, 'y': 32}`


42The result of multiplying 2 and 5, then adding 32 to the result, is 42.

> Finished chain.


----------Result----------


The result of multiplying 2 and 5, then adding 32 to the result, is 42.

```

### Wrap a function with humanlayer

Once you've run the example and verified it works, it's time to wrap the function with HumanLayer.
Add the following to the top of your file:

```diff
from langchain.agents import initialize_agent
from langchain.agents import AgentType
from langchain.tools import tool
from langchain_openai import ChatOpenAI

+ from humanlayer import HumanLayer
+ hl = HumanLayer()


@tool
def add(x: int, y: int) -> int:
    """Add two numbers together."""
    return x + y


@tool
def multiply(x: int, y: int) -> int:
    """multiply two numbers"""
    return x * y
```

and then wrap your `multiply` function with `@hl.require_approval()`:

```diff
from humanlayer import HumanLayer
hl = HumanLayer()


@tool
def add(x: int, y: int) -> int:
    """Add two numbers together."""
    return x + y


@tool
+ @hl.require_approval()
def multiply(x: int, y: int) -> int:
    """multiply two numbers"""
    return x * y
```

<details>
<summary>View full file</summary>

```python
from langchain.agents import initialize_agent
from langchain.agents import AgentType
from langchain.tools import tool
from langchain_openai import ChatOpenAI

from humanlayer import HumanLayer
hl = HumanLayer()


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

if __name__ == "__main__":
    result = agent.run("multiply 2 and 5, then add 32 to the result")
    print("\n\n----------Result----------\n\n")
    print(result)
```

</details>

This should run until the first function call, and then pause to ask for approval on the CLI

```
Invoking: `multiply` with `{'x': 2, 'y': 5}`


Agent agent-KxoVZglhSI4 wants to call

multiply({
  "x": 2,
  "y": 5
})


Hit ENTER to proceed, or provide feedback to the agent to deny:
```

You can hit ENTER to allow this, or give the agent some feedback like `no, use 7 instead of 5`.

The full output might look something like

```
Invoking: `multiply` with `{'x': 2, 'y': 5}`


Agent agent-KxoVZglhSI4 wants to call

multiply({
  "x": 2,
  "y": 5
})


Hit ENTER to proceed, or provide feedback to the agent to deny: no use 7 instead of 5

User denied multiply with feedback: no use 7 instead of 5
Invoking: `multiply` with `{'x': 2, 'y': 7}`


allow multiply with args () and kwargs {'x': 2, 'y': 7} (Y/n): y
14
Invoking: `add` with `{'x': 14, 'y': 32}`


46
The result of multiplying 2 and 7, then adding 32 to the result, is 46.
```

### Integrate with a humanlayer server

To enable collaborative approvals across slack, email, and other channels, you'll need to connect the
humanlayer SDK to a server. The easiest way to do this is to log into https://app.humanlayer.dev and create a new project and API token, then set it in your shell environment or `.env` file:

```bash
export HUMANLAYER_API_KEY=sk-proj-...
```

With this change, your invocation of `hl = HumanLayer()` will connect to the humanlayer server and allow you to approve functions from the web interface.

Re-running the script, you'll see the same function now show in your approval queue at [HumanLayer Cloud](https://app.humanlayer.dev).

Navigate to the Approval Queue and click the Status button to approve the function call.

![Approval Queue](./images/getting_started_web_queue.png)

![Approval Modal](./images/getting_started_web_approve.png)

![Approval Result](./images/getting_started_web_approved.png)

## Next Steps

### Connect Slack

Web approvals are a start, but HumanLayer really shines when you connect your slack instance. See [configuring slack](./configuring-slack.md) for more information on how to do this, and then you can

### Try a Human as tool

`hl.human_as_tool()` gives you a generic, LLM-ready tool that an agent can call to contact a human for feedback, advice, or other input. See [the langchain human as tool example](../examples/langchain/03-human_as_tool.py) for more.
