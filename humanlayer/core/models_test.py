import pytest
from pydantic import ValidationError

from humanlayer.core.models import SlackContactChannel


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
