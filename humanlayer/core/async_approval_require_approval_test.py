from unittest.mock import AsyncMock

import pytest

from humanlayer.core.async_approval import AsyncHumanLayer
from humanlayer.core.async_protocol import AsyncAgentBackend, AsyncAgentStore
from humanlayer.core.models import (
    ContactChannel,
    FunctionCall,
    FunctionCallSpec,
    FunctionCallStatus,
    ResponseOption,
    SlackContactChannel,
)
from humanlayer.core.protocol import HumanLayerException


@pytest.mark.asyncio
async def test_require_approval() -> None:
    """Basic approval flow test matching sync version"""
    mock_backend = AsyncMock(spec=AsyncAgentBackend)
    functions = AsyncMock(spec=AsyncAgentStore[FunctionCall, FunctionCallStatus])
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

    mock_function = AsyncMock()
    mock_function.__name__ = "_fn_"
    mock_function.return_value = "bosh"

    hl = AsyncHumanLayer(
        backend=mock_backend,
        genid=lambda x: "generated-id",
        sleep=AsyncMock(),
    )

    wrapped = hl.require_approval().wrap(mock_function)

    ret = await wrapped(bar="baz")
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


@pytest.mark.asyncio
async def test_require_approval_with_reject_options() -> None:
    """Test approval with reject options"""
    mock_backend = AsyncMock(spec=AsyncAgentBackend)
    functions = AsyncMock(spec=AsyncAgentStore[FunctionCall, FunctionCallStatus])
    mock_backend.functions.return_value = functions

    reject_options = [
        ResponseOption(name="unsafe", title="Unsafe", description="Operation is unsafe"),
        ResponseOption(name="invalid", title="Invalid", description="Invalid parameters"),
    ]

    hl = AsyncHumanLayer(
        backend=mock_backend,
        genid=lambda x: "generated-id",
        sleep=AsyncMock(),
    )

    @hl.require_approval(reject_options=reject_options)
    async def my_function(x: int) -> int:
        return x * 2

    # Test duplicate reject option names
    with pytest.raises(HumanLayerException) as exc:

        @hl.require_approval(
            reject_options=[
                ResponseOption(name="duplicate", title="First"),
                ResponseOption(name="duplicate", title="Second"),
            ]
        )
        async def another_function() -> None:
            pass

    assert "reject_options must have unique names" in str(exc.value)


@pytest.mark.asyncio
async def test_require_approval_with_contact_channel() -> None:
    """Test approval with contact channel"""
    mock_backend = AsyncMock(spec=AsyncAgentBackend)
    functions = AsyncMock(spec=AsyncAgentStore[FunctionCall, FunctionCallStatus])
    mock_backend.functions.return_value = functions

    contact_channel = ContactChannel(
        slack=SlackContactChannel(
            channel_or_user_id="U123456",
            context_about_channel_or_user="test channel",
        )
    )

    hl = AsyncHumanLayer(
        backend=mock_backend,
        genid=lambda x: "generated-id",
        sleep=AsyncMock(),
    )

    @hl.require_approval(contact_channel=contact_channel)
    async def my_function(x: int) -> int:
        return x * 2

    # Mock rejection with channel context
    functions.add.return_value = FunctionCall(
        run_id="generated-id",
        call_id="generated-id",
        spec=FunctionCallSpec(
            fn="my_function",
            kwargs={"x": 5},
            channel=contact_channel,
        ),
    )
    functions.get.return_value = FunctionCall(
        run_id="generated-id",
        call_id="generated-id",
        spec=FunctionCallSpec(
            fn="my_function",
            kwargs={"x": 5},
            channel=contact_channel,
        ),
        status=FunctionCallStatus(approved=False, comment="Not allowed"),
    )

    result = await my_function(5)
    assert "User in test channel denied my_function with message: Not allowed" in result
