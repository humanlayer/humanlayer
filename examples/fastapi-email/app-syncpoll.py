# a webhooks-free version
import logging
from enum import Enum
import random
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Any, Dict, List, Literal, TypedDict

from pydantic import BaseModel
from humanlayer import AsyncHumanLayer, FunctionCall, FunctionCallSpec
from humanlayer.core.models import ContactChannel, EmailContactChannel, HumanContact, HumanContactSpec

app = FastAPI(title="HumanLayer FastAPI Email Example", version="1.0.0")

logger = logging.getLogger(__name__)


# Root endpoint
@app.get("/")
async def root() -> Dict[str, str]:
    return {
        "message": "Welcome to the HumanLayer Email Example",
        "instructions": "https://github.com/humanlayer/humanlayer/blob/main/examples/fastapi-email/README.md",
    }


####################################
########  Tools/Biz Logic   ########
####################################
class ClarificationRequest(TypedDict):
    intent: Literal["request_more_information"]
    message: str


class CampaignRequest(TypedDict):
    intent: Literal["ready_to_create_campaign"]


def determine_next_step(thread: "Thread") -> ClarificationRequest | CampaignRequest:
    """determine the next step in the email thread"""
    if "campaign" in str(thread["events"][-1]["data"]).lower():
        return CampaignRequest(intent="ready_to_create_campaign")
    else:
        return ClarificationRequest(intent="request_more_information", message="Please clarify the campaign details")


class CampaignItem(TypedDict):
    id: int
    name: str
    description: str


class Campaign(TypedDict):
    id: int
    url: str
    items: list[CampaignItem]


# dummy method, replace with your deterministic or LLM-backed workflow of choice
# you can build this to use specifc args, or just build this method
# to dump the entire thread history as LLM context for the redraft,
# since it will include the previous draft and the feedback from the human
def draft_or_redraft_campaign(thread_history: "Thread") -> Campaign:
    """draft or redraft the campaign based on the thread history"""

    # todo - do something with the thread to generate a new campaign,
    # prorbably working

    campaign_id = random.randint(100000, 999999)  # noqa: S311
    return Campaign(
        id=campaign_id,
        url=f"https://example.com/campaign/{campaign_id}",
        items=[CampaignItem(id=2, name="item 2", description="item 2 description")],
    )


def publish_campaign(campaign: Campaign) -> None:
    """tool to publish a campaign"""
    print(f"Published campaign {campaign['id']} at {campaign['url']}")


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


class Event(TypedDict):
    type: EventType
    data: Any  # don't really care about this, it will just be context to the LLM


class Thread(TypedDict):
    initial_email: "EmailPayload"
    events: list[Event]


# example of how you can use this as the rolling context state for the LLM
def to_prompt(thread: Thread) -> str:
    """convert the thread to a prompt for the LLM"""
    history = "\n\n".join([f"{event['type']} ==> {event['data']}" for event in thread["events"]])

    return f"""
    Email Thread:
    {thread["initial_email"].body}

    Steps taken so far:
    {history}

    Select the next action to take, it should be one of:

    - request_more_information(message: str)
    - ready_to_create_campaign()
    """


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
    thread_id = email_payload.message_id  # for emails, can use the message id as the unique thread identifier
    thread = Thread(initial_email=email_payload, events=[])

    humanlayer = AsyncHumanLayer(
        run_id=thread_id,  # will be added to all requests for this email thread
        contact_channel=ContactChannel(
            email=EmailContactChannel.in_reply_to(
                from_address=email_payload.from_address,
                message_id=email_payload.message_id,
                subject=email_payload.subject,
            )
        ),
    )

    thread["events"].append(Event(type=EventType.EMAIL_RECEIVED, data=email_payload))

    while True:
        next_step = determine_next_step(thread)
        logger.info(f"next_step: {next_step}")
        if next_step["intent"] == "request_more_information":
            thread["events"].append(Event(type=EventType.REQUEST_MORE_INFORMATION, data=next_step["message"]))

            # send the question on the email thread and block until the human responds
            response = (
                await humanlayer.fetch_human_response(
                    spec=HumanContactSpec(
                        msg=next_step["message"],
                    )
                )
            ).as_completed()
            logger.info(f"response: {response}")

            thread["events"].append(
                Event(type=EventType.HUMAN_SUPPLIED_MORE_INFORMATION, data={"human_response": response})
            )

        elif next_step["intent"] == "ready_to_create_campaign":
            campaign_info = draft_or_redraft_campaign(thread)
            logger.info(f"drafted campaign_info: {campaign_info}")
            thread["events"].append(Event(type=EventType.CAMPAIGN_DRAFTED, data=campaign_info))
            logger.info(f"getting approval from human for campaign {campaign_info['id']}")
            approval_response = (
                await humanlayer.fetch_approval(
                    spec=FunctionCallSpec(
                        fn="publish_campaign",
                        kwargs={
                            "inbound_request": email_payload.body,
                            "campaign_info": campaign_info,
                            "thought": "the preview campaign is live - is this good to publish?",
                        },
                    )
                )
            ).as_completed()

            logger.info(f"approval_response: {approval_response}")

            if approval_response.approved is False:
                thread["events"].append(
                    Event(type=EventType.HUMAN_SUPPLIED_CAMPAIGN_DRAFT_FEEDBACK, data=approval_response.comment)
                )
                logger.info("appended human feedback to thread, trying again")
                continue
            else:
                publish_campaign(campaign_info)
                thread["events"].append(Event(type=EventType.CAMPAIGN_PUBLISHED, data=campaign_info))
                logger.info("campaign_published, returning")


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

    logging.basicConfig(level=logging.INFO)

    uvicorn.run(app, host="0.0.0.0", port=8000)  # noqa: S104
