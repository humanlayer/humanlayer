Two ways to get started:

1. [If you're comfortable with virtualenvs](#if-youre-comfortable-with-virtualenvs)
2. [If you prefer docker](#if-you-prefer-docker)

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
python controlflow_math.py
```

## If you prefer docker

Be sure to set the environment variables in the `.env` file or pass them explicitly via the `-e` flag.

```
# docker compose
docker compose run examples controlflow_math.py
```
