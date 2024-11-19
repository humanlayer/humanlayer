# LangChain-Ollama Examples

## Install Ollama
First need to install ollama in local 

visit to [ollama website](https://ollama.com/download)

After download pull lamma 3.1 in local
```
ollama run llama3.1
```

Now start model locally
```
ollama run llama3.1
```

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
python 01-math_example.py
```

## If you prefer docker

```
docker compose run examples 01-math_example.py
```

## All Examples


- [01-math_example.py](01-math_example.py) - A simple math example that uses functionlayer to gate access to the `multiply` function
- [02-customer_email.py](02-math_with_eval.py) - A simple email send to new on board User by `send_email()` and take apporval from Admin


