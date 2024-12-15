# a webhooks-free version
import logging
from enum import Enum
from fastapi import BackgroundTasks, FastAPI
from typing import Any, Dict, Literal, Union
import marvin


from pydantic import BaseModel
from humanlayer import AsyncHumanLayer
from humanlayer.core.models import ContactChannel, EmailContactChannel, HumanContactSpec

app = FastAPI(title="HumanLayer FastAPI Email Example", version="1.0.0")

logger = logging.getLogger(__name__)


# Root endpoint
@app.get("/")
async def root() -> Dict[str, str]:
    return {
        "message": "Welcome to the HumanLayer Email Example",
        "instructions": "https://github.com/humanlayer/humanlayer/blob/main/examples/fastapi-email/README.md",
    }


##############################
########  Biz Logic   ########
##############################
class ClarificationRequest(BaseModel):
    intent: Literal["request_more_information"]
    message: str


class CampaignRequest(BaseModel):
    intent: Literal["ready_to_create_campaign"]
    campaign: "Campaign"


# # dummy method, replace with your deterministic or LLM-backed workflow of choice
# # you can build this to use specifc args, or just build this method
# # to dump the entire thread history as LLM context for the redraft,
# # since it will include the previous draft and the feedback from the human
async def determine_next_step(thread: "Thread") -> ClarificationRequest | CampaignRequest:
    """determine the next step in the email thread"""

    response: Union[ClarificationRequest, CampaignRequest] = await marvin.cast_async(
        thread.model_dump_json(),
        Union[ClarificationRequest, CampaignRequest],
        instructions="""
        determine if you have enough information to create a campaign, or if you need more input.
        The campaign should be a list of gift boxes to include in a promotional campaign
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


async def publish_campaign(campaign: Campaign) -> None:
    """tool to publish a campaign"""
    print(f"Published campaign {campaign.id} at {campaign.url}")


# dummy method...use a classifier or whatever you want
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
    HUMAN_SUPPLIED_MORE_INFORMATION = "human_supplied_more_information"

    CAMPAIGN_DRAFTED = "campaign_drafted"
    HUMAN_SUPPLIED_CAMPAIGN_DRAFT_FEEDBACK = "human_supplied_campaign_draft_feedback"

    CAMPAIGN_PUBLISHED = "campaign_published"


class Event(BaseModel):
    type: EventType
    data: Any  # don't really care about this, it will just be context to the LLM


class Thread(BaseModel):
    initial_email: "EmailPayload"
    events: list[Event]


# example of how you can use this as the rolling context state for the LLM
def to_prompt(thread: Thread) -> str:
    """convert the thread to a prompt for the LLM"""
    history = "\n\n".join([f"{event.type} ==> {event.data}" for event in thread.events])

    return (
        f"""
        Email Thread:
        {thread.initial_email.body}

        Steps taken so far:
        {history}

        Select the next action to take, it should be one of:
        """
        """
    - request_more_information(message: str)
    - ready_to_create_campaign(campaign: {id: int, url: str, items: list[{id: int, name: str, description: str}]})
    """
    )


##########################
######## Handlers ########
##########################
class EmailMessage(BaseModel):
    from_address: str
    to_address: list[str]
    cc_address: list[str]
    subject: str
    content: str
    datetime: str


class EmailPayload(BaseModel):
    from_address: str
    to_address: str
    subject: str
    body: str
    message_id: str
    previous_thread: list[EmailMessage] | None = None
    raw_email: str


async def handle_inbound_email(email_payload: EmailPayload) -> None:
    thread = Thread(initial_email=email_payload, events=[])

    humanlayer = AsyncHumanLayer(
        contact_channel=ContactChannel(
            email=EmailContactChannel.in_reply_to(
                from_address=email_payload.from_address,
                message_id=email_payload.message_id,
                subject=email_payload.subject,
            )
        ),
    )

    thread.events.append(Event(type=EventType.EMAIL_RECEIVED, data=email_payload))

    while True:
        next_step = await determine_next_step(thread)
        logger.info(f"next_step: {next_step}")

        # llm decided it needs more information
        if next_step.intent == "request_more_information":
            thread.events.append(Event(type=EventType.REQUEST_MORE_INFORMATION, data=next_step.message))
            # send the question on the email thread and block until the human responds
            response = (
                await humanlayer.fetch_human_response(
                    spec=HumanContactSpec(
                        msg=next_step.message,
                    )
                )
            ).as_completed()
            logger.info(f"response: {response}")
            thread.events.append(
                Event(type=EventType.HUMAN_SUPPLIED_MORE_INFORMATION, data={"human_response": response})
            )
            continue
        # llm decided it's ready to create a campaign
        elif next_step.intent == "ready_to_create_campaign":
            campaign_info = next_step.campaign
            logger.info(f"drafted campaign_info: {campaign_info}")
            thread.events.append(Event(type=EventType.CAMPAIGN_DRAFTED, data=campaign_info))

            # send the campaign to the human for approval
            approval_response = await get_human_feedback_on_campaign(campaign_info, humanlayer, thread)

            if not await is_approval(approval_response):
                logger.info("human rejected the campaign, continuing")
                continue

            await publish_and_finalize(campaign_info, humanlayer, thread)
            break


async def publish_and_finalize(campaign_info, humanlayer, thread):
    # todo could do some error handling here as well
    await publish_campaign(campaign_info)
    thread.events.append(Event(type=EventType.CAMPAIGN_PUBLISHED, data=campaign_info))
    logger.info("campaign_published, returning")

    # optional, use create_human_contact (instead of fetch_human_response) to fire off the request without waiting for an answer
    # if you implement webhooks you can have "infinite threads" but for now let's assume this process might restart/reschedule
    # and not set the expectation that the ai will respond past this point
    await humanlayer.create_human_contact(
        HumanContactSpec(
            msg="Approved and published campaign. Closing this thread, please send a new email to make changes."
        )
    )


async def get_human_feedback_on_campaign(campaign_info, humanlayer, thread):
    logger.info(f"getting approval from human for campaign {campaign_info.id}")
    # you get to decide how you want to format it, or just send the url if you want
    msg = f"""
            The preview campaign is live at {campaign_info.url}

            Do you think this is good to publish?
            """
    approval_response = (await humanlayer.fetch_human_response(spec=HumanContactSpec(msg=msg))).as_completed()
    logger.info(f"approval_response: {approval_response}")
    thread.events.append(Event(type=EventType.HUMAN_SUPPLIED_CAMPAIGN_DRAFT_FEEDBACK, data=approval_response))
    return approval_response


@app.post("/webhook/new-email-thread")
async def email_inbound(email_payload: EmailPayload, background_tasks: BackgroundTasks) -> Dict[str, Any]:
    """
    route to kick off new processing thread from an email
    """
    # test payload
    if email_payload.from_address == "overworked-admin@coolcompany.com":
        logger.info("test payload received, skipping")
        return {"status": "ok"}

    background_tasks.add_task(handle_inbound_email, email_payload)

    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    uvicorn.run(app, host="0.0.0.0", port=8000)  # noqa: S104
