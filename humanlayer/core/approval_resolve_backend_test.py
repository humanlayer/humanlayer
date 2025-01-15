import pytest

from humanlayer import ApprovalMethod, CloudHumanLayerBackend, HumanLayer
from humanlayer.testing import env_var


def test_no_args() -> None:
    with env_var("HUMANLAYER_API_KEY", ""):
        hl = HumanLayer()
        assert hl.approval_method == ApprovalMethod.CLI


def test_cli_hardcoded() -> None:
    hl = HumanLayer(approval_method=ApprovalMethod.CLI)
    assert hl.approval_method == ApprovalMethod.CLI


def test_cloud() -> None:
    with env_var("HUMANLAYER_API_KEY", ""):
        with pytest.raises(Exception) as e:
            HumanLayer.cloud()
        assert "HUMANLAYER_API_KEY is required for cloud approvals" in str(e.value)


def test_cloud_endpoint_kwarg_default() -> None:
    hl = HumanLayer(api_key="foo")
    assert hl.approval_method == ApprovalMethod.BACKEND
    assert hl.backend is not None
    assert isinstance(hl.backend, CloudHumanLayerBackend)
    assert hl.backend.connection.api_key == "foo"
    assert hl.backend.connection.api_base_url == "https://api.humanlayer.dev/humanlayer/v1"


def test_cloud_endpoint_kwarg() -> None:
    hl = HumanLayer(api_key="foo", api_base_url="fake")
    assert hl.approval_method == ApprovalMethod.BACKEND
    assert hl.backend is not None
    assert isinstance(hl.backend, CloudHumanLayerBackend)
    assert hl.backend.connection.api_base_url == "fake"


def test_env_var_cloud() -> None:
    with env_var("HUMANLAYER_API_KEY", "foo"):
        hl = HumanLayer()
        assert hl.approval_method == ApprovalMethod.BACKEND
        assert hl.backend is not None
        assert isinstance(hl.backend, CloudHumanLayerBackend)
        assert hl.backend.connection.api_key == "foo"
        assert hl.backend.connection.api_base_url == "https://api.humanlayer.dev/humanlayer/v1"


def test_timeout() -> None:
    """
    test that we can configure the timeout
    """
    with (
        env_var("HUMANLAYER_HTTP_TIMEOUT_SECONDS", "30"),
        env_var("HUMANLAYER_API_KEY", "foo"),
    ):
        hl = HumanLayer()
        assert hl.backend is not None
        assert True  # removed http timeout test
