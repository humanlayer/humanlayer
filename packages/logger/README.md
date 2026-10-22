# logger

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.2. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

**DO NOT TRY TO RUN THESE TESTS CONCURRENTLY**: they are not concurrency-safe since they set global `console` and since they measure memory usage.