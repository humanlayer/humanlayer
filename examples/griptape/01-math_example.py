from dotenv import load_dotenv

load_dotenv()

from griptape.structures import Agent
from griptape.tools import WebScraperTool, FileManagerTool, PromptSummaryTool, BaseTool
from humanlayer import HumanLayer, ContactChannel, SlackContactChannel
import random

from schema import Literal, Optional, Schema

from griptape.artifacts import TextArtifact
from griptape.tools import BaseTool
from griptape.utils.decorators import activity


hl = HumanLayer(
    verbose=True,
    griptape_munging=True,
    contact_channel=ContactChannel(slack=SlackContactChannel(channel_or_user_id="", experimental_slack_blocks=True)),
    # run_id is optional -it can be used to identify the agent in approval history
    run_id="griptape-math",
)


class MathTool(BaseTool):
    @activity(
        config={
            "description": "Can be used to add two numbers",
            "schema": Schema({"a": int, "b": int}),
        }
    )
    def add(self, params: dict) -> TextArtifact:
        a = params["values"]["a"]
        b = params["values"]["b"]
        return TextArtifact(str(a + b))

    @activity(
        config={
            "description": "Can be used to multiply two numbers",
            "schema": Schema({"a": int, "b": int}),
        }
    )
    @hl.require_approval()
    def multiply(self, params: dict) -> TextArtifact:
        a = params["values"]["a"]
        b = params["values"]["b"]
        return TextArtifact(str(a * b))


if __name__ == "__main__":
    agent = Agent(
        input="Multiply 2 and 5, then add 32 to the result",
        tools=[MathTool()],
    )

    res = agent.run()

    print("\n\n------------RESULT----------\n\n")
    print(res.output.value)
