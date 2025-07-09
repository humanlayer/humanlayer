## What problem(s) was I solving?

The WUI model selector was broken - when users selected "Sonnet" or "Opus" models in the launch modal, the selection was silently ignored. This occurred because:
- The WUI was sending full model IDs (e.g., `"claude-3-5-sonnet-20241022"`) 
- The daemon only accepts simple strings: `"opus"` or `"sonnet"`
- Any unrecognized model value is silently ignored by the daemon

## What user-facing changes did I ship?

- **Fixed model selection**: Users can now successfully select Sonnet or Opus models when launching Claude Code sessions
- **Improved UI/UX**: Replaced the HTML select element with ShadCN Select component for better accessibility and consistent styling
- **Removed unsupported option**: Removed the Haiku model option since it's not supported by the daemon

## How I implemented it

The fix was straightforward - updated the model selector option values to match what the daemon expects:
- Changed from full model IDs to simple `"opus"` and `"sonnet"` strings
- Migrated from HTML `<select>` to ShadCN `<Select>` component for better UX
- Added the @radix-ui/react-select dependency to support the new component

The changes were confined to `CommandInput.tsx` where the model selector is rendered.

## How to verify it

- [x] I have ensured `make check test` passes

Manual verification steps:
1. Open the WUI and click "Launch Claude Code" 
2. Expand "Advanced Options"
3. Select "Sonnet" from the model dropdown
4. Launch the session
5. Verify Claude launches with the Sonnet model
6. Check session details shows "sonnet" as the model
7. Repeat steps 3-6 with "Opus" option

## Description for the changelog

fix(wui): Model selector now properly sends opus/sonnet values to daemon