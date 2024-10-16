import json
import logging
import os
import secrets
import time
from enum import Enum
from functools import wraps
from typing import Any, Callable, TypeVar

from pydantic import BaseModel
from slugify import slugify

from humanlayer.core.cloud import (
    CloudHumanLayerBackend,
    HumanLayerCloudConnection,
)
from humanlayer.core.models import (
    ContactChannel,
    FunctionCall,
    FunctionCallSpec,
    HumanContact,
    HumanContactSpec,
    ResponseOption,
)
from humanlayer.core.protocol import (
    AgentBackend,
    HumanLayerException,
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


class HumanLayerWrapper:
    def __init__(
        self,
        decorator: Callable[[Any], Callable],
    ) -> None:
        self.decorator = decorator

    def wrap(self, fn: Callable) -> Callable:
        return self.decorator(fn)

    def __call__(self, fn: Callable) -> Callable:
        return self.decorator(fn)


class HumanLayer(BaseModel):
    """HumanLayer"""

    model_config = {"arbitrary_types_allowed": True}

    run_id: str | None = None
    approval_method: ApprovalMethod | None = None
    backend: AgentBackend | None = None
    agent_name: str | None = None
    genid: Callable[[str], str] = genid
    sleep: Callable[[int], None] = time.sleep
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

    def __str__(self) -> str:
        return "HumanLayer()"

    @classmethod
    def cloud(  # type: ignore
        cls,
        connection: HumanLayerCloudConnection | None = None,
        api_key: str | None = None,
        api_base_url: str | None = None,
        **kwargs,
    ) -> "HumanLayer":
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
    ) -> "HumanLayer":
        return cls(
            approval_method=ApprovalMethod.CLI,
            **kwargs,
        )

    def require_approval(
        self,
        contact_channel: ContactChannel | None = None,
        reject_options: list[ResponseOption] | None = None,
    ) -> HumanLayerWrapper:
        # if any of the reject-options have the same name, raise an error
        if reject_options:
            names = [opt.name for opt in reject_options]
            if len(names) != len(set(names)):
                raise HumanLayerException("reject_options must have unique names")

        def decorator(fn):  # type: ignore
            if self.approval_method is ApprovalMethod.CLI:
                return self._approve_cli(fn)

            return self._approve_with_backend(
                fn=fn,
                contact_channel=contact_channel,
                reject_options=reject_options,
            )

        return HumanLayerWrapper(decorator)

    def _approve_cli(self, fn: Callable[[T], R]) -> Callable[[T], R | str]:
        """
        NOTE we convert a callable[[T], R] to a Callable [[T], R | str]

        this is safe to do for most LLM use cases. It will blow up
        a normal function.

        If we can guarantee the function calling framework
        is properly handling exceptions, then we can
        just raise and let the framework handle the stringification
        of what went wrong.

        Because some frameworks dont handle exceptions well, were stuck with the hack for now
        """

        @wraps(fn)
        def wrapper(*args, **kwargs) -> R | str:  # type: ignore
            print(
                f"""Agent {self.run_id} wants to call

{fn.__name__}({json.dumps(kwargs, indent=2)})

{"" if not args else " with args: " + str(args)}"""
            )
            feedback = input("Hit ENTER to proceed, or provide feedback to the agent to deny: \n\n")
            if feedback not in {
                None,
                "",
            }:
                return str(UserDeniedError(f"User denied {fn.__name__} with feedback: {feedback}"))
            try:
                return fn(*args, **kwargs)
            except Exception as e:
                return f"Error running {fn.__name__}: {e}"

        return wrapper

    def _approve_with_backend(
        self,
        fn: Callable[[T], R],
        contact_channel: ContactChannel | None = None,
        reject_options: list[ResponseOption] | None = None,
    ) -> Callable[[T], R | str]:
        """
        NOTE we convert a callable[[T], R] to a Callable [[T], R | str]

        this is safe to do for most LLM use cases. It will blow up
        a normal function.

        If we can guarantee the function calling framework
        is properly handling exceptions, then we can
        just raise and let the framework handle the stringification
        of what went wrong.

        Because some frameworks dont handle exceptions well, were stuck with the hack for now
        """
        contact_channel = contact_channel or self.contact_channel

        @wraps(fn)
        def wrapper(*args, **kwargs) -> R | str:  # type: ignore
            assert self.backend is not None
            call_id = self.genid("call")
            if self.griptape_munging and args and not kwargs:  # noqa: SIM108
                # griptape passes args[1] as the input kwargs
                display_kwargs = args[1]
            else:
                display_kwargs = kwargs

            try:
                call = FunctionCall(
                    run_id=self.run_id,  # type: ignore
                    call_id=call_id,
                    spec=FunctionCallSpec(
                        fn=fn.__name__,
                        kwargs=display_kwargs,
                        channel=contact_channel,
                        reject_options=reject_options,
                    ),
                )
                self.backend.functions().add(call)

                # todo lets do a more async-y websocket soon
                if self.verbose:
                    print(f"HumanLayer: waiting for approval for {fn.__name__}")
                while True:
                    self.sleep(3)
                    function_call: FunctionCall = self.backend.functions().get(call_id)
                    if function_call.status is None or function_call.status.approved is None:
                        continue

                    if function_call.status.approved:
                        if self.verbose:
                            print(f"HumanLayer: human approved {fn.__name__}")
                        return fn(*args, **kwargs)
                    else:
                        if self.verbose:
                            print(
                                f"HumanLayer: human denied {fn.__name__} with message: {function_call.status.comment}"
                            )
                        if (
                            function_call.spec.channel
                            and function_call.spec.channel.slack
                            and function_call.spec.channel.slack.context_about_channel_or_user
                        ):
                            return f"User in {function_call.spec.channel.slack.context_about_channel_or_user} denied {fn.__name__} with message: {function_call.status.comment}"
                        elif (
                            contact_channel
                            and contact_channel.slack
                            and contact_channel.slack.context_about_channel_or_user
                        ):
                            return f"User in {contact_channel.slack.context_about_channel_or_user} denied {fn.__name__} with message: {function_call.status.comment}"
                        else:
                            return f"User denied {fn.__name__} with message: {function_call.status.comment}"
            except Exception as e:
                logger.exception("Error requesting approval")
                # todo - raise vs. catch behavior - many tool clients handle+wrap errors
                # but not all of them :rolling_eyes:
                return f"Error running {fn.__name__}: {e}"

        return wrapper

    def human_as_tool(
        self,
        contact_channel: ContactChannel | None = None,
        response_options: list[ResponseOption] | None = None,
    ) -> Callable[[str], str]:
        if response_options:
            names = [opt.name for opt in response_options]
            if len(names) != len(set(names)):
                raise HumanLayerException("response_options must have unique names")

        if self.approval_method is ApprovalMethod.CLI:
            return self._human_as_tool_cli()

        return self._human_as_tool(contact_channel, response_options)

    def _human_as_tool_cli(
        self,
    ) -> Callable[[str], str]:
        def contact_human(
            question: str,
        ) -> str:
            """ask a human a question on the CLI"""
            print(
                f"""Agent {self.run_id} requests assistance:

{question}
"""
            )
            feedback = input("Please enter a response: \n\n")
            return feedback

        return contact_human

    def _human_as_tool(
        self,
        contact_channel: ContactChannel | None = None,
        response_options: list[ResponseOption] | None = None,
    ) -> Callable[[str], str]:
        contact_channel = contact_channel or self.contact_channel

        def contact_human(
            message: str,
        ) -> str:
            """contact a human"""
            assert self.backend is not None
            call_id = self.genid("human_call")

            contact = HumanContact(
                run_id=self.run_id,  # type: ignore
                call_id=call_id,
                spec=HumanContactSpec(
                    msg=message,
                    channel=contact_channel,
                    response_options=response_options,
                ),
            )
            self.backend.contacts().add(contact)

            # todo lets do a more async-y websocket soon
            if self.verbose:
                print("HumanLayer: waiting for human response")
            while True:
                self.sleep(3)
                human_contact = self.backend.contacts().get(call_id)
                if human_contact.status is None:
                    continue

                if human_contact.status.response is not None:
                    if self.verbose:
                        print(f"HumanLayer: human responded with: {human_contact.status.response}")
                    return human_contact.status.response

        if contact_channel is None:
            return contact_human

        if contact_channel.slack:
            contact_human.__doc__ = "Contact a human via slack and wait for a response"
            contact_human.__name__ = "contact_human_in_slack"
            if contact_channel.slack.context_about_channel_or_user:
                contact_human.__doc__ += f" in {contact_channel.slack.context_about_channel_or_user}"
                fn_ctx = contact_channel.slack.context_about_channel_or_user.replace(" ", "_")
                contact_human.__name__ = f"contact_human_in_slack_in_{fn_ctx}"

        return contact_human
