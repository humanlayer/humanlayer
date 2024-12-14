from pydantic import BaseModel


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
