import asyncio
import inspect
import logging
import os
import re
from functools import wraps
from typing import Any, Awaitable, Callable, Union

from pydantic import BaseModel
from slugify import slugify

from humanlayer.core.approval import R, T, genid, remove_parameter_from_signature
from humanlayer.core.async_cloud import (
    AsyncCloudHumanLayerBackend,
    AsyncHumanLayerCloudConnection,
)
from humanlayer.core.async_protocol import AsyncAgentBackend
from humanlayer.core.models import (
    ContactChannel,
    FunctionCall,
    FunctionCallSpec,
    FunctionCallStatus,
    HumanContact,
    HumanContactSpec,
    HumanContactStatus,
    ResponseOption,
)
from humanlayer.core.protocol import (
    HumanLayerException,
)

# Define type aliases for async functions
AsyncCallable = Callable[..., Awaitable[Union[R, str]]]

logger = logging.getLogger(__name__)


class AsyncHumanLayerWrapper:
    def __init__(
        self,
        decorator: Callable[[Any], Awaitable[AsyncCallable]],
    ) -> None:
        self.decorator = decorator

    def __call__(self, fn: Callable) -> AsyncCallable:
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            decorated_fn = await self.decorator(fn)
            return await decorated_fn(*args, **kwargs)

        return wrapper

    wrap = __call__


