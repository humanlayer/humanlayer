## What problem(s) was I solving?

Users were unable to send messages to Claude while it was actively running, which created a poor user experience when they wanted to interrupt or queue up follow-up messages. The UI would disable the input field and send button during `running` or `starting` session states, forcing users to wait until the session completed before they could interact again.

Additionally, when users were able to interrupt, there was no clear visual feedback about:
- Whether they could interrupt Claude while it's running
- What would happen when they send a message during a running session  
- Whether their interrupt message was actually sent and being processed

There was also a backend issue where interrupted sessions would briefly show as "failed" before transitioning to "completed", causing confusion about whether the interrupt succeeded.

This was tracked as issue #258: "Allow user to provide messages for Claude while Claude is running".

## What user-facing changes did I ship?

- **Enabled message input during running sessions**: Users can now type and send messages while Claude is actively running
- **Clear interrupt indication**: The placeholder text now shows "Enter message to interrupt..." when Claude is running, making it clear what will happen
- **Improved button messaging**: The button now shows "Interrupt & Reply" with the keyboard shortcut indicator when Claude is running (instead of just "Running")
- **Updated status text**: Shows "Claude is working - you can interrupt with a new message" to explicitly communicate that interruption is possible
- **Visual feedback during interrupt**: 
  - Input field gets reduced opacity while interrupt is being processed
  - Button changes to "Interrupting..." to show the action is in progress
  - Help text shows "Waiting for Claude to accept the interrupt..." during processing
- **Enhanced keyboard shortcuts**: The R key now works to show the input field during running/starting sessions, not just completed ones
- **Updated help text**: When running, the help text now says "Press Enter to interrupt and send" to clarify the behavior
- **Error recovery**: If an interrupt fails, the message is preserved so users can retry
- **Consistent failed state handling**: Failed sessions properly show as disabled with appropriate messaging
- **Fixed transient failed status**: Interrupted sessions no longer briefly show as "failed" before transitioning to "completed"

The UI now only disables input when a session has failed, allowing interaction in all other states (running, starting, completed).

## How I implemented it

The implementation consisted of four main phases:

### 1. Initial UI changes to enable interrupting (first commit)
Updated the SessionDetail component (`humanlayer-wui/src/components/internal/SessionDetail.tsx`):
- **Changed disable conditions**: Updated three disable conditions from `session.status !== 'completed'` to `session.status === 'failed'`
  - Line 1044: Button to show response input
  - Line 1075: Input field
  - Line 1080: Send button
- **Updated placeholder and help text**: Added conditional logic to show different messages based on session state

### 2. Code refactoring for maintainability (based on PR feedback)
To improve code maintainability and readability, extracted the status-dependent text logic into dedicated helper functions:
- `getSessionStatusText()`: Returns appropriate status message for the session
- `getSessionButtonText()`: Returns the button text/state based on session status
- `getInputPlaceholder()`: Returns contextual placeholder text (shortened "Enter message to interrupt..." for better mobile UX)
- `getHelpText()`: Returns keyboard shortcut help text appropriate to the session state

These helper functions centralize the logic for session state handling, making the code easier to maintain and modify in the future.

### 3. Enhanced UX feedback for interrupt flow
Added comprehensive visual feedback to address user confusion about interrupt status:
- **Button improvements**: Changed from generic "Running" to actionable "Interrupt & Reply" with keyboard shortcut
- **Status clarity**: Updated status text to explicitly state interruption is possible
- **R hotkey enhancement**: Extended to work during running/starting sessions
- **Visual feedback during interrupt**:
  - Input field opacity reduction while processing
  - Button text changes to "Interrupting..."  
  - Help text updates to "Waiting for Claude to accept the interrupt..."
- **Message preservation**: Keep message visible until interrupt is accepted (up to ~10 seconds)
- **Error handling**: Preserve message on error to allow retry

### 4. Backend fix for transient failed status (latest commit)
Fixed a race condition in the session manager (`hld/session/manager.go`):
- **Problem**: When a session was interrupted, the monitor goroutine would see the process exit with an error and briefly mark the session as failed before it transitioned to completed
- **Solution**: Added a check for the "completing" status (which indicates an intentional interrupt) before marking a session as failed
- **Result**: Interrupted sessions now transition cleanly from "completing" to "completed" without showing the transient "failed" status

The backend already supported interrupting running sessions via the `ContinueSession` API, so most changes were frontend-focused with this one critical backend fix for the race condition.

## How to verify it

- [x] I have ensured `make check test` passes

Additional manual verification steps:
- Start a Claude Code session that takes a while to complete
- While Claude is running, verify you can type in the message input field
- Verify the placeholder shows "Enter message to interrupt..."
- Verify the button shows "Interrupt & Reply" with the R keyboard shortcut
- Press R while Claude is running and verify the input field appears
- Send a message and verify you see the visual feedback:
  - Input field becomes slightly transparent
  - Button changes to "Interrupting..."
  - Help text shows "Waiting for Claude to accept the interrupt..."
- Verify the interrupt successfully stops Claude's current response
- Verify the session transitions to "completed" without briefly showing as "failed"
- Test error scenarios to ensure message is preserved for retry
- Test with failed sessions to ensure input remains disabled
- Verify the UI looks good on mobile devices (shorter placeholder text)

## Description for the changelog

Enable user input during running Claude sessions with enhanced UX feedback, allowing users to interrupt or queue follow-up messages without waiting for completion. Includes clear visual indicators for interrupt status and processing, and fixes a race condition that caused interrupted sessions to briefly show as failed.