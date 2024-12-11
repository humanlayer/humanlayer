from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from typing import Any, Dict
from humanlayer import AsyncHumanLayer, FunctionCall, FunctionCallSpec

app = FastAPI(
    title="HumanLayer FastAPI Webhooks Example",
    description="Example of using AsyncHumanLayer with FastAPI",
    version="1.0.0",
)

# Initialize HumanLayer
hl = AsyncHumanLayer.cloud(verbose=True)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Root endpoint
@app.get("/")
async def root() -> Dict[str, str]:
    return {"message": "Welcome to the HumanLayer Webhooks Example"}


purchases: Dict[str, FunctionCall] = {}


def finalize_purchase(material: str, quantity: int) -> None:
    print(f"Purchased {quantity} of {material}")


@app.get("/purchase-materials")
async def purchase_materials() -> Dict[str, str]:
    pending_approval = await hl.create_function_call(
        spec=FunctionCallSpec(
            fn="purchase_materials",
            kwargs={"material": "wood", "quantity": 10},
        )
    )

    call_id = pending_approval.call_id

    purchases[call_id] = pending_approval

    return {"status": "purchase queued for approval", "call_id": call_id}


@app.get("/purchases")
async def get_purchases() -> Dict[str, Any]:
    return {"purchases": [purchase.model_dump(mode="json") for purchase in purchases.values()]}


@app.post("/webhook/inbound")
async def webhook_inbound(webhook: FunctionCall) -> Dict[str, str]:
    purchases[webhook.call_id] = webhook

    if webhook.status is not None and webhook.status.approved:
        finalize_purchase(webhook.spec.kwargs["material"], webhook.spec.kwargs["quantity"])
    else:
        print(f"Purchase {webhook.call_id} denied")

    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)  # noqa: S104
