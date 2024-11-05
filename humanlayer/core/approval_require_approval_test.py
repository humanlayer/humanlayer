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
from humanlayer.core.models import FunctionCallStatus
from humanlayer.core.protocol import AgentStore, HumanLayerException


def test_require_approval() -> None:
    mock_backend = Mock(spec=AgentBackend)
    functions = Mock(spec=AgentStore[FunctionCall, FunctionCallStatus])
    mock_backend.functions.return_value = functions

    function_call = FunctionCall(
        run_id="generated-id",
        call_id="generated-id",
        spec=FunctionCallSpec(fn="_fn_", kwargs={"bar": "baz"}, channel=None),
    )
    functions.add.return_value = function_call
    functions.get.return_value = function_call.model_copy(
        deep=True, update={"status": FunctionCallStatus(approved=True)}
    )

    mock_function = Mock()
    mock_function.__name__ = "_fn_"
    mock_function.return_value = "bosh"

    hl = HumanLayer(
        backend=mock_backend,
        genid=lambda x: "generated-id",
        sleep=lambda x: None,
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
    functions = Mock(spec=AgentStore[FunctionCall, FunctionCallStatus])
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

    function_call = FunctionCall(
        run_id="generated-id",
        call_id="generated-id",
        spec=FunctionCallSpec(fn="_fn_", kwargs={"bar": "baz"}, channel=contact_channel),
    )

    functions.add.return_value = function_call
    functions.get.return_value = function_call.model_copy(
        deep=True,
        update={"status": FunctionCallStatus(approved=True)},
    )

    hl = HumanLayer(
        backend=mock_backend,
        genid=lambda x: "generated-id",
        sleep=lambda x: None,
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
    functions = Mock(spec=AgentStore[FunctionCall, FunctionCallStatus])
    mock_backend.functions.return_value = functions

    mock_function = Mock()
    mock_function.__name__ = "_fn_"
    mock_function.return_value = "bosh"

    contact_channel = ContactChannel(
        slack=SlackContactChannel(
            channel_or_user_id="U8675309",
            context_about_channel_or_user="a dm with the librarian",
        )
    )

    function_call = FunctionCall(
        run_id="generated-id",
        call_id="generated-id",
        spec=FunctionCallSpec(fn="_fn_", kwargs={"bar": "baz"}, channel=contact_channel),
    )
    functions.add.return_value = function_call
    functions.get.return_value = function_call.model_copy(
        deep=True,
        update={"status": FunctionCallStatus(approved=True)},
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
    functions = Mock(spec=AgentStore[FunctionCall, FunctionCallStatus])
    mock_backend.functions.return_value = functions

    function_call = FunctionCall(
        run_id="generated-id",
        call_id="generated-id",
        spec=FunctionCallSpec(fn="_fn_", kwargs={"bar": "baz"}, channel=None),
    )
    functions.add.return_value = function_call
    functions.get.return_value = function_call.model_copy(
        deep=True,
        update={"status": FunctionCallStatus(approved=True)},
    )

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


def test_fetch_approval_forwards_contact_channel() -> None:
    """
    test that the fetch_approval method forwards the contact channel,
    even if the passed FunctionCallSpec does not have one
    """
    mock_backend = Mock(spec=AgentBackend)
    functions = Mock(spec=AgentStore[FunctionCall, FunctionCallStatus])
    mock_backend.functions.return_value = functions

    contact_channel = ContactChannel(
        slack=SlackContactChannel(
            channel_or_user_id="U8675309",
            context_about_channel_or_user="a dm with the librarian",
        )
    )

    add_call = FunctionCall(
        run_id="generated-id",
        call_id="generated-id",
        spec=FunctionCallSpec(fn="_fn_", kwargs={"bar": "baz"}, channel=contact_channel),
    )

    functions.add.return_value = add_call
    functions.get.return_value = add_call.model_copy(deep=True, update={"status": FunctionCallStatus(approved=True)})

    hl = HumanLayer(
        backend=mock_backend,
        genid=lambda x: "generated-id",
        sleep=lambda x: None,
        contact_channel=contact_channel,
    )

    resp = hl.fetch_approval(
        FunctionCallSpec(fn="_fn_", kwargs={"bar": "baz"}),
    ).as_completed()

    assert resp.approved is True

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


def test_create_function_call_with_call_id() -> None:
    """
    test that the create_function_call method works when you supply a call_id
    """
    mock_backend = Mock(spec=AgentBackend)
    functions = Mock(spec=AgentStore[FunctionCall, FunctionCallStatus])
    mock_backend.functions.return_value = functions

    call_id = "special-id"
    function_call = FunctionCall(
        run_id="generated-id",
        call_id=call_id,
        spec=FunctionCallSpec(fn="_fn_", kwargs={"bar": "baz"}, channel=None),
    )

    functions.add.return_value = function_call

    hl = HumanLayer(
        backend=mock_backend,
        genid=lambda x: "generated-id",
        sleep=lambda x: None,
    )

    resp = hl.create_function_call(
        spec=FunctionCallSpec(fn="_fn_", kwargs={"bar": "baz"}, channel=None),
        call_id=call_id,
    )

    assert resp == function_call

    functions.add.assert_called_once_with(function_call)
