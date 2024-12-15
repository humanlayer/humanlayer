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

5. Set up an [agent webhook](https://humanlayer.dev/docs/core/agent-webhooks) to point to your ngrok subdomain

> https://your-subdomain.ngrok-free.app/webhook/new-email-thread

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

1. Send an email to the agent email address, e.g.

> We need to create a campaign for the Super Bowl

2. HumanLayer will send a webhook to the `/webhook/new-email-thread` endpoint

3. Watch the logs to see the agent respond to the email, usually asking for clarification

> What sorts of items do you want in the campaign

4. reply to the email with more information

> i dunno maybe do little toy footballs, add some beer or something, i don't care we have tons of crap in the warehouse just pick things football people would like

5. When agent is ready to draft a campaign, it will send a reply to the email with the draft details

6. The human user can reply to the email with feedback, which will be sent back to the agent

> this sucks it needs more wings and beer

7. this "draft" / "feedback" loop will continue until the human user is happy with the campaign, answering with something like:

> great campaign, publish it
