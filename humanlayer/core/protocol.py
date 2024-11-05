from typing import Generic, Iterable, TypeVar

import requests

from humanlayer.core.models import (
    FunctionCall,
    FunctionCallStatus,
    HumanContact,
    HumanContactStatus,
)

T_Call = TypeVar("T_Call", FunctionCall, HumanContact)
T_Status = TypeVar("T_Status", FunctionCallStatus, HumanContactStatus, covariant=True)


class AgentStore(Generic[T_Call, T_Status]):
    """
    Agent-facing actions for HumanLayer, allows for creating and checking the status of
    """

    # should this return the T_Call with any updated status?
    def add(self, item: T_Call) -> T_Call:
        raise NotImplementedError()

    def get(self, call_id: str) -> T_Call:
        raise NotImplementedError()

    def respond(self, call_id: str, status: T_Status) -> T_Call:
        raise NotImplementedError()


class AdminStore(Generic[T_Call, T_Status]):
    """
    Admin-facing actions for HumanLayer, allows for
    listing and updating the status of requests
    """

    # should this return the T_Call with any updated status?
    def respond(self, call_id: str, status: T_Status) -> T_Call:
        raise NotImplementedError()

    def list(self, call_id: str) -> Iterable[T_Call]:
        raise NotImplementedError()


# this is probably cleaner as a Protocol but
# Mock libs are bein' weird rn
class AgentBackend:
    def functions(self) -> AgentStore[FunctionCall, FunctionCallStatus]:
        raise NotImplementedError()

    def contacts(self) -> AgentStore[HumanContact, HumanContactStatus]:
        raise NotImplementedError()


class AdminBackend:
    def functions(self) -> AdminStore[FunctionCall, FunctionCallStatus]:
        raise NotImplementedError()

    def contacts(self) -> AdminStore[HumanContact, HumanContactStatus]:
        raise NotImplementedError()


class HumanLayerException(Exception):
    @staticmethod
    def raise_for_status(resp: requests.Response) -> None:
        try:
            resp.raise_for_status()
        except requests.HTTPError as e:
            raise HumanLayerException(f"{e}: {resp.text}") from e
