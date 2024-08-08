# syntax=docker/dockerfile:1
FROM python:3.11-slim-bookworm as prod

WORKDIR /app

RUN pip install \
    python-dotenv \
    langchain \
    langchain-openai \
    functionlayer-ai

COPY . /app

ENTRYPOINT ["python3"]
CMD ["01-math_example.py"]