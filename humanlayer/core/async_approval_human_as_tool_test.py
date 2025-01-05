from unittest.mock import AsyncMock

import pytest

from humanlayer import (
    ContactChannel,
    HumanContact,
    HumanContactSpec,
    HumanContactStatus,
    SlackContactChannel,
)
from humanlayer.core.async_approval import AsyncHumanLayer
from humanlayer.core.async_protocol import AsyncAgentBackend, AsyncAgentStore
from humanlayer.core.models import ResponseOption
from humanlayer.core.protocol import HumanLayerException


@pytest.mark.asyncio
async def test_human_as_tool_generic() -> None:
    """
    test that we omit contact channel if none passed,
    and let the backend decide whether to use a default
    or reject the call
    """
    mock_backend = AsyncMock(spec=AsyncAgentBackend)
    contacts = AsyncMock(spec=AsyncAgentStore[HumanContact, HumanContactStatus])
    mock_backend.contacts.return_value = contacts
    contact = HumanContact(
        run_id="generated-id",
        call_id="generated-id",
        spec=HumanContactSpec(msg="what is your favorite color"),
    )
    contacts.add.return_value = contact

    hl = AsyncHumanLayer(
        backend=mock_backend,
        genid=lambda x: "generated-id",
        sleep=AsyncMock(),  # Mock asyncio.sleep
    )

    contacts.get.return_value = HumanContact(
        run_id="generated-id",
        call_id="generated-id",
        spec=HumanContactSpec(msg="what is your favorite color"),
        status=HumanContactStatus(response="magenta"),
    )

    contact_human = hl.human_as_tool()
    ret = await contact_human("what is your favorite color")

    assert ret == "magenta"

    contacts.add.assert_called_once_with(
        HumanContact(
            run_id="generated-id",
            call_id="generated-id",
            spec=HumanContactSpec(msg="what is your favorite color"),
        )
    )

    contacts.get.assert_called_once_with("generated-id")


@pytest.mark.asyncio
async def test_human_as_tool_instance_contact_channel() -> None:
    """
    test that we can pass in a contact channel in the
    AsyncHumanLayer constructor
    """
    mock_backend = AsyncMock(spec=AsyncAgentBackend)
    contacts = AsyncMock(spec=AsyncAgentStore[HumanContact, HumanContactStatus])
    mock_backend.contacts.return_value = contacts
    contact_channel = ContactChannel(
        slack=SlackContactChannel(
            channel_or_user_id="U8675309",
            context_about_channel_or_user="a dm with the librarian",
        )
    )
    contact = HumanContact(
        run_id="generated-id",
        call_id="generated-id",
        spec=HumanContactSpec(
            msg="what is your favorite color",
            channel=contact_channel,
        ),
    )
    contacts.add.return_value = contact

    hl = AsyncHumanLayer(
        backend=mock_backend,
        contact_channel=contact_channel,
        genid=lambda x: "generated-id",
        sleep=AsyncMock(),
    )

    contacts.get.return_value = HumanContact(
        run_id="generated-id",
        call_id="generated-id",
        spec=HumanContactSpec(
            msg="what is your favorite color",
            channel=contact_channel,
        ),
        status=HumanContactStatus(response="magenta"),
    )

    tool = hl.human_as_tool()

    assert tool.__name__ == "contact_human_in_slack_in_a_dm_with_the_librarian"
    assert tool.__doc__ == "Contact a human via slack and wait for a response in a dm with the librarian"

    ret = await tool("what is your favorite color")

    assert ret == "magenta"

    contacts.add.assert_called_once_with(
        HumanContact(
            run_id="generated-id",
            call_id="generated-id",
            spec=HumanContactSpec(
                msg="what is your favorite color",
                channel=contact_channel,
            ),
        )
    )

    contacts.get.assert_called_once_with("generated-id")


@pytest.mark.asyncio
async def test_human_as_tool_response_names_must_be_unique() -> None:
    """
    test that the response names in the response_options must be unique
    """
    hl = AsyncHumanLayer(api_key="test")
    with pytest.raises(HumanLayerException) as e:
        hl.human_as_tool(
            response_options=[
                ResponseOption(
                    name="foo",
                    title="foo",
                    description="foo",
                    prompt_fill="foo",
                ),
                ResponseOption(
                    name="foo",
                    title="bar",
                    description="bar",
                    prompt_fill="bar",
                ),
            ]
        )

    assert "response_options must have unique names" in str(e.value)
