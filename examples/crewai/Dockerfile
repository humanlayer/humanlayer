# syntax=docker/dockerfile:1
FROM python:3.11-slim-bookworm as prod

WORKDIR /app

COPY requirements.txt /app
RUN  --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

COPY . /app

ENTRYPOINT ["python3"]
CMD ["crewai_math.py"]
