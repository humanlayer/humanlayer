# Contributing

Thanks for helping. Bug reports, feature requests, and feedback are welcome from anyone: [open an issue](https://github.com/humanlayer/humanlayer/issues/new/choose).

## Getting vouched

To send code, a maintainer has to vouch for you first. We use [Vouch](https://github.com/mitchellh/vouch). The list lives in [`.github/VOUCHED.td`](.github/VOUCHED.td). A bot closes pull requests from authors who aren't on it, so read this before you write code.

1. Install the HumanLayer RPI plugin in Claude Code:
   ```
   /plugin marketplace add humanlayer/riptide-rpi
   /plugin install riptide-rpi@humanlayer-riptide-rpi
   ```
2. In your clone, run `/rpi:create-design-discussion` with the problem and the change you want to make.
3. Answer the design questions until each one is under "Resolved Design Questions", with your reasoning and the options you rejected. `/rpi:iterate-design-discussion` picks the document back up.
4. Open a [contribution proposal](https://github.com/humanlayer/humanlayer/issues/new?template=3-contribution-proposal.yml) with the problem, your proposed solution, and the finished document.

If the plan holds up, a maintainer comments `!vouch` and you're added to the list. If you already opened a pull request and the bot closed it, reopen it and comment `/recheck`.

Being vouched lets you open pull requests. It doesn't skip review. Spam or abuse gets you denounced, which closes your issues and pull requests automatically.

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