class AsyncHumanLayer(BaseModel):
    """Async version of HumanLayer"""

    model_config = {"arbitrary_types_allowed": True}

    run_id: str | None = None
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
        has_credentials = self.backend is not None or self.api_key or os.getenv("HUMANLAYER_API_KEY")

        if not has_credentials:
            raise HumanLayerException(
                "No HUMANLAYER_API_KEY found, and CLI approval method is not supported for AsyncHumanLayer"
                " - try setting an API key or using the sync HumanLayer() instead"
            )

        if self.backend is None:
            self.backend = AsyncCloudHumanLayerBackend(
                connection=AsyncHumanLayerCloudConnection(
                    api_key=self.api_key,
                    api_base_url=self.api_base_url,
                )
            )

        agent = "agent"
        self.run_id = self.run_id or os.getenv(
            "HUMANLAYER_RUN_ID",
            self.genid(f"{slugify(self.agent_name or agent)}"),
        )

    def require_approval(
        self,
        contact_channel: ContactChannel | None = None,
        reject_options: list[ResponseOption] | None = None,
    ) -> AsyncHumanLayerWrapper:
        # if any of the reject-options have the same names, raise an error
        if reject_options:
            names = [opt.name for opt in reject_options]
            if len(names) != len(set(names)):
                raise HumanLayerException("reject_options must have unique names")

        async def decorator(fn):  # type: ignore
            return self._approve_with_backend(
                fn=fn,
                contact_channel=contact_channel,
                reject_options=reject_options,
            )

        return AsyncHumanLayerWrapper(decorator)

    def _approve_with_backend(
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

    def human_as_tool(
        self,
        contact_channel: ContactChannel | None = None,
        response_options: list[ResponseOption] | None = None,
    ) -> Callable[[str], Awaitable[str]]:
        if response_options:
            names = [opt.name for opt in response_options]
            if len(names) != len(set(names)):
                raise HumanLayerException("response_options must have unique names")

        return self._human_as_tool(contact_channel, response_options)

    def _human_as_tool_cli(
        self,
    ) -> Callable[[str], Awaitable[str]]:
        async def contact_human(
            question: str,
        ) -> str:
            """ask a human a question on the CLI"""
            print(
                f"""Agent {self.run_id} requests assistance:

{question}
"""
            )
            # Note: input() is blocking, but that's OK for CLI interaction
            feedback = input("Please enter a response: \n\n")
            return feedback

        return contact_human

    def _human_as_tool(
        self,
        contact_channel: ContactChannel | None = None,
        response_options: list[ResponseOption] | None = None,
    ) -> Callable[[str], Awaitable[str]]:
        contact_channel = contact_channel or self.contact_channel

        async def contact_human(
            message: str,
            subject: str | None = None,
        ) -> str:
            """contact a human"""
            assert self.backend is not None

            # we actually want the contact channel subject
            # to overrides the model-generated subject, since
            # it has detail about the thread we're on and how
            # to keep the reply in-thread
            if (
                contact_channel
                and contact_channel.email
                and contact_channel.email.experimental_subject_line is not None
            ):
                subject = contact_channel.email.experimental_subject_line

            resp = await self.fetch_human_response(
                HumanContactSpec(
                    msg=message,
                    subject=subject,
                    channel=contact_channel,
                    response_options=response_options,
                ),
            )

            return resp.as_completed()

        if contact_channel is None:
            return contact_human

        if contact_channel.slack:
            contact_human.__doc__ = "Contact a human via slack and wait for a response"
            contact_human.__name__ = "contact_human_in_slack"
            if contact_channel.slack.context_about_channel_or_user:
                contact_human.__doc__ += f" in {contact_channel.slack.context_about_channel_or_user}"
                fn_ctx = contact_channel.slack.context_about_channel_or_user.replace(" ", "_")
                contact_human.__name__ = f"contact_human_in_slack_in_{fn_ctx}"

        if contact_channel.email:
            contact_human.__doc__ = "Contact a human via email and wait for a response"
            contact_human.__name__ = "contact_human_via_email"
            contact_human.__annotations__ = {"subject": str, "message": str, "return": str}
            if contact_channel.email.address:
                fn_ctx = re.sub(r"[^a-zA-Z0-9]+", "_", contact_channel.email.address)
                fn_ctx = re.sub(r"_+", "_", fn_ctx).strip("_")
                contact_human.__name__ = f"contact_human_via_email_{fn_ctx}"
        else:
            contact_human.__annotations__ = {"message": str, "return": str}
            contact_human = remove_parameter_from_signature(contact_human, "subject")

        return contact_human

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
        if self.verbose:
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

        if not spec.channel:
            spec.channel = self.contact_channel

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

    async def respond_to_function_call(
        self,
        call_id: str,
        status: FunctionCallStatus,
    ) -> FunctionCall:
        """Respond to a function call asynchronously"""
        assert self.backend is not None, "respond requires a backend, did you forget your HUMANLAYER_API_KEY?"
        return await self.backend.functions().respond(call_id, status)

    async def create_human_contact(
        self,
        spec: HumanContactSpec,
        call_id: str | None = None,
    ) -> HumanContact:
        """Create a human contact request asynchronously"""
        assert self.backend is not None, "create requires a backend, did you forget your HUMANLAYER_API_KEY?"

        if not spec.channel:
            spec.channel = self.contact_channel

        call_id = call_id or self.genid("call")
        contact = HumanContact(
            run_id=self.run_id,  # type: ignore
            call_id=call_id,
            spec=spec,
        )
        return await self.backend.contacts().add(contact)

    async def get_human_contact(
        self,
        call_id: str,
    ) -> HumanContact:
        """Get a human contact request asynchronously"""
        assert (
            self.backend is not None
        ), "get human response requires a backend, did you forget your HUMANLAYER_API_KEY?"
        return await self.backend.contacts().get(call_id)

    async def fetch_human_response(
        self,
        spec: HumanContactSpec,
    ) -> HumanContact.Completed:
        """
        fetch a human response asynchronously
        """
        assert (
            self.backend is not None
        ), "fetch human response requires a backend, did you forget your HUMANLAYER_API_KEY?"

        # if no channel is specified, use this HumanLayer instance's contact channel (if any)
        if spec.channel is None:
            spec.channel = self.contact_channel

        contact = await self.create_human_contact(spec)

        if self.verbose:
            print(f"HumanLayer: waiting for human response for {spec.msg}")

        while True:
            await self.sleep(3)
            contact = await self.get_human_contact(contact.call_id)
            if contact.status is None:
                continue
            if contact.status.response is None:
                continue
            return HumanContact.Completed(contact=contact)

    async def respond_to_human_contact(
        self,
        call_id: str,
        status: HumanContactStatus,
    ) -> HumanContact:
        """Respond to a human contact request asynchronously"""
        assert self.backend is not None, "respond requires a backend, did you forget your HUMANLAYER_API_KEY?"
        return await self.backend.contacts().respond(call_id, status)
