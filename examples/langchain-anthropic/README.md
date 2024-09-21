# LangChain Examples

Two ways to get started:

1. [If you're comfortable with virtualenvs](#if-youre-comfortable-with-virtualenvs)
2. [If you prefer docker](#if-you-prefer-docker)

## Set up Environment Variable

```
cp dotenv.example .env
# fill out values
```

## If you're comfortable with virtualenvs

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
python 04-linkedin-anthropic.py
```

## If you prefer docker

```
docker compose run examples 04-linkedin-anthropic.py
```

## All Examples

- [04-linkedin-anthropic.py](04-human_as_tool_onboarding.py) - Human-as-tool for a linkedin inbox manager (also uses require_approval)
