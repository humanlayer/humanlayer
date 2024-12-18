import json
import logging
from enum import Enum
from fastapi import BackgroundTasks, FastAPI
from typing import Any, Dict, Literal, Union
import marvin


from pydantic import BaseModel
from humanlayer import AsyncHumanLayer, FunctionCall, HumanContact
from humanlayer.core.models import ContactChannel, EmailContactChannel, HumanContactSpec
from humanlayer.core.models_agent_webhook import EmailMessage, EmailPayload

app = FastAPI(title="HumanLayer FastAPI Email Example", version="1.0.0")

logger = logging.getLogger(__name__)


# Root endpoint
@app.get("/")
async def root() -> Dict[str, str]:
    return {
        "message": "Welcome to a HumanLayer Email Example",
        "instructions": "https://github.com/humanlayer/humanlayer/blob/main/examples/fastapi-email/README.md",
    }


##############################
########  Biz Logic   ########
##############################
class ClarificationRequest(BaseModel):
    intent: Literal["request_more_information"]
    message: str


class DraftCampaign(BaseModel):
    intent: Literal["ready_to_draft_campaign"]
    campaign: "Campaign"


class PublishCampaign(BaseModel):
    intent: Literal["human_approved__campaign_ready_to_publish"]
    campaign_id: int


async def determine_next_step(
    thread: "Thread",
) -> ClarificationRequest | DraftCampaign | PublishCampaign:
    """determine the next step in the email thread"""

    response: Union[ClarificationRequest, DraftCampaign, PublishCampaign] = await marvin.cast_async(
        json.dumps([event.model_dump(mode="json") for event in thread.events]),
        Union[ClarificationRequest, DraftCampaign, PublishCampaign],
        instructions="""
        determine if you have enough information to create a campaign, or if you need more input.
        The campaign should be a list of gift boxes to include in a promotional campaign.

        Once a campaign is drafted, a human will automatically review it. If the human approves,
        and has not requested any changes, you should publish it.
        """,
    )
    return response


class CampaignItem(BaseModel):
    id: int
    name: str
    description: str


class Campaign(BaseModel):
    id: int
    url: str
    items: list[CampaignItem]

    def format_approval_message(self) -> str:
        items_str = "\n".join(f"• {item.name} - {item.description}" for item in self.items)
        return f"""
                The preview campaign is live at {self.url}


                The items include:
                {items_str}

                Do you think this is good to publish?
                """


async def publish_campaign(campaign_id: int) -> None:
    """tool to publish a campaign"""
    print(f"Published campaign {campaign_id}")


async def is_approval(message: str) -> bool:
    """check if the human approved the campaign"""
    answer: str = await marvin.classify_async(
        message,
        [
            "approved",
            "rejected",
            "unknown",
        ],
    )

    return answer == "approved"


##########################
######## CONTEXT #########
##########################
class EventType(Enum):
    EMAIL_RECEIVED = "email_received"

    REQUEST_MORE_INFORMATION = "request_more_information"
    HUMAN_RESPONSE = "human_response"

    CAMPAIGN_DRAFTED = "campaign_drafted"

    CAMPAIGN_PUBLISHED = "campaign_published"


class Event(BaseModel):
    type: EventType
    data: Any  # don't really care about this, it will just be context to the LLM


# todo you probably want to version this but for now lets assume we're not going to change the schema
class Thread(BaseModel):
    initial_email: EmailPayload
    # initial_slack_message: SlackMessage
    events: list[Event]

    def to_state(self) -> dict:
        """Convert thread to a state dict for preservation"""
        return self.model_dump(mode="json")

    @classmethod
    def from_state(cls, state: dict) -> "Thread":
        """Restore thread from preserved state"""
        return cls.model_validate(state)


##########################
######## Handlers ########
##########################
async def handle_continued_thread(thread: Thread) -> None:
    humanlayer = AsyncHumanLayer(
        contact_channel=ContactChannel(email=thread.initial_email.as_channel())
    )

    # maybe: if thread gets too long, summarize parts of it - your call!
    # new_thread = maybe_summarize_parts_of_thread(thread)

    logger.info(f"thread received, determining next step. Last event: {thread.events[-1].type}")
    next_step = await determine_next_step(thread)
    logger.info(f"next step: {next_step.intent}")

    if next_step.intent == "request_more_information":
        logger.info(f"requesting more information: {next_step.message}")
        thread.events.append(Event(type=EventType.REQUEST_MORE_INFORMATION, data=next_step.message))
        await humanlayer.create_human_contact(
            spec=HumanContactSpec(msg=next_step.message, state=thread.to_state())
        )

    elif next_step.intent == "ready_to_draft_campaign":
        campaign_info = next_step.campaign
        logger.info(f"drafted campaign_info: {campaign_info.model_dump_json()}")
        thread.events.append(Event(type=EventType.CAMPAIGN_DRAFTED, data=campaign_info))
        await humanlayer.create_human_contact(
            spec=HumanContactSpec(msg=campaign_info.format_approval_message(), state=thread.to_state())
        )
    elif next_step.intent == "human_approved__campaign_ready_to_publish":
        campaign_id = next_step.campaign_id
        logger.info(f"drafted campaign_info: {campaign_id}")
        await publish_campaign(campaign_id)
        thread.events.append(Event(type=EventType.CAMPAIGN_PUBLISHED, data=campaign_id))

        await humanlayer.create_human_contact(
            spec=HumanContactSpec(
                msg="Approved and published campaign. Let me know if you wanna make any other changes!",
                state=thread.to_state(),
            )
        )
    logger.info(f"thread sent to humanlayer. Last event: {thread.events[-1].type}")


@app.post("/webhook/new-email-thread")
async def email_inbound(
    email_payload: EmailPayload, background_tasks: BackgroundTasks
) -> Dict[str, Any]:
    """
    route to kick off new processing thread from an email
    """
    # test payload
    if email_payload.is_test or email_payload.from_address == "overworked-admin@coolcompany.com":
        logger.info("test payload received, skipping")
        return {"status": "ok"}

    logger.info(f"inbound email received: {email_payload.model_dump_json()}")
    thread = Thread(initial_email=email_payload, events=[])
    thread.events.append(Event(type=EventType.EMAIL_RECEIVED, data=email_payload))

    background_tasks.add_task(handle_continued_thread, thread)

    return {"status": "ok"}


@app.post("/webhook/human-response-on-existing-thread")
async def human_response(
    human_response: FunctionCall | HumanContact, background_tasks: BackgroundTasks
) -> Dict[str, Any]:
    """
    route to handle human responses
    """

    if human_response.spec.state is not None:
        thread = Thread.model_validate(human_response.spec.state)
    else:
        # decide what's the right way to handle this? probably logger.warn and proceed
        raise ValueError("state is required")

    if isinstance(human_response, HumanContact):
        thread.events.append(
            Event(
                type=EventType.HUMAN_RESPONSE, data={"human_response": human_response.status.response}
            )
        )
        background_tasks.add_task(handle_continued_thread, thread)

    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    uvicorn.run(app, host="0.0.0.0", port=8000)  # noqa: S104
