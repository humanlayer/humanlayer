## What problem(s) was I solving?

Users need an easy, frictionless way to join the HumanLayer Code waitlist directly from the command line. Previously, they had to navigate to the website and fill out a form. This creates a seamless experience for developers who are already working in their terminal environment.

## What user-facing changes did I ship?

Added a new `npx humanlayer join-waitlist --email EMAIL` command that:
- Works without installation via npx
- Validates email format before submission
- Provides clear, colorful feedback for success/errors
- Shows helpful next steps including Discord community link
- Bypasses authentication (public endpoint)

## How I implemented it

1. Created a new command module `hlyr/src/commands/joinWaitlist.ts` following the existing command pattern:
   - Email validation using regex
   - POST request to `https://www.humanlayer.dev/api/waitlist` 
   - Native fetch API with proper error handling
   - Colored console output using chalk
   - Helpful next steps on success

2. Updated `hlyr/src/index.ts` to register the command:
   - Added import for `joinWaitlistCommand`
   - Added `'join-waitlist'` to `UNPROTECTED_COMMANDS` array (no auth needed)
   - Registered command with description and required `--email` option

3. The implementation follows existing patterns in the codebase for consistency and maintainability.

## How to verify it

- [x] I have ensured `make check test` passes (TypeScript portions pass; unrelated Go build error exists)

Additional verification steps:
- Test valid email: `npx . join-waitlist --email test@example.com` ✓
- Test invalid email: `npx . join-waitlist --email invalid-email` ✓
- Test help text: `npx . join-waitlist --help` ✓
- Test missing email: `npx . join-waitlist` ✓
- All formatting and linting checks pass ✓

## Description for the changelog

Add `npx humanlayer join-waitlist --email EMAIL` command for easy waitlist signup from the command line