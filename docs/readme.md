# FunctionLayer Docs

Stubbed out documentation that lives in GitHub for now.

Table of Contents:
- [Getting Started](#getting-started)
- [Features](#features)
    - [Functionlayer CLI](#functionlayer-cli)
    - [Functionlayer Cloud](#functionlayer-cloud)
- [Reference](#reference)

## Getting Started

To get started, you can check out one of the [Examples](../examples/) or follow the instructions below.

## Architecture

🚧Coming Soon 🚧

## Features

### Function Decorators

FunctionLayer provides a set of decorators that can be used to add human in the loop functionality to your functions. Rather than relying on LLM reasoning and logic to determine which functions to call and how to do it safely, you can move the approval out of the LLM layer and into the function layer. This brings strict determinism the "if/when" of an LLM asking for human approval on sensitive actions.

```python
import os

from functionlayer import FunctionLayer

fl = FunctionLayer(api_token=os.getenv("FUNCTIONLAYER_API_TOKEN"))

@fl.require_approval()
def send_email_to_customer(email: str, subject: str, body: str) -> str:
  """
  send an email to the customer
  """
  ... # function body
  return f"Successfully sent email '{subject}' to {email}"
```

This will cause a message to be sent to a configured channel, e.g. a particular user or channel in slack.

#### Customizing approval routing

You may want to customize which channel or user the approval request is sent to. You can do this by passing a `ContactChannel` object to the `require_approval` decorator.


```python
from functionlayer import ContactChannel, SlackContactChannel

head_of_sales = ContactChannel(
  slack=SlackContactChannel(
    channel_or_user_id="U01JQX9KZZ",
    context_about_channel_or_user="a DM with the head of sales",
  )
)

@fl.require_approval(head_of_sales)
def send_email_to_customer(email: str, subject: str, body: str) -> str:
    ...
```

### Human as Tool

In addition to blocking function execution based on human feedback, functionlayer can also provide a more generic "human as tool" function for an agent to reach out across various channels.

```python
from functionlayer import ContactChannel, FunctionLayer, SlackContactChannel
fl = FunctionLayer()

tools = [
    fl.human_as_tool(
        ContactChannel(
            slack=SlackContactChannel(
                channel_or_user_id="U01JQX9KZZ",
                context_about_channel_or_user="a DM with the head of sales",
            )
        )
    ),
    fl.human_as_tool(
        ContactChannel(
            slack=SlackContactChannel(
                channel_or_user_id="CQZIQ0X9KZZ",
                context_about_channel_or_user="the primary channel for the us-west account team",
            )
        )
    ),
]
```

this builds a function that can be passed to `langchain.tools.StructuredTool.from_function()` or any other LLM framework's tool calling system. The AI will see a function with the signature 

```
contact_human_in_a_dm_with_the_head_of_sales(msg: str) -> str
```

See [Langchain Human as Tool Example](../examples/langchain_human_as_tool.py) for an example of how to use this in a Langchain context.

### Functionlayer Cloud

By default, FunctionLayer will run in CLI mode, which allows a human to interact with the LLM via the command line. However, FunctionLayer really shines in cloud mode, where humans can be pulled into the agentic loop via email, slack, or other integrations.



### CLI Mode

The functionlayer CLI mode allows for a local development mode whereby all "human in the loop" and "human as tool" will be assesed as simple python `input()` calls.

It can be a good way to experiment with LLM workflows without needing to integrat slack, email, or any of the [FunctionLayer Cloud](#functionlayer-cloud) components.

to run in CLI mode, initialize FunctionLayer with `ApprovalMethod.CLI`

```python

from functionlayer import FunctionLayer, ApprovalMethod

fl = FunctionLayer(approval_method=ApprovalMethod.CLI)

```

Then, you can decorate your functions as normal.

```python
@fl.require_approval()
def send_email_to_customer(email: str, subject: str, body: str) -> str:
    """
    send an email to the customer
    """
    ... # function body
    return f"Successfully sent email '{subject}' to {email}"
```

When the LLM calls this function, a prompt will be shown on the CLI asking for approval. A user can hit ENTER to continue, or type feedback to reject the function.

## Reference

🚧Coming Soon 🚧
