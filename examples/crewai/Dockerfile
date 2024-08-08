# syntax=docker/dockerfile:1
FROM python:3.11-slim-bookworm as prod

WORKDIR /app

RUN pip install \
    python-dotenv \
    crewai \
    crewai-tools \
    functionlayer

COPY . /app

ENTRYPOINT ["python3"]
CMD ["crewai_math.py"]