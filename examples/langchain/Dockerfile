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
COPY requirements.txt /app

# Install project dependencies
RUN pip install langchain langchain-openai git+https://github.com/functionlayer/functionlayer

# Copy Python code to the Docker image
COPY . /app

CMD ["python", "01-math_example.py"]

