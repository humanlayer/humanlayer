# syntax=docker/dockerfile:1
FROM python:3.11-slim-bookworm as prod

WORKDIR /app

# tmp workaround until pip package is live
RUN apt-get update && apt-get install -y git

RUN pip install \
    python-dotenv \
    openai \
    git+https://github.com/functionlayer/functionlayer

COPY . /app

ENTRYPOINT ["python3"]
CMD ["math_example.py"]