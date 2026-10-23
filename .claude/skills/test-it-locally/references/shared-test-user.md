# Shared Riptide Test User

Use one password-based WorkOS sandbox user for local and dev UI checks. This avoids a manual Google login for each new devstack route.

## Team admin setup

1. In the WorkOS sandbox used by local development, create a dedicated user that signs in with email and password. Do not link a personal Google account.
2. Add the user to any WorkOS organization used for local testing as a normal member. For example, some developers use `Lizalg`, while others use a different test organization and ID. Grant an admin role only when a test needs admin access.
3. Complete one sign-in through AuthKit and confirm the user reaches Riptide with the chosen test organization active.
4. Store the email and password in the team's approved secret manager. Do not put either value in this repository, a ticket, chat, or a shared shell script.

The account must exist only in the WorkOS sandbox or dev environment. Do not add it to beta or production organizations.

## Developer setup

Get the values through the team's approved secret-sharing method and add them to the root `.env`:

```dotenv
DEVSTACK_LOCAL_USER_EMAIL=<shared sandbox user email>
DEVSTACK_LOCAL_USER_PASSWORD=<shared sandbox user password>
```

The root `.env` is ignored by Git. Do not add these values to an app-level env file. Confirm only that the keys exist without printing their values:

```bash
cat .env | cut -d= -f1 | grep -E '^DEVSTACK_LOCAL_USER_(EMAIL|PASSWORD)$'
```

When using the values, source `.env` so the shell removes valid wrapping quotes:

```bash
set -a
source .env
set +a
test -n "$DEVSTACK_LOCAL_USER_EMAIL" && test -n "$DEVSTACK_LOCAL_USER_PASSWORD"
```

Do not load credential values with `grep` and `cut`. That keeps wrapping quotes and can send them as part of the email or password.

Follow the login flow in the main Test It Locally skill. Pass credentials to `agent-browser fill` through the environment variables, never as literal text. If WorkOS asks you to choose an organization, use the exact organization name shown by `bun --bun run devstack status`; use the WorkOS ID in parentheses to tell matching names apart.

## Rotation and repair

- Rotate the password when a developer who knew it leaves the team, when it appears in output, or when WorkOS reports a sign-in risk.
- Update the team secret manager first, then have each developer update the root `.env` on their machine.
- If the account cannot reach the app, check its membership in the chosen test organization and its password sign-in method before changing local code.
- If a test changes shared organization data, clean up that data when the test ends so later developers start from a known state.
