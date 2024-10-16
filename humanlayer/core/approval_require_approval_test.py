from unittest.mock import Mock

import pytest

from humanlayer import (
    AgentBackend,
    ContactChannel,
    FunctionCall,
    FunctionCallSpec,
    HumanLayer,
    ResponseOption,
    SlackContactChannel,
)
from humanlayer.core.protocol import AgentStore, HumanLayerException


def test_require_approval() -> None:
    mock_backend = Mock(spec=AgentBackend)
    functions = Mock(spec=AgentStore[FunctionCall])
    mock_backend.functions.return_value = functions

    functions.add.return_value = None

    mock_function = Mock()
    mock_function.__name__ = "_fn_"
    mock_function.return_value = "bosh"

    hl = HumanLayer(
        backend=mock_backend,
        genid=lambda x: "generated-id",
    )

    wrapped = hl.require_approval().wrap(mock_function)

    ret = wrapped(bar="baz")
    assert ret == "bosh"

    functions.add.assert_called_once_with(
        FunctionCall(
            run_id="generated-id",
            call_id="generated-id",
            spec=FunctionCallSpec(fn="_fn_", kwargs={"bar": "baz"}, channel=None),
        )
    )
    functions.get.assert_called_once_with("generated-id")
    mock_function.assert_called_with(bar="baz")


def test_require_approval_instance_contact_channel() -> None:
    """
    test setting contact channel on the instance
    """
    mock_backend = Mock(spec=AgentBackend)
    functions = Mock(spec=AgentStore[FunctionCall])
    mock_backend.functions.return_value = functions

    functions.add.return_value = None

    mock_function = Mock()
    mock_function.__name__ = "_fn_"
    mock_function.return_value = "bosh"

    contact_channel = ContactChannel(
        slack=SlackContactChannel(
            channel_or_user_id="U8675309",
            context_about_channel_or_user="a dm with the librarian",
        )
    )

    hl = HumanLayer(
        backend=mock_backend,
        genid=lambda x: "generated-id",
        contact_channel=contact_channel,
    )

    wrapped = hl.require_approval().wrap(mock_function)

    ret = wrapped(bar="baz")
    assert ret == "bosh"

    functions.add.assert_called_once_with(
        FunctionCall(
            run_id="generated-id",
            call_id="generated-id",
            spec=FunctionCallSpec(
                fn="_fn_",
                kwargs={"bar": "baz"},
                channel=contact_channel,
            ),
        )
    )
    functions.get.assert_called_once_with("generated-id")
    mock_function.assert_called_with(bar="baz")


def test_require_approval_wrapper_contact_channel() -> None:
    """
    test setting contact channel on the decorator/wrapper
    """
    mock_backend = Mock(spec=AgentBackend)
    functions = Mock(spec=AgentStore[FunctionCall])
    mock_backend.functions.return_value = functions

    functions.add.return_value = None

    mock_function = Mock()
    mock_function.__name__ = "_fn_"
    mock_function.return_value = "bosh"

    contact_channel = ContactChannel(
        slack=SlackContactChannel(
            channel_or_user_id="U8675309",
            context_about_channel_or_user="a dm with the librarian",
        )
    )

    hl = HumanLayer(backend=mock_backend, genid=lambda x: "generated-id", sleep=lambda x: None)

    wrapped = hl.require_approval(contact_channel).wrap(mock_function)

    ret = wrapped(bar="baz")
    assert ret == "bosh"

    functions.add.assert_called_once_with(
        FunctionCall(
            run_id="generated-id",
            call_id="generated-id",
            spec=FunctionCallSpec(
                fn="_fn_",
                kwargs={"bar": "baz"},
                channel=contact_channel,
            ),
        )
    )
    functions.get.assert_called_once_with("generated-id")
    mock_function.assert_called_with(bar="baz")


def test_require_approval_unique_reject_option_names() -> None:
    hl = HumanLayer()
    with pytest.raises(HumanLayerException) as e:
        hl.require_approval(
            reject_options=[
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

    assert "reject_options must have unique names" in str(e.value)


def test_griptape_support() -> None:
    mock_backend = Mock(spec=AgentBackend)
    functions = Mock(spec=AgentStore[FunctionCall])
    mock_backend.functions.return_value = functions

    functions.add.return_value = None

    mock_function = Mock()
    mock_function.__name__ = "_fn_"
    mock_function.return_value = "bosh"

    hl = HumanLayer(
        griptape_munging=True,
        backend=mock_backend,
        genid=lambda x: "generated-id",
        sleep=lambda x: None,
        api_key="sk-proj-123",
    )

    wrapped = hl.require_approval().wrap(mock_function)

    ret = wrapped(..., {"values": {"a": 1, "b": 2}})
    assert ret == "bosh"

    functions.add.assert_called_once_with(
        FunctionCall(
            run_id="generated-id",
            call_id="generated-id",
            spec=FunctionCallSpec(
                fn="_fn_",
                kwargs={"values": {"a": 1, "b": 2}},
            ),
        )
    )
    functions.get.assert_called_once_with("generated-id")
    mock_function.assert_called_with(..., {"values": {"a": 1, "b": 2}})
