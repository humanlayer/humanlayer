from typing import Generic

from humanlayer.core.models import (
    FunctionCall,
    FunctionCallStatus,
    HumanContact,
    HumanContactStatus,
)
from humanlayer.core.protocol import T_Call, T_Status


class AsyncAgentStore(Generic[T_Call, T_Status]):
    """
    Async agent-facing actions for HumanLayer
    """

    async def add(self, item: T_Call) -> T_Call:
        raise NotImplementedError()

    async def get(self, call_id: str) -> T_Call:
        raise NotImplementedError()

    async def respond(self, call_id: str, status: T_Status) -> T_Call:
        raise NotImplementedError()


class AsyncAgentBackend:
    def functions(self) -> AsyncAgentStore[FunctionCall, FunctionCallStatus]:
        raise NotImplementedError()

    def contacts(self) -> AsyncAgentStore[HumanContact, HumanContactStatus]:
        raise NotImplementedError()
