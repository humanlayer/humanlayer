FROM node:20-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

# Create non-root user
RUN useradd -m -s /bin/bash claude
USER claude

WORKDIR /home/claude/workspace

# Skip login prompts, use API key directly
ENV CI=true
ENV TERM=xterm-256color
ENV FORCE_COLOR=1

ENTRYPOINT ["claude"]
