"""
Models for agent webhook payloads.

These models define the structure of payloads sent to agent webhooks when events occur,
such as receiving an email. They are used by the HumanLayer platform to serialize webhook
data in a consistent format that can be consumed by agent implementations.

For example, when an email is received, HumanLayer will send an EmailPayload to the
configured webhook endpoint containing the email content and metadata.
"""

from typing import List, Optional

from pydantic import BaseModel

from humanlayer.core.models import EmailContactChannel


class EmailMessage(BaseModel):
    """A message in an email thread"""

    from_address: str
    to_address: List[str]
    cc_address: List[str]
    subject: str
    content: str
    datetime: str


class EmailPayload(BaseModel):
    """Payload for email agent webhooks"""

    from_address: str
    to_address: str
    subject: str
    body: str
    message_id: str
    previous_thread: Optional[List[EmailMessage]] = None
    raw_email: str
    is_test: bool | None = None  # will be set if the email is a test webhook from the server

    def as_channel(self, context_about_user: str | None = None) -> EmailContactChannel:
        return EmailContactChannel.in_reply_to(
            from_address=self.from_address,
            message_id=self.message_id,
            subject=self.subject,
            context_about_user=context_about_user,
        )


class SlackMessage(BaseModel):
    from_user_id: str
    channel_id: str
    content: str
    message_id: str


class SlackThread(BaseModel):
    thread_ts: str
    channel_id: str
    events: list[SlackMessage]
