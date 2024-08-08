# syntax=docker/dockerfile:1
FROM python:3.11-slim-bookworm as prod

WORKDIR /app

RUN pip install \
    python-dotenv \
    openai \
    functionlayer-ai

COPY . /app

ENTRYPOINT ["python3"]
CMD ["math_example.py"]