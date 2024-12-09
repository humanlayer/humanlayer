import asyncio
import logging
import os
import secrets
from enum import Enum
from typing import Any, Callable, TypeVar

from pydantic import BaseModel
from slugify import slugify

from humanlayer.core.cloud import (
    CloudHumanLayerBackend,
    HumanLayerCloudConnection,
)
from humanlayer.core.models import (
    ContactChannel,
)
from humanlayer.core.protocol import (
    AgentBackend,
)

# Define TypeVars for input and output types
T = TypeVar("T")
R = TypeVar("R")

logger = logging.getLogger(__name__)


class HumanLayerError(Exception):
    pass


class UserDeniedError(HumanLayerError):
    pass


def genid(prefix: str) -> str:
    return f"{prefix}-{secrets.token_urlsafe(8)}"


class ApprovalMethod(Enum):
    CLI = "cli"
    BACKEND = "backend"


class AsyncHumanLayerWrapper:
    def __init__(
        self,
        decorator: Callable[[Any], Callable],
    ) -> None:
        self.decorator = decorator

    async def wrap(self, fn: Callable) -> Callable:
        return self.decorator(fn)

    async def __call__(self, fn: Callable) -> Callable:
        return self.decorator(fn)


class AsyncHumanLayer(BaseModel):
    """Async version of HumanLayer"""

    model_config = {"arbitrary_types_allowed": True}

    run_id: str | None = None
    approval_method: ApprovalMethod | None = None
    backend: AgentBackend | None = None
    agent_name: str | None = None
    genid: Callable[[str], str] = genid
    sleep: Callable[[int], Any] = asyncio.sleep
    contact_channel: ContactChannel | None = None
    verbose: bool = False

    # opt into some extra args/kwargs munging that is specific to how griptape
    # agents call tools
    griptape_munging: bool = False

    # convenience for forwarding down to Connection
    api_key: str | None = None
    api_base_url: str | None = None

    def model_post_init(self, __context: Any) -> None:
        # check env first
        if not self.approval_method and os.getenv("HUMANLAYER_APPROVAL_METHOD"):
            self.approval_method = ApprovalMethod(os.getenv("HUMANLAYER_APPROVAL_METHOD"))

        # then infer from API_KEY setting
        if not self.approval_method:
            if self.backend is not None or self.api_key or os.getenv("HUMANLAYER_API_KEY"):
                self.approval_method = ApprovalMethod.BACKEND
                self.backend = self.backend or CloudHumanLayerBackend(
                    connection=HumanLayerCloudConnection(
                        api_key=self.api_key,
                        api_base_url=self.api_base_url,
                    )
                )
            else:
                logger.info("No HUMANLAYER_API_KEY found, defaulting to CLI approval")
                self.approval_method = ApprovalMethod.CLI

        agent = "agent"
        self.run_id = self.run_id or os.getenv(
            "HUMANLAYER_RUN_ID",
            self.genid(f"{slugify(self.agent_name or agent)}"),
        )

        if self.approval_method == ApprovalMethod.BACKEND and not self.backend:
            raise ValueError("backend is required for non-cli approvals")

    @classmethod
    def cloud(  # type: ignore
        cls,
        connection: HumanLayerCloudConnection | None = None,
        api_key: str | None = None,
        api_base_url: str | None = None,
        **kwargs,
    ) -> "AsyncHumanLayer":
        if not connection:
            connection = HumanLayerCloudConnection(
                api_key=api_key,
                api_base_url=api_base_url,
            )
        return cls(
            approval_method=ApprovalMethod.BACKEND,
            backend=CloudHumanLayerBackend(
                connection=connection,
            ),
            **kwargs,
        )

    @classmethod
    def cli(  # type: ignore
        cls,
        **kwargs,
    ) -> "AsyncHumanLayer":
        return cls(
            approval_method=ApprovalMethod.CLI,
            **kwargs,
        )
