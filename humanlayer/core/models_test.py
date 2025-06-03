import pytest
from pydantic import ValidationError

from humanlayer.core.models import ContactChannel, EmailContactChannel, Escalation, SlackContactChannel


def test_slack_contact_channel_allows_none_and_nonempty_list() -> None:
    # Test None is allowed
    channel = SlackContactChannel(channel_or_user_id="C123")
    assert channel.allowed_responder_ids is None

    # Test non-empty list is allowed
    channel = SlackContactChannel(channel_or_user_id="C123", allowed_responder_ids=["U123", "U456"])
    assert channel.allowed_responder_ids == ["U123", "U456"]


def test_slack_contact_channel_rejects_empty_list() -> None:
    # Test empty list raises error
    with pytest.raises(ValidationError) as exc_info:
        SlackContactChannel(channel_or_user_id="C123", allowed_responder_ids=[])
    assert "allowed_responder_ids if provided must not be empty" in str(exc_info.value)


def test_slack_contact_channel_allows_none() -> None:
    channel = SlackContactChannel(channel_or_user_id="C123", allowed_responder_ids=None)
    assert channel.allowed_responder_ids is None


def test_escalation_channel_field() -> None:
    # Test escalation without channel
    escalation = Escalation(escalation_msg="Test escalation")
    assert escalation.channel is None
    assert escalation.escalation_msg == "Test escalation"
    assert escalation.additional_recipients is None

    # Test escalation with channel
    email_channel = EmailContactChannel(address="test@example.com")
    contact_channel = ContactChannel(email=email_channel)
    escalation_with_channel = Escalation(escalation_msg="Escalation with channel", channel=contact_channel)
    assert escalation_with_channel.channel is not None
    assert escalation_with_channel.channel.email is not None
    assert escalation_with_channel.channel.email.address == "test@example.com"
    assert escalation_with_channel.escalation_msg == "Escalation with channel"


def test_escalation_serialization() -> None:
    # Test escalation serializes channel field correctly
    email_channel = EmailContactChannel(
        address="ceo@company.com", experimental_subject_line="CRITICAL: Immediate approval required"
    )
    contact_channel = ContactChannel(email=email_channel)
    escalation = Escalation(escalation_msg="CRITICAL: Still no response", channel=contact_channel)

    # Test model_dump includes channel field
    dumped = escalation.model_dump()
    assert "channel" in dumped
    assert dumped["channel"]["email"]["address"] == "ceo@company.com"
    assert dumped["channel"]["email"]["experimental_subject_line"] == "CRITICAL: Immediate approval required"
