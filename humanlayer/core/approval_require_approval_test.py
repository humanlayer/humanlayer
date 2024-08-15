from unittest.mock import Mock

from humanlayer import AgentBackend, FunctionCall, FunctionCallSpec, HumanLayer
from humanlayer.core.protocol import AgentStore


def test_require() -> None:
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
    mock_function.assert_called_with(bar="baz")
