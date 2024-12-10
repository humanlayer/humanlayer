from unittest.mock import AsyncMock

import pytest

from humanlayer.core.async_approval import ApprovalMethod, AsyncHumanLayer
from humanlayer.core.async_cloud import AsyncCloudHumanLayerBackend
from humanlayer.core.async_protocol import AsyncAgentBackend
from humanlayer.testing import env_var


def test_no_args() -> None:
    """Test default behavior with no API key"""
    with env_var("HUMANLAYER_API_KEY", ""):
        hl = AsyncHumanLayer()
        assert hl.approval_method == ApprovalMethod.CLI


def test_cli_hardcoded() -> None:
    """Test explicit CLI mode"""
    hl = AsyncHumanLayer(approval_method=ApprovalMethod.CLI)
    assert hl.approval_method == ApprovalMethod.CLI


def test_env_invalid_breaks() -> None:
    """Test invalid approval method"""
    with env_var("HUMANLAYER_APPROVAL_METHOD", "bar"):
        with pytest.raises(ValueError) as e:
            AsyncHumanLayer()
        assert "'bar' is not a valid ApprovalMethod" in str(e.value)


def test_env_cli() -> None:
    """Test CLI mode from environment variable"""
    with env_var("HUMANLAYER_APPROVAL_METHOD", "cli"):
        hl = AsyncHumanLayer()
        assert hl.approval_method == ApprovalMethod.CLI


def test_env_backend() -> None:
    """Test backend mode from environment variable"""
    with env_var("HUMANLAYER_APPROVAL_METHOD", "backend"):
        hl = AsyncHumanLayer(backend=AsyncMock(spec=AsyncAgentBackend))
        assert hl.approval_method == ApprovalMethod.BACKEND


def test_cloud() -> None:
    """Test cloud constructor without API key"""
    with env_var("HUMANLAYER_API_KEY", ""):
        with pytest.raises(Exception) as e:
            AsyncHumanLayer.cloud()
        assert "HUMANLAYER_API_KEY is required for cloud approvals" in str(e.value)


def test_cloud_endpoint_kwarg_default() -> None:
    """Test cloud mode with default endpoint"""
    hl = AsyncHumanLayer(api_key="foo")
    assert hl.approval_method == ApprovalMethod.BACKEND
    assert hl.backend is not None
    assert isinstance(hl.backend, AsyncCloudHumanLayerBackend)
    assert hl.backend.connection.api_key == "foo"
    assert hl.backend.connection.api_base_url == "https://api.humanlayer.dev/humanlayer/v1"


def test_cloud_endpoint_kwarg() -> None:
    """Test cloud mode with custom endpoint"""
    hl = AsyncHumanLayer(api_key="foo", api_base_url="fake")
    assert hl.approval_method == ApprovalMethod.BACKEND
    assert hl.backend is not None
    assert isinstance(hl.backend, AsyncCloudHumanLayerBackend)
    assert hl.backend.connection.api_base_url == "fake"


def test_env_var_cloud() -> None:
    """Test cloud mode from environment variable"""
    with env_var("HUMANLAYER_API_KEY", "foo"):
        hl = AsyncHumanLayer()
        assert hl.approval_method == ApprovalMethod.BACKEND
        assert hl.backend is not None
        assert isinstance(hl.backend, AsyncCloudHumanLayerBackend)
        assert hl.backend.connection.api_key == "foo"
        assert hl.backend.connection.api_base_url == "https://api.humanlayer.dev/humanlayer/v1"


def test_resolve_backend_requires_backend_for_cloud() -> None:
    """Test that backend is required for cloud mode"""
    with pytest.raises(ValueError) as exc:
        AsyncHumanLayer(approval_method=ApprovalMethod.BACKEND)
    assert "backend is required for non-cli approvals" in str(exc.value)


def test_cli_constructor() -> None:
    """Test the cli() constructor method"""
    hl = AsyncHumanLayer.cli()
    assert hl.approval_method == ApprovalMethod.CLI
    assert hl.backend is None
