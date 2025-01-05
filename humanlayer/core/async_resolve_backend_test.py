import pytest

from humanlayer.core.async_approval import AsyncHumanLayer
from humanlayer.core.async_cloud import AsyncCloudHumanLayerBackend
from humanlayer.core.protocol import HumanLayerException
from humanlayer.testing import env_var


def test_no_args() -> None:
    """Test default behavior with no API key"""
    with env_var("HUMANLAYER_API_KEY", ""):
        with pytest.raises(HumanLayerException) as e:
            AsyncHumanLayer()
        assert "No HUMANLAYER_API_KEY found, and CLI approval method is not supported for AsyncHumanLayer" in str(
            e.value
        )


def test_cloud_endpoint_kwarg_default() -> None:
    """Test cloud mode with default endpoint"""
    hl = AsyncHumanLayer(api_key="foo")
    assert hl.backend is not None
    assert isinstance(hl.backend, AsyncCloudHumanLayerBackend)
    assert hl.backend.connection.api_key == "foo"
    assert hl.backend.connection.api_base_url == "https://api.humanlayer.dev/humanlayer/v1"


def test_cloud_endpoint_kwarg() -> None:
    """Test cloud mode with custom endpoint"""
    hl = AsyncHumanLayer(api_key="foo", api_base_url="fake")
    assert hl.backend is not None
    assert isinstance(hl.backend, AsyncCloudHumanLayerBackend)
    assert hl.backend.connection.api_base_url == "fake"


def test_env_var_cloud() -> None:
    """Test cloud mode from environment variable"""
    with env_var("HUMANLAYER_API_KEY", "foo"):
        hl = AsyncHumanLayer()
        assert hl.backend is not None
        assert isinstance(hl.backend, AsyncCloudHumanLayerBackend)
        assert hl.backend.connection.api_key == "foo"
        assert hl.backend.connection.api_base_url == "https://api.humanlayer.dev/humanlayer/v1"


if __name__ == "__main__":
    pytest.main()
