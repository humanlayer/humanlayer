# WUI Demo System - Marketing Team Guide

A simple guide for creating automated product demonstrations and screenshots.

## Quick Start

### 1. Using Pre-built Demos

The easiest way to get started is using our pre-built demo sequences:

```tsx
import { QuickDemo } from '@/stores/demo/export'
import SessionTable from '@/components/internal/SessionTable'

// Launcher workflow demo
<QuickDemo sequence="launcher">
  <SessionTable />
</QuickDemo>

// Status changes demo
<QuickDemo sequence="status">
  <SessionTable />
</QuickDemo>

// Theme showcase demo
<QuickDemo sequence="themes">
  <SessionTable />
</QuickDemo>
```

### 2. Creating Custom Sequences

Use the sequence builder for custom demonstrations:

```tsx
import { createSequence, createMockSession, SessionStatus, DemoStoreProvider } from '@/stores/demo/export'

// Build your sequence
const mySequence = createSequence()
  .addSessions([])  // Start empty
  .openLauncher()   // Show launcher
  .addDelay(3000)   // Wait 3 seconds
  .addSessions([    // Add some sessions
    createMockSession('1', 'Implement new feature', SessionStatus.Running),
    createMockSession('2', 'Write documentation', SessionStatus.Completed)
  ])
  .closeLauncher()  // Close launcher
  .showApproval('1', 'Deploy changes?')  // Show approval
  .setTheme('catppuccin')  // Change theme
  .build()

// Use it in your component
<DemoStoreProvider sequence={mySequence}>
  <YourComponents />
</DemoStoreProvider>
```

## Common Scenarios

### Product Screenshot Sequence

Perfect for capturing different states:

```tsx
const screenshotSequence = createSequence()
  // Empty state
  .addSessions([])
  .addDelay(2000)

  // Active sessions
  .addSessions([
    createMockSession('1', 'Analyzing codebase', SessionStatus.Running),
    createMockSession('2', 'Running tests', SessionStatus.Running),
    createMockSession('3', 'Deployment complete', SessionStatus.Completed),
  ])
  .addDelay(3000)

  // Approval needed
  .showApproval('1', 'Update production database?')
  .addDelay(3000)

  // Theme variations
  .setTheme('solarized-light')
  .addDelay(2000)
  .setTheme('gruvbox-dark')
  .build()
```

### Feature Demo Sequence

Show a complete workflow:

```tsx
const featureDemo = createSequence()
  // User opens launcher
  .openLauncher('search')
  .addDelay(2000)

  // Creates a new session
  .addSessions([createMockSession('1', 'Debug authentication issue', SessionStatus.Starting)])
  .closeLauncher()
  .addDelay(1500)

  // Session becomes active
  .addSessions([createMockSession('1', 'Debug authentication issue', SessionStatus.Running)])
  .addDelay(2000)

  // Needs approval
  .addSessions([createMockSession('1', 'Debug authentication issue', SessionStatus.WaitingInput)])
  .showApproval('1', 'Modify auth config?')
  .addDelay(3000)

  // Completes
  .addSessions([createMockSession('1', 'Debug authentication issue', SessionStatus.Completed)])
  .build()
```

## Session States

Available session statuses for realistic demos:

- `SessionStatus.Starting` - Session initializing
- `SessionStatus.Running` - Actively processing
- `SessionStatus.WaitingInput` - Needs user approval
- `SessionStatus.Completed` - Successfully finished
- `SessionStatus.Failed` - Error occurred

## Themes

Available themes for showcasing:

- `solarized-dark` (default)
- `solarized-light`
- `catppuccin`
- `framer-dark`
- `gruvbox-dark`
- `high-contrast`

## Tips for Great Demos

1. **Timing**: Use appropriate delays (1000-3000ms) between actions
2. **Realism**: Mix different session states for authentic feel
3. **Progression**: Show logical workflow progressions
4. **Variety**: Include different scenarios (success, waiting, errors)

## Recording Animations

To capture your demo as a video:

1. Set up your demo component with desired sequence
2. Use screen recording software (OBS, QuickTime, etc.)
3. Refresh the page to restart the animation
4. Record the full sequence

## Example: Complete Marketing Demo

```tsx
import { QuickDemo } from '@/stores/demo/export'
import { Card } from '@/components/ui/card'
import SessionTable from '@/components/internal/SessionTable'
import { ThemeSelector } from '@/components/ThemeSelector'

export function MarketingDemo() {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-2">HumanLayer WUI</h1>
          <p className="text-muted-foreground">AI Session Management Interface</p>
        </div>

        <Card className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-semibold">Active Sessions</h2>
            <ThemeSelector />
          </div>

          <QuickDemo sequence="launcher">
            <SessionTable />
          </QuickDemo>
        </Card>
      </div>
    </div>
  )
}
```

## Need Help?

- Check the main README for technical details
- Look at `sequences.ts` for more examples
- Test your sequences in the WuiDemo page first
