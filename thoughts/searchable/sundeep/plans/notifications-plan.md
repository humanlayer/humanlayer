# What we're trying to do

* We're going to add notifications to the humanlayer-wui project. The first type of notification we're going to fire off is to notify users when a given session is in the "waiting_input" state.
* Clicking through to a notification should bring the user into a SessionDetail 
* We're talking about two types of notifications here:
  * When the user has is in the app, we should use Sonner (ShadCN's recommended toast library): https://ui.shadcn.com/docs/components/sonner
  * When the app is out of view, we should fallback to OS-level notifications (there's a supporting doc in this file)

---

# Implementation Plan

## Architecture Overview

Based on the codebase exploration, here's how notifications will integrate with the existing architecture:

1. **Event Flow**: `hld` daemon → Event Bus → WebSocket → `humanlayer-wui` → Notification System
2. **Session Status**: The `SessionStatus.WaitingInput` enum value already exists in both TypeScript and Go
3. **Event Subscription**: The app already subscribes to `session_status_changed` events via `useSessionSubscriptions`

## Phase 1: Core Infrastructure

### 1.1 Add Tauri Notification Plugin (Rust)
- Add `tauri-plugin-notification` to `humanlayer-wui/src-tauri/Cargo.toml`
- Initialize the plugin in `main.rs`
- This enables OS-level notifications from the frontend

### 1.2 Create Notification Service (TypeScript)
- Create `src/services/NotificationService.ts` with:
  - `showInAppNotification(title, body, sessionId)` - Uses Sonner
  - `showOSNotification(title, body, sessionId)` - Uses Tauri plugin
  - `notifySessionWaitingInput(sessionId, query)` - Main entry point
  - Focus detection logic to choose notification type
  - `isViewingSession(sessionId)` - Check if user is on SessionDetail page for this session
  - Skip all notifications if user is already viewing the relevant session

### 1.3 Add Sonner for In-App Notifications
- Install Sonner: `bun add sonner`
- Add `<Toaster />` from Sonner to the root layout
- Configure Sonner theme to match app theme (light/dark mode support)
- Customize toast position and duration

## Phase 2: Integration Points

### 2.1 Hook into Event Subscription
- Modify `useSessionSubscriptions` hook to detect `waiting_input` status changes
- When a session transitions TO `waiting_input`, trigger notification
- Track notified sessions to avoid duplicate notifications

### 2.2 Create Notification State Management
- Add to `AppStore.ts`:
  - `notifiedSessions: Set<string>` - Track which sessions have been notified
  - `addNotifiedSession(sessionId)` - Mark session as notified
  - `clearNotifiedSession(sessionId)` - Clear when session leaves waiting_input

### 2.3 Handle Notification Clicks
- For in-app toasts: Navigate to `/session/:id` on click
- For OS notifications: Bring window to front, then navigate
- Use React Router's `useNavigate` for navigation

## Phase 3: User Experience

### 3.1 Focus Detection
- Use `document.hidden` and window `blur`/`focus` events
- Debounce focus changes to avoid notification spam
- Consider user preferences (future: settings panel)
- **Special case**: If user is viewing the SessionDetail page for the session that needs notification, suppress all notifications (both in-app and OS-level)

### 3.2 Notification Content
- Title: "Action Required"
- Body: Truncated session query (max 100 chars)
- Include session model info if available
- Sonner supports rich content (icons, actions) for better UX

### 3.3 Edge Cases
- Multiple simultaneous waiting_input sessions
- Rapid status changes
- App startup with existing waiting_input sessions

## Phase 4: Testing & Polish

### 4.1 Manual Testing Scenarios
- App in foreground → Sonner toast appears
- App in background → OS notification appears
- Click notification → Navigate to session
- Multiple sessions waiting → All get notified
- Test Sonner's built-in features (dismiss, action buttons)

### 4.2 Future Enhancements
- User preferences for notification behavior
- Sound/vibration options
- Notification grouping for multiple sessions
- Rich notifications with action buttons

## Implementation Order

1. **Day 1**: Infrastructure setup (Tauri plugin, Sonner integration, NotificationService)
2. **Day 2**: Event integration and state management
3. **Day 3**: Navigation handling and focus detection
4. **Day 4**: Testing and edge case handling

## Technical Decisions

- **Why separate notification types?**: Better UX - Sonner toasts for active users, OS notifications for background
- **Why track notified sessions?**: Prevents notification spam on reconnects or refreshes  
- **Why use Tauri plugin vs native?**: Cross-platform compatibility, simpler API
- **Why not use browser Notification API?**: Tauri provides better native integration
- **Why Sonner over custom toast?**: Rich features out-of-box, maintained by ShadCN team, better accessibility

---

# Supporting Docs from ChatGPT Deep Research

Great — you’re on solid ground. Yes, Tauri supports OS-level notifications on Windows, macOS, and Linux, and they can be triggered from JavaScript using Tauri’s JS API. You don’t need to bounce through Rust unless you want advanced behavior or deeper native integration.

🔔 How Tauri Notifications Work

Tauri uses the tauri-plugin-notification under the hood for cross-platform notification support. This gives you a simple JavaScript API to display system notifications.

⸻

✅ Basic Setup
	1.	Install the plugin

cargo add tauri-plugin-notification

And in src-tauri/src/main.rs:

use tauri_plugin_notification::init;

fn main() {
    tauri::Builder::default()
        .plugin(init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

	2.	Use it from JavaScript

In your frontend JS/TS:

import { notify } from '@tauri-apps/plugin-notification';

notify('Hello from Tauri!');

You can also use:

notify({
  title: 'Reminder',
  body: 'You have an unread message.',
});

This uses the default system notification handler on macOS, Windows (via toast), and Linux (via notify-send or D-Bus).

⸻

🔁 Check if App Is in Focus

To detect whether the app is out of focus before showing a notification:

window.addEventListener('blur', () => {
  // Maybe start a timeout or set a flag
});

window.addEventListener('focus', () => {
  // Clear notification flag
});

Or use document.hidden to detect visibility:

if (document.hidden) {
  notify({ title: 'Hey!', body: 'Come back to the app' });
}


⸻

⏎ Handling Clicks to Bring App to Front

Notifications can bring your Tauri window back when clicked, but this part must go through Rust. You’ll need to:
	1.	Use the tauri-plugin-notification API to emit an event to the Rust backend.
	2.	In Rust, listen for the notification click and bring the window to focus.

However, Tauri’s plugin doesn’t currently expose click handlers directly — so if you need deep control over click behavior, you’d have to wire up a custom Rust-side notification system, using something like notify-rust, NSUserNotificationCenter, or Windows toast API directly.

But for now, if you just want the notification to be clickable and launch the app (when it’s closed or minimized), that works out of the box on most OSes.

⸻

👇 Summary

Feature	Tauri Support
Cross-platform notifications	✅ Built-in via plugin
Trigger from JS	✅ Yes
Detect app visibility in JS	✅ document.hidden
Bring window to front on click	⚠️ Workaround via Rust
Notification buttons/actions	❌ Not yet (limited API)


⸻

Want an example project?

I can scaffold a minimal Tauri project that shows a notification when the window is not focused and lets you test it interactively. Let me know!
