# CrewAI Example w/ Mistral

## Environment Setup

```
cp dotenv.example .env
```

Your `.env` file should now look like:

```shell
# copy to .env
OPENAI_API_KEY=your-mistral-api-key
OPENAI_API_BASE=https://api.mistral.ai/v1
OPENAI_MODEL_NAME=mistral-small

HUMANLAYER_API_KEY=
```

Add `your-mistral-api-key`, just as in the [crewai docs](https://docs.crewai.com/how-to/LLM-Connections/#mistral-api).

If you have a HUMANLAYER_API_KEY, you can set it here as well, but the approval process will fall back to CLI approvals if no API key is set..

## Run the example

Two ways to get started:

1. [If you're comfortable with virtualenvs](#if-youre-comfortable-with-virtualenvs)
2. [If you prefer docker](#if-you-prefer-docker)

### If you're comfortable with virtualenvs

Activate a new virtualenv however you prefer, for example:

```
python3 -m venv venv
source venv/bin/activate
```

install requirements

```
pip install -r requirements.txt
```

```
python crewai_mistral.py
```

### If you prefer docker

```
docker compose run examples crewai_mistral.py
```
