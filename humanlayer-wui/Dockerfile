FROM oven/bun:1.2.14

WORKDIR /app

# Install dependencies in a separate layer
COPY package.json bun.lock ./
RUN bun install

# Copy source files and config
COPY src ./src
COPY public ./public
COPY index.html vite.config.ts tsconfig.json tsconfig.node.json ./
COPY eslint.config.mjs .prettierrc.js .prettierignore ./

# Default command for development
CMD ["bun", "run", "dev"]