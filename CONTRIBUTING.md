# Contributing

Thanks for helping. Open an issue before large changes, so we can agree on the shape first.

## Setup

You need [Bun](https://bun.sh) and Docker. Changes to `apps/riptide-native` also need Rust.

```
bun install
cp .env.example .env
```

Use `bun` for everything, never npm, pnpm, or yarn. Add a dependency to the package that needs it (`cd apps/riptide-ui && bun add ...`), not to the root.

## Checks

A pull request must pass what CI runs:

```
bun --bun run typecheck
bun --bun run quality       # oxlint + oxfmt; `bun run quality:fix` fixes most of it
bun run test
bun run test:local:services # tests that need Postgres, Electric, and Redis in Docker
```

CI runs on every pull request, forks included, with no secrets. No test may need a real API key.

## Pull requests

- Keep each one to one change, with tests for new behavior.
- Database changes: edit `packages/db/src/tables`, then run `bun run db:migrations:generate`. Don't write SQL migrations by hand.
- User-visible strings follow `.claude/skills/ui-copy/SKILL.md`.

By sending a pull request, you agree to license your contribution under the [Apache License 2.0](LICENSE).

## Security issues

Don't open a public issue. See [SECURITY.md](SECURITY.md).
