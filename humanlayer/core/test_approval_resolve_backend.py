import contextlib
import pytest
import os

from humanlayer import ApprovalMethod, HumanLayer, CloudHumanLayerBackend


# context manager to set + unset an env var
@contextlib.contextmanager
def env_var(var_name: str, var_value: str) -> None:
    prev_value = os.environ.get(var_name)
    os.environ[var_name] = var_value
    try:
        yield
    finally:
        if prev_value is not None:
            os.environ[var_name] = prev_value
        else:
            del os.environ[var_name]


def test_no_args() -> None:
    hl = HumanLayer()
    assert hl.approval_method == ApprovalMethod.CLI


def test_cli_hardcoded() -> None:
    hl = HumanLayer(approval_method=ApprovalMethod.CLI)
    assert hl.approval_method == ApprovalMethod.CLI


def test_env_invalid_breaks() -> None:
    with env_var("HUMANLAYER_APPROVAL_METHOD", "bar"):
        with pytest.raises(ValueError) as e:
            HumanLayer()
        assert str(e.value) == "'bar' is not a valid ApprovalMethod"


def test_env_cli() -> None:
    with env_var("HUMANLAYER_APPROVAL_METHOD", "cli"):
        hl = HumanLayer()
        assert hl.approval_method == ApprovalMethod.CLI


def test_cloud() -> None:
    with pytest.raises(Exception) as e:
        HumanLayer()
    assert "HUMANLAYER_API_KEY is required for cloud approvals" in str(e.value)

def test_cloud_endpoint_kwarg_default() -> None:
    hl = HumanLayer(api_key="foo")
    assert hl.approval_method == ApprovalMethod.CLOUD
    assert hl.backend is not None
    assert isinstance(hl.backend, CloudHumanLayerBackend)
    assert hl.backend.connection.api_key == "foo"
    assert hl.backend.connection.api_base_url == "https://api.humanlayer.dev/humanlayer/v1"

def test_cloud_endpoint_kwarg() -> None:
    hl = HumanLayer(api_key="foo", api_base_url="fake")
    assert hl.approval_method == ApprovalMethod.CLOUD
    assert hl.backend is not None
    assert isinstance(hl.backend, CloudHumanLayerBackend)
    assert hl.backend.connection.api_base_url == "fake"

def test_env_var_cloud():
    with env_var("HUMANLAYER_API_KEY", "foo"):
        hl = HumanLayer()
        assert hl.approval_method == ApprovalMethod.CLOUD
        assert hl.backend is not None
        assert isinstance(hl.backend, CloudHumanLayerBackend)
        assert hl.backend.connection.api_key == "foo"
        assert hl.backend.connection.api_base_url == "https://api.humanlayer.dev/humanlayer/v1"

