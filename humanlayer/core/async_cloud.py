import json
import logging
import os
from typing import Any, Dict

import aiohttp
from pydantic import BaseModel, model_validator

from humanlayer.core.async_protocol import (
    AsyncAgentBackend,
    AsyncAgentStore,
)
from humanlayer.core.models import (
    FunctionCall,
    FunctionCallStatus,
    HumanContact,
    HumanContactStatus,
)
from humanlayer.core.protocol import HumanLayerException

logger = logging.getLogger(__name__)


class AsyncHumanLayerCloudConnection(BaseModel):
    api_key: str | None = None
    api_base_url: str | None = None
    _session: aiohttp.ClientSession | None = None
    http_timeout_seconds: int = 30

    @model_validator(mode="after")  # type: ignore
    def post_validate(self) -> None:
        self.api_key = self.api_key or os.getenv("HUMANLAYER_API_KEY")
        self.api_base_url = self.api_base_url or os.getenv(
            "HUMANLAYER_API_BASE", "https://api.humanlayer.dev/humanlayer/v1"
        )
        if not self.api_key:
            raise ValueError("HUMANLAYER_API_KEY is required for cloud approvals")

    async def request(
        self,
        method: str,
        path: str,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        async with (
            aiohttp.ClientSession(headers={"Authorization": f"Bearer {self.api_key}"}) as session,
            session.request(
                method,
                f"{self.api_base_url}{path}",
                **kwargs,
                timeout=aiohttp.ClientTimeout(total=self.http_timeout_seconds),
            ) as response,
        ):
            response_json = await response.json()
            logger.debug(
                "response %d %s",
                response.status,
                json.dumps(response_json, indent=2),
            )
            HumanLayerException.raise_for_status(response)

            return dict(response_json)


class AsyncCloudFunctionCallStore(AsyncAgentStore[FunctionCall, FunctionCallStatus]):
    def __init__(self, connection: AsyncHumanLayerCloudConnection) -> None:
        self.connection = connection

    async def add(self, item: FunctionCall) -> FunctionCall:
        resp_json = await self.connection.request(
            "POST",
            "/function_calls",
            json=item.model_dump(),
        )
        return FunctionCall.model_validate(resp_json)

    async def get(self, call_id: str) -> FunctionCall:
        resp_json = await self.connection.request(
            "GET",
            f"/function_calls/{call_id}",
        )
        return FunctionCall.model_validate(resp_json)

    async def respond(self, call_id: str, status: FunctionCallStatus) -> FunctionCall:
        resp_json = await self.connection.request(
            "POST",
            f"/agent/function_calls/{call_id}/respond",
            json=status.model_dump(),
        )
        return FunctionCall.model_validate(resp_json)


class AsyncCloudHumanContactStore(AsyncAgentStore[HumanContact, HumanContactStatus]):
    def __init__(self, connection: AsyncHumanLayerCloudConnection) -> None:
        self.connection = connection

    async def add(self, item: HumanContact) -> HumanContact:
        resp_json = await self.connection.request(
            "POST",
            "/contact_requests",
            json=item.model_dump(),
        )
        return HumanContact.model_validate(resp_json)

    async def get(self, call_id: str) -> HumanContact:
        resp_json = await self.connection.request(
            "GET",
            f"/contact_requests/{call_id}",
        )
        return HumanContact.model_validate(resp_json)

    async def respond(self, call_id: str, status: HumanContactStatus) -> HumanContact:
        resp_json = await self.connection.request(
            "POST",
            f"/agent/human_contacts/{call_id}/respond",
            json=status.model_dump(),
        )
        return HumanContact.model_validate(resp_json)


class AsyncCloudHumanLayerBackend(AsyncAgentBackend):
    def __init__(self, connection: AsyncHumanLayerCloudConnection) -> None:
        self.connection = connection
        self._function_calls = AsyncCloudFunctionCallStore(connection=connection)
        self._human_contacts = AsyncCloudHumanContactStore(connection=connection)

    def functions(self) -> AsyncCloudFunctionCallStore:
        return self._function_calls

    def contacts(self) -> AsyncCloudHumanContactStore:
        return self._human_contacts
