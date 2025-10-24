# Hotkeys Documentation

## Keyboard Layout Support

CodeLayer supports both QWERTY and non-QWERTY keyboard layouts (DVORAK, Colemak, etc.) through configurable hotkey matching.

### Configuration

You can choose how hotkeys respond to your keyboard layout in **Settings > Keyboard Layout Support**:

- **Character-based (Default)**: Hotkeys respond to the character produced by the key. This is recommended for DVORAK, Colemak, and other non-QWERTY layouts.
- **Position-based**: Hotkeys respond to the physical position of the key on the keyboard, regardless of your layout.

### Examples

For DVORAK users with character-based matching:

- Pressing the physical `j` key (which produces 'c' in DVORAK) will NOT trigger vim down navigation
- Pressing the physical `c` key (which produces 'j' in DVORAK) WILL trigger vim down navigation
- This matches the expected behavior in vim and other DVORAK-aware applications

### Technical Implementation

All hotkeys in CodeLayer use a wrapper around `react-hotkeys-hook` that respects your keyboard layout preference. The preference is stored in localStorage and applied to all hotkey registrations.

## Hotkey Reference

### Global Navigation

- `c` - Create new session
- `g>s` - Go to sessions view
- `g>a` - Go to archived sessions
- `?` - Toggle this hotkey help panel

### Session List (Vim-style)

- `j` - Move down
- `k` - Move up
- `h` - Collapse session
- `l` - Expand session
- `g>g` - Jump to first session
- `Shift+G` - Jump to last session
- `Enter` - Open selected session

### Session Detail

- `Escape` - Close session detail
- `Cmd/Ctrl+Enter` - Send message
- `Cmd/Ctrl+Shift+C` - Copy session
- `a` - Approve action
- `r` - Request changes
- `d` - Deny action

### Modals

- `Escape` - Close modal
- `Enter` - Confirm action

## Troubleshooting

### Hotkeys not working as expected?

1. **Check your keyboard layout setting** in Settings > Keyboard Layout Support
2. **For DVORAK users**: Ensure "Character-based" is selected
3. **For remapped keys**: You may need to use "Position-based" if you've remapped keys at the OS level
4. **After changing the setting**: The page will reload to apply changes to all hotkeys

### Testing your configuration

1. Open the session list
2. Try navigating with `j` and `k`
3. If navigation doesn't work, toggle the keyboard layout setting and try again

## Development Notes

When adding new hotkeys:

1. Always use the `useHotkeys` wrapper from `@/hooks/useHotkeys`
2. Never import directly from `react-hotkeys-hook`
3. The wrapper automatically applies the user's keyboard layout preference
4. To override for specific hotkeys, pass `useKey: true/false` explicitly in options
