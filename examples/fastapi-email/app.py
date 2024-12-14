from enum import Enum
import random
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Any, Dict, List, Literal, TypedDict
from humanlayer import AsyncHumanLayer, FunctionCall, FunctionCallSpec
from humanlayer.core.models import ContactChannel, EmailContactChannel, HumanContact, HumanContactSpec
from .types import EmailPayload

app = FastAPI(
    title="HumanLayer FastAPI Webhooks Example",
    description="Example of using AsyncHumanLayer with FastAPI",
    version="1.0.0",
)


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


class UnknownRequest(TypedDict):
    intent: Literal["unknown"]
    message: str


# dummy method, replace with your AI / classifier of choice
def classify(message: str) -> ClarificationRequest | CampaignRequest | UnknownRequest:
    """
    classify the email intent into one of the following:
    """
    if "campaign" in message.lower():
        return CampaignRequest()
    elif "campaign" not in message.lower():
        return ClarificationRequest(message="Please clarify the campaign details")
    else:
        return UnknownRequest(message="Unknown request")


class CampaignItem(TypedDict):
    id: int
    name: str
    description: str


class Campaign(TypedDict):
    id: int
    url: str
    items: list[CampaignItem]


# dummy method, replace with your deterministic or LLM-backed workflow of choice
def draft_campaign(email_payload: EmailPayload) -> Campaign:
    """tool to create a draft campaign"""
    id = random.randint(100000, 999999)
    return Campaign(
        id=id,
        url=f"https://example.com/campaign/{id}",
        items=[CampaignItem(id=1, name="item 1", description="item 1 description")],
    )


# dummy method, replace with your deterministic or LLM-backed workflow of choice
# you can build this to use specifc args, or just build this method
# to dump the entire thread history as LLM context for the redraft,
# since it will include the previous draft and the feedback from the human
def redraft_campaign(thread_history: list["Event"]) -> Campaign:
    """redraft the campaign, including the feedback from the human"""
    id = random.randint(100000, 999999)
    return Campaign(
        id=id,
        url=f"https://example.com/campaign/{id}",
        items=[CampaignItem(id=2, name="item 2", description="item 2 description")],
    )


def publish_campaign(campaign: Campaign) -> None:
    """tool to publish a campaign"""
    print(f"Published campaign {campaign.id} at {campaign.url}")


##########################
########  State   ########
##########################
class EventType(Enum):
    EMAIL_RECEIVED = "email_received"
    EMAIL_CLASSIFIED = "email_classified"
    REQUEST_MORE_INFORMATION = "request_more_information"
    CAMPAIGN_DRAFTED = "campaign_drafted"
    CAMPAIGN_DRAFT_FEEDBACK = "campaign_draft_feedback"


class Event(TypedDict):
    type: EventType
    data: Any  # don't really care about this, it will just be context to the LLM


class Thread(TypedDict):
    initial_email: EmailPayload
    events: list[Event]


# in-memory store of each email thread being processed
inbound_threads: dict[str, Thread] = {}


def add_event_to_thread(message_id: str, event: Event):
    if message_id not in inbound_threads:
        inbound_threads[message_id] = []
    inbound_threads[message_id].append(event)


##########################
######## Handlers ########
##########################
@app.get("/webhook/new-email-thread")
async def email_inbound(email_payload: EmailPayload) -> Dict[str, Any]:
    """
    route to kick off new processing thread from an email
    """
    thread_id = email_payload.message_id  # for emails, can use the message id as the unique thread identifier

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

    add_event_to_thread(thread_id, Event(type=EventType.EMAIL_RECEIVED, data=email_payload))

    # classify the email intent into one of the following:
    # - create_campaign
    # - needs_clarification
    # - unknown
    classification = classify(email_payload.body)

    add_event_to_thread(thread_id, Event(type=EventType.EMAIL_CLASSIFIED, data=classification))

    if isinstance(classification, UnknownRequest):
        # todo warn or something
        return {"status": "ok"}

    if isinstance(classification, ClarificationRequest):
        contact_request = await humanlayer.create_human_contact(
            spec=HumanContactSpec(
                message=classification.message,
            )
        )

        add_event_to_thread(thread_id, Event(type=EventType.REQUEST_MORE_INFORMATION, data=contact_request))

    campaign_info = draft_campaign(email_payload)

    add_event_to_thread(thread_id, Event(type=EventType.CAMPAIGN_DRAFTED, data=campaign_info))

    approval_request = await humanlayer.create_function_call(
        spec=FunctionCallSpec(
            fn="publish_campaign",
            kwargs={
                "message_id": thread_id,  # bit of a hack, use the email message id in the kwargs so we can match up the reply later
                "created_by": email_payload.from_address,
                "subject": email_payload.subject,
                "inbound_request": email_payload.body,
                "campaign_info": campaign_info,
                "thought": "the preview campaign is live - is this good to publish?",
            },
            rolling_state=...,  # any pydantic model
        )
    )

    add_event_to_thread(thread_id, Event(type=EventType.APPROVAL_REQUEST_CREATED, data=approval_request))

    # we've created the approval request, we'll get the answer via webhook

    return {"status": "ok"}


@app.get("/webhook/response-on-existing-thread")
async def webhook_inbound(webhook: FunctionCall | HumanContact) -> Dict[str, str]:
    """
    route to handle function call completion or human contact completion on an existing thread
    """

    if isinstance(webhook, FunctionCall):
        thread_id = webhook.kwargs.get("thread_id")
        if thread_id is None:
            raise ValueError(f"Thread {webhook.kwargs.get('thread_id')} not found")
        thread = inbound_threads.get(thread_id)
        if thread is None:
            raise ValueError(f"Thread {thread_id} not found")

        if webhook.status is not None and webhook.status.approved:
            # get the campaign info from the function call kwargs and publish it
            campaign_info = Campaign.model_validate(webhook.kwargs["campaign_info"])
            publish_campaign(campaign_info)
            add_event_to_thread(thread_id, Event(type=EventType.CAMPAIGN_PUBLISHED, data=campaign_info))
        elif webhook.status is not None and webhook.status.approved is False:
            # try to redraft the campaign, including the feedback from the human
            add_event_to_thread(thread_id, Event(type=EventType.CAMPAIGN_DRAFT_FEEDBACK, data=webhook.status.comment))
            redrafted_campaign = redraft_campaign(thread_history=thread)
            add_event_to_thread(thread_id, Event(type=EventType.CAMPAIGN_DRAFT_FEEDBACK, data=redrafted_campaign))

            approval_request = await humanlayer.create_function_call(
                spec=FunctionCallSpec(
                    fn="publish_campaign",
                    kwargs={
                        "thread_id": thread_id,
                        "created_by": webhook.kwargs["created_by"],
                        "inbound_request": webhook.kwargs["inbound_request"],
                        "campaign_info": redrafted_campaign,
                        "thought": "the preview campaign is live - is this good to publish?",
                    },
                )
            )

    elif isinstance(webhook, HumanContact):
        # todo
        pass

    return {"status": "ok"}


@app.get("/threads")
async def get_threads() -> Dict[str, List[Event]]:
    """
    Get all threads and their events
    """
    return inbound_threads


@app.get("/threads/{thread_id}")
async def get_thread(thread_id: str) -> List[Event]:
    """
    Get a single thread and its events by thread ID
    """
    thread = inbound_threads.get(thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail=f"Thread {thread_id} not found")
    return thread


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)  # noqa: S104
