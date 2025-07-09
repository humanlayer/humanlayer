# NPX Join Waitlist Command Implementation Plan

## Overview

This plan implements the `npx humanlayer join-waitlist --email EMAIL` command that allows users to join the HumanLayer waitlist through a simple CLI command. The command will make a POST request to the public endpoint at `https://www.humanlayer.dev/api/waitlist`.

## Problem Statement

From ENG-1511:
- Users need an easy way to join the HumanLayer waitlist from the command line
- The command should work with `npx` without requiring installation
- Must integrate with the existing waitlist endpoint at humanlayer.dev

## Key Requirements

1. **Simple Usage**: `npx humanlayer join-waitlist --email user@example.com`
2. **No Authentication**: Public endpoint, no auth required
3. **Clear Feedback**: Success/error messages to the user
4. **NPX Compatible**: Must work without installation

## Current State

Based on the research findings:
1. **hlyr CLI exists**: Already supports npm/npx distribution with binary names `humanlayer` and `hlyr`
2. **Command pattern established**: Clear patterns for adding new commands
3. **HTTP patterns available**: Native fetch API is used throughout the codebase
4. **Unprotected commands supported**: Infrastructure exists for commands that bypass authentication

## Implementation Steps

### Phase 1: Create Join Waitlist Command

**File:** `hlyr/src/commands/joinWaitlist.ts`

```typescript
import chalk from 'chalk'

interface JoinWaitlistOptions {
  email: string
}

export async function joinWaitlistCommand(options: JoinWaitlistOptions): Promise<void> {
  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(options.email)) {
    console.error(chalk.red('✗ Invalid email format'))
    process.exit(1)
  }

  console.log(chalk.gray(`Joining waitlist with email: ${options.email}...`))

  try {
    const response = await fetch('https://www.humanlayer.dev/api/waitlist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'humanlayer-cli',
      },
      body: JSON.stringify({ email: options.email }),
    })

    if (!response.ok) {
      // Try to parse error message from response
      let errorMessage = `${response.status} ${response.statusText}`
      try {
        const errorData = await response.json()
        if (errorData.message || errorData.error) {
          errorMessage = errorData.message || errorData.error
        }
      } catch {
        // Ignore JSON parse errors, use default message
      }

      throw new Error(errorMessage)
    }

    // Success!
    console.log(chalk.green('✓ Successfully joined the HumanLayer waitlist!'))
    console.log(chalk.gray(`We'll contact you at ${options.email} with updates.`))
    console.log()
    console.log(chalk.cyan('Next steps:'))
    console.log(chalk.gray('  • Check your email for a confirmation'))
    console.log(chalk.gray('  • Visit https://www.humanlayer.dev for more information'))
    console.log(chalk.gray('  • Join our Discord community for early access'))
  } catch (error) {
    console.error(chalk.red('✗ Failed to join waitlist'))
    if (error instanceof Error) {
      console.error(chalk.red(`Error: ${error.message}`))
    } else {
      console.error(chalk.red(`Error: ${error}`))
    }
    process.exit(1)
  }
}
```

**Success Criteria:**
- [ ] Email validation works correctly
- [ ] Successful requests show clear confirmation
- [ ] Error messages are user-friendly
- [ ] Network timeouts are handled gracefully

### Phase 2: Register Command in CLI

**File:** `hlyr/src/index.ts`

Add to imports section:
```typescript
import { joinWaitlistCommand } from './commands/joinWaitlist.js'
```

Update UNPROTECTED_COMMANDS array (around line 91):
```typescript
const UNPROTECTED_COMMANDS = ['config', 'login', 'thoughts', 'join-waitlist']
```

Add command registration (after other commands, around line 190):
```typescript
program
  .command('join-waitlist')
  .description('Join the HumanLayer waitlist for updates and early access')
  .requiredOption('--email <email>', 'Your email address')
  .action(joinWaitlistCommand)
```

**Success Criteria:**
- [ ] Command appears in help output
- [ ] Command bypasses authentication
- [ ] Email option is required
- [ ] Description is clear and helpful

### Phase 3: Add Tests

**File:** `hlyr/src/commands/__tests__/joinWaitlist.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { joinWaitlistCommand } from '../joinWaitlist'
import chalk from 'chalk'

// Mock fetch
global.fetch = vi.fn()

// Mock console
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation()
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation()
const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation()

