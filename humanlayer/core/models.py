import logging
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, field_validator

logger = logging.getLogger(__name__)


class SlackContactChannel(BaseModel):
    """
    Route for contacting a user or channel via slack
    """

    # can send to a channel or a user id,
    # must be an ID like C123456 or U123456, not #channel or @user
    channel_or_user_id: str

    # target context for the LLM, e.g. target_context="the channel with the director of engineering"
    # will update the tool description to
    # "contact a human in slack in the channel with the director of engineering"
    #
    # other examples e.g. "a dm with the user you're assisting"
    context_about_channel_or_user: str | None = None

    # a bot token to override the default contact channel
    # if you use a custom bot token, you must set your app's
    # slack webhook destination appropriately so your humanlayer server can receive them
    bot_token: str | None = None
    #
    # bot_token_ref: str | None

    # a list of responders to allow to respond to this message
    # other messages will be ignored
    allowed_responder_ids: list[str] | None = None

    experimental_slack_blocks: bool | None = None

    @field_validator("allowed_responder_ids")
    @classmethod
    def validate_allowed_responder_ids(cls, v: list[str] | None) -> list[str] | None:
        if v is not None and len(v) == 0:
            raise ValueError("allowed_responder_ids if provided must not be empty")
        return v


class SMSContactChannel(BaseModel):
    """
    Route for contacting a user via SMS
    """

    phone_number: str

    # any context for the LLM about the user this channel can contact
    # e.g. "the user you are assisting" will update the tool name to
    # contact_human_via_sms_to_the_user_you_are_assisting
    context_about_user: str | None = None


class WhatsAppContactChannel(BaseModel):
    """
    Route for contacting a user via WhatsApp
    """

    phone_number: str

    # any context for the LLM about the user this channel can contact
    # e.g. "the user you are assisting" will update the tool name to
    # contact_human_via_whatsapp_to_the_user_you_are_assisting
    context_about_user: str | None = None


class EmailContactChannel(BaseModel):
    """
    Route for contacting a user via email
    """

    address: str

    # any context for the LLM about the user this channel can contact
    # e.g. "the user you are assisting" will update the tool name to
    # contact_human_via_email_to_the_user_you_are_assisting
    context_about_user: str | None = None

    # for replying on an existing email thread
    subject: str | None = None
    references_message_id: str | None = None
    in_reply_to_message_id: str | None = None

    # these are all deprecated, use subject, references_message_id, and in_reply_to_message_id instead
    experimental_subject_line: str | None = None
    experimental_references_message_id: str | None = None
    experimental_in_reply_to_message_id: str | None = None

    def __init__(self, **kwargs) -> None:  # type: ignore
        super().__init__(**kwargs)
        if self.experimental_subject_line is not None:
            if self.subject is None:
                self.subject = self.experimental_subject_line
        else:
            self.experimental_subject_line = self.subject

        if self.experimental_references_message_id is not None:
            if self.references_message_id is None:
                self.references_message_id = self.experimental_references_message_id
        else:
            self.experimental_references_message_id = self.references_message_id

        if self.experimental_in_reply_to_message_id is not None:
            if self.in_reply_to_message_id is None:
                self.in_reply_to_message_id = self.experimental_in_reply_to_message_id
        else:
            self.experimental_in_reply_to_message_id = self.in_reply_to_message_id

    @classmethod
    def in_reply_to(
        cls,
        from_address: str,
        subject: str,
        message_id: str,
        context_about_user: str | None = None,
    ) -> "EmailContactChannel":
        return cls(
            address=from_address,
            context_about_user=context_about_user,
            experimental_subject_line=f"Re: {subject}",
            experimental_in_reply_to_message_id=message_id,
            experimental_references_message_id=message_id,
        )


class ContactChannel(BaseModel):
    slack: SlackContactChannel | None = None
    sms: SMSContactChannel | None = None
    whatsapp: WhatsAppContactChannel | None = None
    email: EmailContactChannel | None = None

    def context(self) -> str | None:
        if self.slack:
            return self.slack.context_about_channel_or_user
        if self.sms:
            return self.sms.context_about_user
        if self.whatsapp:
            return self.whatsapp.context_about_user
        if self.email:
            return self.email.context_about_user
        return None


class ResponseOption(BaseModel):
    name: str
    title: str | None = None
    description: str | None = None
    prompt_fill: str | None = None
    interactive: bool = False


class FunctionCallSpec(BaseModel):
    fn: str
    kwargs: dict
    channel: ContactChannel | None = None
    reject_options: list[ResponseOption] | None = None
    state: dict | None = None  # Optional state to be preserved across the request lifecycle


class FunctionCallStatus(BaseModel):
    requested_at: datetime | None = None
    responded_at: datetime | None = None
    approved: bool | None = None
    comment: str | None = None
    reject_option_name: str | None = None

    class Approved(BaseModel):
        approved: Literal[True]
        comment: str | None

    class Rejected(BaseModel):
        approved: Literal[False]
        comment: str

    def as_completed(self) -> Approved | Rejected:
        if self.approved is None:
            raise ValueError("FunctionCallStatus.as_completed() called before approval")

        if self.approved is True:
            return FunctionCallStatus.Approved(
                approved=self.approved,
                comment=self.comment,
            )

        if self.approved is False and self.comment is None:
            raise ValueError("FunctionCallStatus.Rejected with no comment")

        return FunctionCallStatus.Rejected(
            approved=self.approved,
            comment=self.comment,
        )


class FunctionCall(BaseModel):
    run_id: str
    call_id: str
    spec: FunctionCallSpec
    status: FunctionCallStatus | None = None

    class Completed(BaseModel):
        call: "FunctionCall"

        def as_completed(
            self,
        ) -> FunctionCallStatus.Approved | FunctionCallStatus.Rejected:
            if self.call.status is None:
                raise ValueError("FunctionCall.Completed.as_completed() called before approval")
            return self.call.status.as_completed()


class HumanContactSpec(BaseModel):
    msg: str
    subject: str | None = None
    channel: ContactChannel | None = None
    response_options: list[ResponseOption] | None = None
    state: dict | None = None  # Optional state to be preserved across the request lifecycle


class HumanContactStatus(BaseModel):
    requested_at: datetime | None = None
    responded_at: datetime | None = None
    response: str | None = None
    response_option_name: str | None = None


class HumanContact(BaseModel):
    run_id: str
    call_id: str
    spec: HumanContactSpec
    status: HumanContactStatus | None = None

    class Completed(BaseModel):
        contact: "HumanContact"

        def as_completed(self) -> str:
            if self.contact.status is None or self.contact.status.response is None:
                raise ValueError("HumanContact.Completed.as_completed() called before response")
            return self.contact.status.response
