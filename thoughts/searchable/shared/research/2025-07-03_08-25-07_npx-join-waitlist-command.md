---
date: 2025-07-03T08:15:45PDT
researcher: dex
git_commit: d64d875accb25cbdf11bdd3a9042ce67e32801b7
branch: dexter/eng-1462-storybook-staging-area-for-sythentic-product-shots
repository: humanlayer
topic: "Implementing npx humanlayer join-waitlist --email EMAIL command"
tags: [research, codebase, cli, npx, waitlist, humanlayer-ts, hlyr]
status: complete
last_updated: 2025-07-03
last_updated_by: dex
---

# Research: Implementing npx humanlayer join-waitlist --email EMAIL command

**Date**: 2025-07-03 08:15:45 PDT
**Researcher**: dex
**Git Commit**: d64d875accb25cbdf11bdd3a9042ce67e32801b7
**Branch**: dexter/eng-1462-storybook-staging-area-for-sythentic-product-shots
**Repository**: humanlayer

## Research Question
How to implement an `npx humanlayer join-waitlist --email EMAIL` command that calls the public endpoint at humanlayer.dev/api/waitlist

## Summary
Based on the research, implementing this command would best fit within the `hlyr` CLI structure, which already supports npm/npx distribution and has established patterns for adding new commands. The implementation would involve:
1. Adding a new command file `src/commands/joinWaitlist.ts` following the existing pattern
2. Registering the command in `src/index.ts` with proper option parsing
3. Using the native fetch API to make the POST request to the waitlist endpoint
4. Following the established error handling and output patterns

## Detailed Findings

### hlyr CLI Structure and Patterns
The hlyr directory contains the npm-distributed CLI that supports npx execution:
- Entry point: `hlyr/src/index.ts:1-224`
- Commands directory: `hlyr/src/commands/`
- Binary configuration in `hlyr/package.json:6-9` exposes both `humanlayer` and `hlyr` commands

Key patterns:
- Uses Commander.js for CLI parsing (`hlyr/src/index.ts:3`)
- Async command functions with typed options interfaces
- Colored output using chalk for error/success messages
- Pre-action authentication hook for protected commands (`hlyr/src/index.ts:79-97`)

### Command Implementation Pattern
Commands follow a consistent structure as seen in existing commands:
```typescript
// Example from hlyr/src/commands/ping.ts:11-28
interface CommandOptions {
  // option definitions
}

export async function commandName(options: CommandOptions): Promise<void> {
  try {
    // implementation
  } catch (error) {
    console.error(chalk.red('Error:'), error)
    process.exit(1)
  }
}
```

### HTTP Request Patterns
The codebase uses native fetch API for HTTP requests:
- Pattern from `hlyr/src/hlClient.ts:8-19` shows basic fetch usage with error handling
- Pattern from `humanlayer-ts/src/cloud.ts:33-40` shows POST request with JSON body
- Standard headers include `Content-Type: application/json`
- Error handling checks `resp.ok` and throws descriptive errors

### Authentication Considerations
The waitlist endpoint is public, so it should be added to the `UNPROTECTED_COMMANDS` array in `hlyr/src/index.ts:91` to bypass authentication requirements.

### NPM/NPX Distribution
- The package is already configured for npm distribution
- Binary names defined in `hlyr/package.json:6-9`
- Build process uses tsup for TypeScript compilation (`hlyr/package.json:15`)
- ESM module type specified (`hlyr/package.json:5`)

## Code References
- `hlyr/src/index.ts:99-224` - Command registration examples
- `hlyr/src/commands/login.ts:16-60` - HTTP request example with error handling
- `hlyr/src/commands/contactHuman.ts:12-58` - Option parsing and input handling
- `hlyr/package.json:6-9` - Binary configuration for npx execution

## Architecture Insights
1. The hlyr CLI is designed for extensibility with a clear command pattern
2. Commands are self-contained modules in the commands directory
3. The CLI supports both global installation and npx execution
4. Error handling is consistent across commands with colored output
5. Configuration management is handled separately from command logic

## Historical Context (from thoughts/)
- `thoughts/sundeep/dives/npx-cache-humanlayer-mcp.md` - NPX caching issues can occur with frequently updated packages
- `thoughts/global/shared/company/monthly-investor-updates.md` - There's already a waitlist at https://hlyr.dev/code with 20+ signups
- The company is pivoting towards a coding agent management platform

## Implementation Recommendation

### 1. Create new command file: `hlyr/src/commands/joinWaitlist.ts`
```typescript
import chalk from 'chalk'

interface JoinWaitlistOptions {
  email: string
}

export async function joinWaitlistCommand(options: JoinWaitlistOptions): Promise<void> {
  try {
    const response = await fetch('https://www.humanlayer.dev/api/waitlist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: options.email }),
    })

    if (!response.ok) {
      throw new Error(`Failed to join waitlist: ${response.status} ${response.statusText}`)
    }

    console.log(chalk.green('✓ Successfully joined the HumanLayer waitlist!'))
    console.log(chalk.gray(`We'll contact you at ${options.email} with updates.`))
  } catch (error) {
    console.error(chalk.red('✗ Failed to join waitlist'))
    console.error(chalk.red(`Error: ${error}`))
    process.exit(1)
  }
}
```

### 2. Register command in `hlyr/src/index.ts`
```typescript
// Add to imports
import { joinWaitlistCommand } from './commands/joinWaitlist.js'

// Add to UNPROTECTED_COMMANDS array (around line 91)
const UNPROTECTED_COMMANDS = ['config', 'login', 'thoughts', 'join-waitlist']

// Add command registration (after other commands, around line 190)
program
  .command('join-waitlist')
  .description('Join the HumanLayer waitlist')
  .requiredOption('--email <email>', 'Your email address')
  .action(joinWaitlistCommand)
```

### 3. Build and test
```bash
cd hlyr
npm run build
npx . join-waitlist --email test@example.com
```

## Related Research
None found in thoughts/shared/research/

## Open Questions
1. Should the command validate email format before sending the request?
2. Should there be a success message customization based on the API response?
3. Should the endpoint URL be configurable via environment variable or config file?
4. Should there be retry logic for network failures?