describe('joinWaitlistCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should successfully join waitlist with valid email', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
    })

    await joinWaitlistCommand({ email: 'test@example.com' })

    expect(fetch).toHaveBeenCalledWith(
      'https://www.humanlayer.dev/api/waitlist',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ email: 'test@example.com' }),
      })
    )

    expect(mockConsoleLog).toHaveBeenCalledWith(
      chalk.green('✓ Successfully joined the HumanLayer waitlist!')
    )
  })

  it('should reject invalid email formats', async () => {
    await joinWaitlistCommand({ email: 'invalid-email' })

    expect(mockConsoleError).toHaveBeenCalledWith(
      chalk.red('✗ Invalid email format')
    )
    expect(mockProcessExit).toHaveBeenCalledWith(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('should handle API errors gracefully', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ error: 'Email already registered' }),
    })

    await joinWaitlistCommand({ email: 'test@example.com' })

    expect(mockConsoleError).toHaveBeenCalledWith(
      chalk.red('✗ Failed to join waitlist')
    )
    expect(mockConsoleError).toHaveBeenCalledWith(
      chalk.red('Error: Email already registered')
    )
    expect(mockProcessExit).toHaveBeenCalledWith(1)
  })

  it('should handle network errors', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('Network error'))

    await joinWaitlistCommand({ email: 'test@example.com' })

    expect(mockConsoleError).toHaveBeenCalledWith(
      chalk.red('✗ Failed to join waitlist')
    )
    expect(mockConsoleError).toHaveBeenCalledWith(
      chalk.red('Error: Network error')
    )
    expect(mockProcessExit).toHaveBeenCalledWith(1)
  })
})
```

**Success Criteria:**
- [ ] All test cases pass
- [ ] Edge cases are covered
- [ ] Mocking is properly set up

### Phase 4: Build and Manual Testing

**Steps:**
```bash
# Build the package
cd hlyr
npm run build

# Test locally with various scenarios
npx . join-waitlist --email valid@example.com
npx . join-waitlist --email invalid-email
npx . join-waitlist --help
npx . join-waitlist  # Missing required option

# Test with global package name
npx humanlayer join-waitlist --email test@example.com
```

**Success Criteria:**
- [ ] Build completes without errors
- [ ] Command executes via npx
- [ ] Both `hlyr` and `humanlayer` binaries work
- [ ] Help text displays correctly
- [ ] Required option validation works

### Phase 5: Documentation Updates

**File:** `hlyr/README.md`

Add to the commands section:
```markdown
### Join Waitlist

Join the HumanLayer waitlist to get updates about new features and early access:

```bash
npx humanlayer join-waitlist --email your@email.com
```

This command:
- Adds your email to our waitlist
- Sends you updates about HumanLayer development
- Gives you early access to new features
```

**File:** `docs/getting-started.mdx` (if applicable)

Add a section about joining the waitlist through the CLI.

**Success Criteria:**
- [ ] README updated with command documentation
- [ ] Usage examples are clear
- [ ] Benefits of joining waitlist are explained

## Testing Plan

1. **Unit Tests**: Test command logic in isolation
2. **Integration Tests**: Test actual HTTP requests (with mock server)
3. **Manual Testing**:
   - Test with various email formats
   - Test network failure scenarios
   - Test with proxy settings
   - Test npx caching behavior

## Rollout Plan

1. **Initial Implementation**: Complete all phases above
2. **Internal Testing**: Team tests the command
3. **NPM Publish**: Publish new version to npm
4. **Announcement**:
   - Update website with CLI option
   - Social media announcement
   - Discord announcement

## Future Enhancements

1. **Bulk Import**: Support reading emails from file
2. **Confirmation**: Add `--confirm` flag to skip confirmation prompt
3. **Source Tracking**: Add source parameter to track where signups come from
4. **Rate Limiting**: Handle rate limit responses gracefully
5. **Offline Queue**: Queue requests when offline, submit when online

## Implementation Time Estimate

**Total: 3-4 hours**
1. Command implementation: 45 minutes
2. CLI integration: 30 minutes
3. Tests: 1 hour
4. Manual testing: 45 minutes
5. Documentation: 30 minutes

## Success Metrics

After deployment, track:
1. Number of waitlist signups via CLI
2. Conversion rate from CLI signup to active user
3. Error rates and types
4. User feedback on ease of use

## Notes

- The waitlist endpoint is already live at https://www.humanlayer.dev/api/waitlist
- Email validation should be client-side only; server will do its own validation
- Consider adding telemetry to track CLI usage (with user consent)
- The command should work offline-first with clear error messages
