import logging
import secrets
from enum import Enum
from typing import Any, Callable, TypeVar

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
