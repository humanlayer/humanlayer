# HumanLayer FastAPI Email Example

This example demonstrates how to use HumanLayer email with FastAPI.


### todo video

## Overview

This example showcases a campaign creation workflow.

The workflow is:

- Send an email to a HumanLayer agent email 
- HumanLayer will send the webhook to the `/webhook/inbound` endpoint here
- email is classified into one of the following intents:
  - `ready_to_create_campaign`
  - `request_more_information`
- in the request more information case, HumanLayer will send a reply to the email with a request for more information, which the human user can reply to
- If the email is a campaign creation request, LLM/deterministic steps will be taken to create a campaign draft
- The agent will use HumanLayer to send the campaign draft to the human user for approval over email
- The human user can reply to the email with feedback, which will be sent back to the agent
- this will continue until the human user approves the campaign draft
- the campaign will be published

The server tracks the state of each thread in memory

This is obviously a bit of a toy example, but you can use it to see how webhooks work with HumanLayer.

## Setup

1. Create a virtual environment and activate it:

   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

3. Copy `.env.example` to `.env` and fill in your API keys:

   ```bash
   cp .env.example .env
   # Add your keys to .env:
   # HUMANLAYER_API_KEY=your_key_here
   ```

4. Get an ngrok.com account and claim your free static subdomain.

5. Set up response webhooks in the HumanLayer saas

> https://your-subdomain.ngrok-free.app/webhook/inbound

![webhooks](./img/webhooks.png)

## Running the Application

Start the server:

```bash
python app.py
# Or
uvicorn app:app --reload
```

In another terminal, run ngrok:

```bash
ngrok http 8000 --domain=your-subdomain.ngrok-free.app
```

## Step by step walkthough

1. Open http://localhost:8000/purchase-materials - this will queue a purchase for approval

![purchase-materials](./img/purchase-materials.png)

2. Open http://localhost:8000/purchases - this will show the pending approval

![purchases](./img/purchases.png)

3. Approve the purchase w/ HumanLayer - in this example we'll use the slack integration

![approve](./img/approve.png)

4. Open http://localhost:8000/purchases - this will show the purchase was finalized

![purchases](./img/purchases-finalized.png)

5. You can check the app logs to see that the webhook was received and the purchase was executed

![logs](./img/logs.png)

The code that handles this is in app.py:

```python
@app.post("/webhook/inbound")
async def webhook_inbound(webhook: FunctionCall) -> Dict[str, str]:
    purchases[webhook.call_id] = webhook

    if webhook.status is not None and webhook.status.approved:
        finalize_purchase(webhook.spec.kwargs["material"], webhook.spec.kwargs["quantity"])
    else:
        print(f"Purchase {webhook.call_id} denied")

    return {"status": "ok"}
```
