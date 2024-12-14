# a webhooks-free version
from enum import Enum
import random
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Any, Dict, List, Literal, TypedDict
from humanlayer import AsyncHumanLayer, FunctionCall, FunctionCallSpec
from humanlayer.core.models import ContactChannel, EmailContactChannel, HumanContact, HumanContactSpec
from .types import EmailPayload

app = FastAPI(title="HumanLayer FastAPI Email Example", version="1.0.0")


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
    intent: Literal["next_step_unknown"]
    message: str


# dummy method, replace with your AI / classifier of choice
def determine_next_step(thread: "Thread") -> ClarificationRequest | CampaignRequest | UnknownRequest:
    """determine the next step in the email thread"""
    if "campaign" in str(thread["events"][-1]["data"]).lower():
        return CampaignRequest()
    elif "campaign" not in str(thread["initial_email"]).lower():
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
    print(f"Published campaign {campaign.id} at {campaign.url}")


##########################
########  State   ########
##########################
class EventType(Enum):
    EMAIL_RECEIVED = "email_received"

    REQUEST_MORE_INFORMATION = "request_more_information"
    HUMAN_SUPPLIED_MORE_INFORMATION = "human_supplied_more_information"

    CAMPAIGN_DRAFTED = "campaign_drafted"
    HUMAN_SUPPLIED_CAMPAIGN_DRAFT_FEEDBACK = "human_supplied_campaign_draft_feedback"

    DRAFT_PUBLISHED = "draft_published"


class Event(TypedDict):
    type: EventType
    data: Any  # don't really care about this, it will just be context to the LLM


class Thread(TypedDict):
    initial_email: EmailPayload
    events: list[Event]

    # example of how you can use this as the rolling context state for the LLM
    def to_prompt(self) -> str:
        """convert the thread to a prompt for the LLM"""
        history = "\n\n".join([f"{event.type} ==> {event.data}" for event in self.events])

        return f"""
        Email Thread:
        {self.initial_email.body}

        Steps taken so far:
        {history}

        Select the next action to take, it should be one of:

        - request_more_information(message: str)
        - ready_to_create_campaign()
        - next_step_unknown(message: str)
        """


##########################
######## Handlers ########
##########################
@app.get("/webhook/new-email-thread")
async def email_inbound(email_payload: EmailPayload) -> Dict[str, Any]:
    """
    route to kick off new processing thread from an email
    """
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

    thread.events.append(Event(type=EventType.EMAIL_RECEIVED, data=email_payload))

    while True:
        next_step = determine_next_step(thread)
        if isinstance(next_step, UnknownRequest):
            # todo warn or something
            return {"status": "ok"}

        elif isinstance(next_step, ClarificationRequest):
            thread.events.append(Event(type=EventType.REQUEST_MORE_INFORMATION, data=next_step.message))

            # send the question on the email thread and block until the human responds
            response = await humanlayer.fetch_human_response(
                spec=HumanContactSpec(
                    message=next_step.message,
                )
            ).as_completed()

            thread.events.append(
                Event(type=EventType.HUMAN_SUPPLIED_MORE_INFORMATION, data={"human_response": response})
            )

        elif isinstance(next_step, CampaignRequest):
            campaign_info = draft_or_redraft_campaign(thread)
            thread.events.append(Event(type=EventType.CAMPAIGN_DRAFTED, data=campaign_info))
            approval_response = await humanlayer.fetch_approval(
                spec=FunctionCallSpec(
                    fn="publish_campaign",
                    kwargs={
                        "inbound_request": email_payload.body,
                        "campaign_info": campaign_info,
                        "thought": "the preview campaign is live - is this good to publish?",
                    },
                )
            ).as_completed()

            if approval_response.approved is False:
                thread.events.append(Event(type=EventType.HUMAN_DENIED_PUBLISH, data=approval_response.comment))
                continue
            else:
                publish_campaign(campaign_info)
                return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)  # noqa: S104
