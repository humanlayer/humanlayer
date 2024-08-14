# OpenAI Client Example

This is a straightforward and simple (albeit verbose) example of tool calling with a plain OpenAI Client -
no frameworks are used to manage the tool calling loop. Among other things, this example serves as a good
"look under the hood" for how frameworks generally implement tool calling.

In this example, as in others, the `multiply(x: int, y: int) -> int` function is wrapped with
`@hl.require_approval`.

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

## What you should see

The script will proceed with the prompt `multiply 2 and 5` until the first function call, after which it will wait for approval:

```
INFO:httpx:HTTP Request: POST https://api.openai.com/v1/chat/completions "HTTP/1.1 200 OK"
INFO:__main__:last message led to 1 tool calls: [('multiply', '{"x":2,"y":5}')]
INFO:__main__:CALL tool multiply with {'x': 2, 'y': 5}
```
