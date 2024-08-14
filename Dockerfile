# syntax=docker/dockerfile:1
FROM python:3.11-slim-bookworm as prod

# Set the working directory in the container to /app
WORKDIR /app

# Run apt update and upgrade
RUN apt update \
    && apt upgrade -y \
    && apt clean

ENV POETRY_VERSION=1.7 \
    POETRY_VIRTUALENVS_CREATE=false

# Install poetry
RUN pip install "poetry==$POETRY_VERSION"

# Add the current directory contents into the container at /app
COPY pyproject.toml poetry.lock /app/

# Install project dependencies
RUN --mount=type=cache,target=/root/.cache/pypoetry/cache \
    --mount=type=cache,target=/root/.cache/pypoetry/artifacts \
    poetry install --no-interaction --no-ansi --without dev

# Copy Python code to the Docker image
COPY humanlayer /code/humanlayer

ENTRYPOINT ["humanlayer"]

FROM prod as dev

RUN poetry install --no-interaction --no-ansi --no-root

ENTRYPOINT ["bin/bash", "-c"]
