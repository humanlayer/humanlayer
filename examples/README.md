## Humanlayer Cookbooks and Examples

### Basics and hello-world-y things

The most basic examples are:

- [openai_client](./openai_client) - basic example of HumanLayer using raw OpenAI client and function calling. 
- [langchain](./langchain) - basic langchain examples, includes the most complete set of examples including `human as tool` and `email` channel features
- [controlflow](./controlflow) - basic controlflow example
- [crewai](./crewai) - basic crewai example
- [fastapi](./fastapi) - basic fastapi server showcasing `AsyncHumanLayer` for asyncio apps
- [curl](./curl) - interact with the HumanLayer API using curl


### More advanced examples 

These examples include more end-to-end API examples, using webservers like flask and fastapi, and using some more advanced [state management](https://humanlayer.dev/docs/core/state-management) techniques.



- [openai_client/03-imperative_fetch.py](./openai_client/03-imperative_fetch.py) - showing how you can use lower-level SDK methods to interact with the HumanLayer API.
- [fastapi-webhooks](./fastapi-webhooks) - fastapi server that leverage humanlayer webhooks (e.g. with ngrok locally) to fire-and-forget function calls, and handle human approval events as they are received
- [fastapi-email](./fastapi-email) - two end-to-end examples of a workflow designed to be initiated via email, where approvals and requests from the agents are sent as replies on the same email thread. Includes two versions:
    - one where the fastapi server manages state
    - one where the fastapi server leverages the `HumanLayer` state management to manage state

### TypeScript examples

- [ts_openai_client](./ts_openai_client) - basic example of HumanLayer using raw OpenAI client and function calling
- [ts_vercel_ai_sdk](./ts_vercel_ai_sdk) - example showcasing HumanLayer + Vercel AI SDK
- [ts_langchain](./ts_langchain) - basic example of HumanLayer using LangchainJS

### Other LLMs

- [crewai-mistral](./crewai-mistral)
- [langchain-anthropic](./langchain-anthropic)
- [langchain-ollama](./langchain-ollama)

### Other Frameworks

- [chainlit](./chainlit) is a python-only ui framework for building chat apps
- [griptape](./griptape) is an agent orchestration and workflow framework
- [flask](./flask) - basic flask server showcasing `HumanLayer` for sync apps
