import json
import logging
import os
import secrets
import time
from enum import Enum
from functools import wraps
from typing import Any, Callable, TypeVar

import aiohttp
import requests
import socketio  # type: ignore
from pydantic import BaseModel

from humanlayer.core.types import (
    ContactChannel,
    FunctionCall,
    FunctionCallSpec,
    HumanContact,
    HumanContactSpec,
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
    CLOUD = "cloud"


class HumanLayerWrapper:
    def __init__(self, decorator: Callable) -> None:
        self.decorator = decorator

    def wrap(self, fn: Callable) -> Callable:
        return self.decorator(fn)

    def __call__(self, fn: Callable) -> Callable:
        return self.decorator(fn)


class HumanLayer(BaseModel):
    """🧱 HumanLayer"""

    model_config = {"arbitrary_types_allowed": True}

    api_key: str | None = None
    api_base_url: str | None = None
    ws_base_url: str | None = None
    run_id: str | None = None
    approval_method: ApprovalMethod | None
    sio: socketio.AsyncClient = socketio.AsyncClient()

    CLI: ApprovalMethod = ApprovalMethod.CLI
    CLOUD: ApprovalMethod = ApprovalMethod.CLOUD

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.api_key = self.api_key or os.getenv("HUMANLAYER_API_KEY")
        self.api_base_url = self.api_base_url or os.getenv(
            "HUMANLAYER_API_BASE", "https://api.functionlayer.com/functionlayer/v1"
        )
        self.ws_base_url = self.ws_base_url or os.getenv("FUNCTIONLAYER_WS_BASE")
        self.approval_method = self.approval_method or os.getenv(
            "FUNCTIONLAYER_APPROVAL_METHOD", ApprovalMethod.CLI
        )
        self.run_id = self.run_id or os.getenv("FUNCTIONLAYER_RUN_ID", genid("run"))
        if not self.api_key and self.approval_method is not ApprovalMethod.CLI:
            exception = f"HUMANLAYER_API_KEY is required for approval_method {self.approval_method}"
            raise ValueError(exception)

    def __str__(self):
        return "HumanLayer()"

    def require_approval(
        self, contact_channel: ContactChannel | None = None
    ) -> HumanLayerWrapper:
        def decorator(fn):
            if self.approval_method is ApprovalMethod.CLI:
                return self._approve_cli(fn)
            elif self.approval_method is ApprovalMethod.CLOUD:
                return self._approve_webapp(fn, contact_channel)
            else:
                exception = f"Approval method {self.approval_method} not implemented"
                raise NotImplementedError(exception)

        return HumanLayerWrapper(decorator)

    def _approve_cli(self, fn: Callable[[T], R]) -> Callable[[T], R]:
        @wraps(fn)
        def wrapper(*args, **kwargs) -> R:
            feedback = input(
                f"allow {fn.__name__} with args {args} and kwargs {kwargs} (Y/n): "
            )
            if feedback.lower() not in {None, "", "y", "Y"}:
                return str(
                    UserDeniedError(
                        f"User denied {fn.__name__} with feedback: {feedback}"
                    )
                )
            try:
                return fn(*args, **kwargs)
            except Exception as e:
                return f"Error running {fn.__name__}: {e}"

        return wrapper

    def _approve_webapp(
        self, fn: Callable[[T], R], contact_channel: ContactChannel | None = None
    ) -> Callable[[T], R]:
        @wraps(fn)
        def wrapper(*args, **kwargs) -> R:
            call_id = genid("call")
            try:
                url = f"{self.api_base_url}/function_calls"
                resp = requests.post(
                    url,
                    json=FunctionCall(
                        run_id=self.run_id,
                        call_id=call_id,
                        spec=FunctionCallSpec(
                            fn=fn.__name__,
                            kwargs=kwargs,
                            channel=contact_channel,
                        ),
                    ).model_dump(),
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    timeout=10,
                )
                logger.debug("response %s", json.dumps(resp.json(), indent=2))
                if resp.status_code != 200:
                    return f"Error requesting approval: {resp.json()}"

                # todo let's do a more async-y websocket soon
                while True:
                    time.sleep(3)
                    resp = requests.get(
                        f"{self.api_base_url}/function_calls/{call_id}",
                        headers={"Authorization": f"Bearer {self.api_key}"},
                        timeout=10,
                    )
                    function_call = resp.json()
                    logger.debug(
                        "response %d %s",
                        resp.status_code,
                        json.dumps(function_call, indent=2),
                    )
                    if function_call.get("status", {}).get("approved") is None:
                        continue

                    if function_call.get("status", {}).get("approved", False):
                        return fn(*args, **kwargs)
                    else:
                        if (
                            contact_channel
                            and contact_channel.slack
                            and contact_channel.slack.context_about_channel_or_user
                        ):
                            return f"User in {contact_channel.slack.context_about_channel_or_user} denied {fn.__name__} with message: {function_call.get('status', {}).get('comment')}"
                        else:
                            return f"User denied {fn.__name__} with message: {function_call.get('status', {}).get('comment')}"
            except Exception as e:
                logger.exception("Error requesting approval")
                return f"Error running {fn.__name__}: {e}"

        return wrapper

    def _async_approve_cli(self, fn: Callable[[T], R]) -> Callable[[T], R]:
        @wraps(fn)
        async def wrapper(*args, **kwargs) -> R:
            approved = input(
                f"allow {fn.__name__} with args {args} and kwargs {kwargs} (Y/n): "
            )
            if approved.lower() not in {None, "", "y"}:
                raise ValueError(f"User denied {fn.__name__}")
            try:
                return fn(*args, **kwargs)
            except Exception as e:
                return f"Error running {fn.__name__}: {e}"

        return wrapper

    async def _request(self, *args, **kwargs) -> Any:
        async with aiohttp.ClientSession() as session, session.request(
            *args, **kwargs
        ) as response:
            return await response.json()

    def human_as_tool(
        self, contact_channel: ContactChannel | None = None
    ) -> Callable[[str], str]:
        def contact_human(question: str) -> str:
            """Ask a human a question"""
            call_id = genid("human_call")

            resp = requests.post(
                f"{self.api_base_url}/contact_requests",
                json=HumanContact(
                    run_id=self.run_id,
                    call_id=call_id,
                    spec=HumanContactSpec(
                        msg=question,
                        channel=contact_channel,
                    ),
                ).model_dump(),
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=10,
            )
            logger.debug(
                "response %d %s", resp.status_code, json.dumps(resp.text, indent=2)
            )
            if resp.status_code != 200:
                raise ValueError(f"Error requesting approval: {resp.json()}")

            # todo let's do a more async-y websocket soon
            while True:
                time.sleep(3)
                resp = requests.get(
                    f"{self.api_base_url}/contact_requests/{call_id}",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    timeout=10,
                )
                human_contact = HumanContact.model_validate(resp.json())
                logger.debug(
                    "response %d %s",
                    resp.status_code,
                    json.dumps(resp.json(), indent=2),
                )
                if human_contact.status is None:
                    continue

                return human_contact.status.response

        if contact_channel is None:
            return contact_human

        if contact_channel.slack:
            contact_human.__doc__ = "Contact a human via slack and wait for a response"
            contact_human.__name__ = "contact_human_in_slack"
            if contact_channel.slack.context_about_channel_or_user:
                contact_human.__doc__ += (
                    f" in {contact_channel.slack.context_about_channel_or_user}"
                )
                contact_human.__name__ = f"contact_human_in_slack_in_{contact_channel.slack.context_about_channel_or_user.replace(' ', '_')}"

            contact_human._context = contact_channel.slack.context_about_channel_or_user

        return contact_human
