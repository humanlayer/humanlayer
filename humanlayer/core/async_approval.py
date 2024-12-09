import asyncio
import inspect
import json
import logging
import os
import secrets
from enum import Enum
from functools import wraps
from typing import Any, Awaitable, Callable, TypeVar, Union

from pydantic import BaseModel
from slugify import slugify

from humanlayer.core.async_cloud import (
    AsyncCloudHumanLayerBackend,
    AsyncHumanLayerCloudConnection,
)
from humanlayer.core.async_protocol import AsyncAgentBackend
from humanlayer.core.models import (
    ContactChannel,
    FunctionCall,
    FunctionCallSpec,
    ResponseOption,
)
from humanlayer.core.protocol import (
    HumanLayerException,
)

# Define TypeVars for input and output types
T = TypeVar("T")
R = TypeVar("R")

# Define type aliases for async functions
AsyncCallable = Callable[..., Awaitable[Union[R, str]]]

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
        decorator: Callable[[Any], Awaitable[AsyncCallable]],
    ) -> None:
        self.decorator = decorator

    async def wrap(self, fn: Callable) -> AsyncCallable:
        return await self.decorator(fn)

    async def __call__(self, fn: Callable) -> AsyncCallable:
        return await self.decorator(fn)


class AsyncHumanLayer(BaseModel):
    """Async version of HumanLayer"""

    model_config = {"arbitrary_types_allowed": True}

    run_id: str | None = None
    approval_method: ApprovalMethod | None = None
    backend: AsyncAgentBackend | None = None
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
                self.backend = self.backend or AsyncCloudHumanLayerBackend(
                    connection=AsyncHumanLayerCloudConnection(
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
        connection: AsyncHumanLayerCloudConnection | None = None,
        api_key: str | None = None,
        api_base_url: str | None = None,
        **kwargs,
    ) -> "AsyncHumanLayer":
        if not connection:
            connection = AsyncHumanLayerCloudConnection(
                api_key=api_key,
                api_base_url=api_base_url,
            )
        return cls(
            approval_method=ApprovalMethod.BACKEND,
            backend=AsyncCloudHumanLayerBackend(
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

    async def require_approval(
        self,
        contact_channel: ContactChannel | None = None,
        reject_options: list[ResponseOption] | None = None,
    ) -> AsyncHumanLayerWrapper:
        # if any of the reject-options have the same name, raise an error
        if reject_options:
            names = [opt.name for opt in reject_options]
            if len(names) != len(set(names)):
                raise HumanLayerException("reject_options must have unique names")

        async def decorator(fn):  # type: ignore
            if self.approval_method is ApprovalMethod.CLI:
                return await self._approve_cli(fn)

            return await self._approve_with_backend(
                fn=fn,
                contact_channel=contact_channel,
                reject_options=reject_options,
            )

        return AsyncHumanLayerWrapper(decorator)

    async def _approve_cli(self, fn: Callable[[T], R]) -> AsyncCallable:
        """
        Async CLI approval method that wraps a function with CLI-based approval flow.

        Args:
            fn: Either a sync or async function to be wrapped

        Returns:
            AsyncCallable: An async function that handles the approval flow before executing fn.
            On approval, returns the original function's return type R.
            On rejection/error, returns a string message.
        """

        @wraps(fn)
        async def wrapper(*args: Any, **kwargs: Any) -> Union[R, str]:
            print(
                f"""Agent {self.run_id} wants to call

{fn.__name__}({json.dumps(kwargs, indent=2)})

{"" if not args else " with args: " + str(args)}"""
            )
            # Note: input() is blocking, but that's OK for CLI interaction
            feedback = input("Hit ENTER to proceed, or provide feedback to the agent to deny: \n\n")
            if feedback not in {None, ""}:
                return str(UserDeniedError(f"User denied {fn.__name__} with feedback: {feedback}"))
            try:
                if inspect.iscoroutinefunction(fn):
                    result: R = await fn(*args, **kwargs)
                    return result
                return fn(*args, **kwargs)
            except Exception as e:
                return f"Error running {fn.__name__}: {e}"

        return wrapper

    async def _approve_with_backend(
        self,
        fn: Callable[[T], R],
        contact_channel: ContactChannel | None = None,
        reject_options: list[ResponseOption] | None = None,
    ) -> AsyncCallable:
        """
        Async backend approval method that wraps a function with cloud-based approval flow.

        Args:
            fn: Either a sync or async function to be wrapped
            contact_channel: Optional channel for approval notifications
            reject_options: Optional list of predefined rejection responses

        Returns:
            AsyncCallable: An async function that handles the approval flow before executing fn.
            On approval, returns the original function's return type R.
            On rejection/error, returns a string message.
        """
        contact_channel = contact_channel or self.contact_channel

        @wraps(fn)
        async def wrapper(*args: Any, **kwargs: Any) -> Union[R, str]:
            assert self.backend is not None

            if self.griptape_munging and args and not kwargs:  # noqa: SIM108
                # griptape passes args[1] as the input kwargs
                display_kwargs = args[1]
            else:
                display_kwargs = kwargs

            try:
                function_call = await self.fetch_approval(
                    FunctionCallSpec(
                        fn=fn.__name__,
                        kwargs=display_kwargs,
                        channel=contact_channel,
                        reject_options=reject_options,
                    ),
                )

                channel = function_call.call.spec.channel or contact_channel
                response = function_call.as_completed()

                if response.approved is True:
                    if self.verbose:
                        print(f"HumanLayer: human approved {fn.__name__}")
                    if inspect.iscoroutinefunction(fn):
                        result: R = await fn(*args, **kwargs)
                        return result
                    return fn(*args, **kwargs)
                else:
                    if self.verbose:
                        print(f"HumanLayer: human denied {fn.__name__} with message: {response.comment}")
                    if channel and channel.slack and channel.slack.context_about_channel_or_user:
                        return f"User in {channel.slack.context_about_channel_or_user} denied {fn.__name__} with message: {response.comment}"
                    else:
                        return f"User denied {fn.__name__} with message: {response.comment}"
            except Exception as e:
                return f"Error fetching approval for {fn.__name__}: {e}"

        return wrapper

    async def fetch_approval(
        self,
        spec: FunctionCallSpec,
    ) -> FunctionCall.Completed:
        """
        fetch approval for a function call asynchronously
        """
        assert self.backend is not None

        # if no channel is specified, use this HumanLayer instance's contact channel
        if spec.channel is None:
            spec.channel = self.contact_channel

        call = await self.create_function_call(spec)

        # todo lets do a more async-y websocket soon
        if self.verbose and self.approval_method == ApprovalMethod.BACKEND:
            print(f"HumanLayer: waiting for approval for {spec.fn} via humanlayer cloud")

        while True:
            await self.sleep(3)
            call = await self.get_function_call(call.call_id)
            if call.status is None:
                continue
            if call.status.approved is None:
                continue
            return FunctionCall.Completed(call=call)

    async def create_function_call(
        self,
        spec: FunctionCallSpec,
        call_id: str | None = None,
    ) -> FunctionCall:
        """Create a function call asynchronously"""
        assert self.backend is not None, "create requires a backend, did you forget your HUMANLAYER_API_KEY?"
        call_id = call_id or self.genid("call")
        call = FunctionCall(
            run_id=self.run_id,  # type: ignore
            call_id=call_id,
            spec=spec,
        )
        return await self.backend.functions().add(call)

    async def get_function_call(
        self,
        call_id: str,
    ) -> FunctionCall:
        """Get a function call asynchronously"""
        assert self.backend is not None, "get requires a backend, did you forget your HUMANLAYER_API_KEY?"
        return await self.backend.functions().get(call_id)
