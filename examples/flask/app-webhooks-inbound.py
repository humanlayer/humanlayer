
from flask import Flask, jsonify, request, redirect
from typing import Dict, Any
from agent import run_agent
from humanlayer import FunctionCall, FunctionCallSpec
from humanlayer.core.approval import HumanLayer

hl = HumanLayer(
    verbose=True,
    run_id="flask-langchain-math",
)

app = Flask(__name__)

# In-memory storage for function calls
function_calls: Dict[str, FunctionCall] = {}

hl = HumanLayer(
    verbose=True,
    run_id="flask-langchain-math",
)


@app.route("/")
def root() -> Dict[str, str]:
    return {"message": "Welcome to the HumanLayer Flask Example"}


@app.route("/run")
def run() -> Any:
    prompt = request.args.get("prompt")
    if not prompt:
        return {"status": "error", "message": "No prompt provided"}

    result = run_agent(prompt)

    # Create function call for approval
    pending_call = hl.create_function_call(
        spec=FunctionCallSpec(
            fn="respond_to_user",
            kwargs={"message": result},
        )
    )
    function_calls[pending_call.call_id] = pending_call

    return redirect(f"/run/{pending_call.call_id}")


@app.route("/run/<call_id>")
def run_by_id(call_id: str) -> Dict[str, Any]:
    call = function_calls.get(call_id)
    if not call:
        return {"status": "error", "message": "Function call not found"}

    if call.status is not None and call.status.approved:
        return {"status": "success", "result": call.spec.kwargs["message"]}

    return {"status": "pending", "message": "Waiting for approval, refresh to check status"}


@app.route("/function-calls")
def get_function_calls() -> Dict[str, Any]:
    return {"function_calls": [call.model_dump(mode="json") for call in function_calls.values()]}

class EmailMessage(BaseModel):
    from_address: str
    to_address: list[str]
    cc_address: list[str]
    subject: str
    content: str
    datetime: str


class EmailPayload(BaseModel):
    from_address: str
    to_address: str
    subject: str
    body: str
    message_id: str
    previous_thread: list[EmailMessage] | None = None
    raw_email: str


@app.route("/webhook/new-email-thread", methods=["POST"])
def webhook_inbound() -> Dict[str, str]:
    webhook = EmailPayload.model_validate(request.json)
    function_calls[webhook.call_id] = webhook

    if webhook.status is not None and webhook.status.approved:
        print(f"Function call {webhook.call_id} approved")
    else:
        print(f"Function call {webhook.call_id} denied")

    return {"status": "ok"}

@app.route("/webhook/inbound", methods=["POST"])
def webhook_inbound() -> Dict[str, str]:
    webhook = FunctionCall.model_validate(request.json)
    function_calls[webhook.call_id] = webhook

    if webhook.status is not None and webhook.status.approved:
        print(f"Function call {webhook.call_id} approved")
    else:
        print(f"Function call {webhook.call_id} denied")

    return {"status": "ok"}


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)  # noqa: S104
