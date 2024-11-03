from unittest.mock import Mock

import pytest

from humanlayer import (
    AgentBackend,
    ContactChannel,
    HumanContact,
    HumanContactSpec,
    HumanContactStatus,
    HumanLayer,
    SlackContactChannel,
)
from humanlayer.core.models import ResponseOption
from humanlayer.core.protocol import AgentStore, HumanLayerException


def test_human_as_tool_generic() -> None:
    """
    test that we omit contact channel if none passed,
    and let the backend decide whether to use a default
    or reject the call
    """
    mock_backend = Mock(spec=AgentBackend)
    contacts = Mock(spec=AgentStore[HumanContact, HumanContactStatus])
    mock_backend.contacts.return_value = contacts

    contacts.add.return_value = None

    hl = HumanLayer(
        backend=mock_backend,
        genid=lambda x: "generated-id",
        sleep=lambda x: None,
    )

    contacts.get.return_value = HumanContact(
        run_id="generated-id",
        call_id="generated-id",
        spec=HumanContactSpec(msg="what is your favorite color"),
        status=HumanContactStatus(response="magenta"),
    )

    ret = hl.human_as_tool()("what is your favorite color")

    assert ret == "magenta"

    contacts.add.assert_called_once_with(
        HumanContact(
            run_id="generated-id",
            call_id="generated-id",
            spec=HumanContactSpec(msg="what is your favorite color"),
        )
    )

    contacts.get.assert_called_once_with("generated-id")


def test_human_as_tool_instance_contact_channel() -> None:
    """
    test that we can pass in a contact channel in the
    HumanLayer constructor
    """
    mock_backend = Mock(spec=AgentBackend)
    contacts = Mock(spec=AgentStore[HumanContact, HumanContactStatus])
    mock_backend.contacts.return_value = contacts

    contacts.add.return_value = None

    contact_channel = ContactChannel(
        slack=SlackContactChannel(
            channel_or_user_id="U8675309",
            context_about_channel_or_user="a dm with the librarian",
        )
    )

    hl = HumanLayer(
        backend=mock_backend,
        contact_channel=contact_channel,
        genid=lambda x: "generated-id",
        sleep=lambda x: None,
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

    assert (
        tool.__name__
        == """
    contact_human_in_slack_in_a_dm_with_the_librarian
    """.strip()
    )

    assert (
        tool.__doc__
        == """
    Contact a human via slack and wait for a response in a dm with the librarian
    """.strip()
    )

    ret = tool("what is your favorite color")

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

    pass


def test_human_as_tool_fn_contact_channel() -> None:
    """
    test that we can pass in a contact channel in the
    human_as_tool() method
    """
    mock_backend = Mock(spec=AgentBackend)
    contacts = Mock(spec=AgentStore[HumanContact, HumanContactStatus])
    mock_backend.contacts.return_value = contacts

    contacts.add.return_value = None

    contact_channel = ContactChannel(
        slack=SlackContactChannel(
            channel_or_user_id="U8675309",
            context_about_channel_or_user="a dm with the librarian",
        )
    )

    hl = HumanLayer(
        backend=mock_backend,
        genid=lambda x: "generated-id",
        sleep=lambda x: None,
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

    tool = hl.human_as_tool(contact_channel)

    assert tool.__name__ == "contact_human_in_slack_in_a_dm_with_the_librarian"
    assert (
        tool.__doc__
        == """
    Contact a human via slack and wait for a response in a dm with the librarian
    """.strip()
    )

    ret = tool("what is your favorite color")

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

    pass


def test_human_as_tool_response_names_must_be_unique() -> None:
    """
    test that the response names in the response_options must be unique
    """
    hl = HumanLayer()
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


def test_human_as_tool_forwards_contact_channel() -> None:
    """
    Test that the human_as_tool method forwards the contact channel,
    even if not explicitly provided in the method call.
    """
    mock_backend = Mock(spec=AgentBackend)
    contacts = Mock(spec=AgentStore[HumanContact, HumanContactStatus])
    mock_backend.contacts.return_value = contacts

    contact_channel = ContactChannel(
        slack=SlackContactChannel(
            channel_or_user_id="U8675309",
            context_about_channel_or_user="a dm with the librarian",
        )
    )

    human_contact = HumanContact(
        run_id="generated-id",
        call_id="generated-id",
        spec=HumanContactSpec(msg="What is your favorite color?", channel=contact_channel),
    )
    contacts.add.return_value = human_contact

    contacts.get.return_value = human_contact.model_copy(
        update={
            "status": HumanContactStatus(
                response="Blue",
            )
        },
        deep=True,
    )
    hl = HumanLayer(
        backend=mock_backend,
        genid=lambda x: "generated-id",
        sleep=lambda x: None,
        contact_channel=contact_channel,
    )

    human_tool = hl.fetch_human_response(HumanContactSpec(msg="What is your favorite color?"))
    response = human_tool.as_completed()

    assert response == "Blue"

    contacts.add.assert_called_once_with(
        HumanContact(
            run_id="generated-id",
            call_id="generated-id",
            spec=HumanContactSpec(
                msg="What is your favorite color?",
                channel=contact_channel,
            ),
        )
    )
    contacts.get.assert_called_once_with("generated-id")


def test_create_human_contact_with_call_id() -> None:
    """
    test that the create_human_contact method works when you supply a call_id
    """
    mock_backend = Mock(spec=AgentBackend)
    contacts = Mock(spec=AgentStore[HumanContact, HumanContactStatus])
    mock_backend.contacts.return_value = contacts

    call_id = "special-id"
    human_contact = HumanContact(
        run_id="generated-id",
        call_id=call_id,
        spec=HumanContactSpec(msg="What is your favorite color?"),
    )
    contacts.add.return_value = human_contact

    hl = HumanLayer(
        backend=mock_backend,
        genid=lambda x: "generated-id",
        sleep=lambda x: None,
    )

    resp = hl.create_human_contact(
        spec=HumanContactSpec(msg="What is your favorite color?"),
        call_id=call_id,
    )
    assert resp == human_contact

    contacts.add.assert_called_once_with(human_contact)
