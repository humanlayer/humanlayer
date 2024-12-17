FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

ENV UV_SYSTEM_PYTHON=1
ENV PATH="/root/.local/bin:$PATH"

COPY requirements.txt .

RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install -r requirements.txt

COPY controlflow_math.py .

ENTRYPOINT ["uv", "run", "controlflow_math.py"]
