---
date: 2025-07-09 15:01:02 PDT
researcher: allison
git_commit: 65080b2e1dae9040e9476bce49a3022b04337d6c
branch: main
repository: humanlayer
topic: "WUI Chat Input Multi-line Text and Wrapping Issues"
tags: [research, codebase, wui, humanlayer-wui, chat-interface, text-input, ux]
status: complete
last_updated: 2025-07-09
last_updated_by: allison
---

# Research: WUI Chat Input Multi-line Text and Wrapping Issues

**Date**: 2025-07-09 15:01:02 PDT
**Researcher**: allison
**Git Commit**: 65080b2e1dae9040e9476bce49a3022b04337d6c
**Branch**: main
**Repository**: humanlayer

## Research Question
It's annoying I can't write multi-line text in continue conversation chat box. Well it's more annoying that text doesn't wrap automatically. It feels disorientating to write longer prompts in wui. The text just goes on and on and on and is rather small by default too. Research where in the wui (humanlayer-wui) this logic might exist?

## Summary
The WUI chat interface uses a single-line HTML `<input>` element instead of a `<textarea>`, which explains why multi-line text and automatic text wrapping aren't supported. The input component is located in `ResponseInput.tsx` and uses the base `Input` component. Text size is responsive but relatively small (text-sm/14px on mobile, text-base/16px on desktop). The keyboard handler intentionally prevents multi-line input by submitting on Enter key.

## Detailed Findings

### Input Component Architecture

#### Base Input Component
- Located at `humanlayer-wui/src/components/ui/input.tsx:5-18`
- Wraps a standard HTML `<input>` element (not `<textarea>`)
- Fixed height of `h-9` (36px)
- Font size: `text-base` on desktop, `md:text-sm` on smaller screens
- Font family: `font-mono` (IBM Plex Mono)
- **Critical limitation**: HTML `<input>` elements cannot display multi-line text or wrap text

#### ResponseInput Component
- Located at `humanlayer-wui/src/components/internal/SessionDetail/components/ResponseInput.tsx:53-61`
- Uses the base `Input` component for conversation messages
- No props for multiline, wrap, or text size customization
- Handles keyboard events via `handleResponseInputKeyDown`

### Keyboard Handling and Behavior

#### Session Actions Hook
- Located at `humanlayer-wui/src/components/internal/SessionDetail/hooks/useSessionActions.ts:66-75`
- `handleResponseInputKeyDown` function:
  - Enter key (without Shift) sends the message
  - Shift+Enter is detected but doesn't enable multiline
  - Escape key cancels input
- **Intentional design**: Single-line input with Enter to send

### Text Styling and Size

#### Input Text Sizes
- Base inputs: `text-base` (16px) on desktop, `text-sm` (14px) on mobile
- Command input: Enhanced with `text-base` consistently and `leading-relaxed`
- No configuration options for increasing text size

#### Message Display vs Input
- **Displayed messages** use `whitespace-pre-wrap` for proper text wrapping
- **Input field** cannot wrap due to HTML `<input>` limitations

### Missing Components

1. **No Textarea Component**: The UI library has no textarea wrapper component
2. **No Multiline Support**: No infrastructure for multi-line text input
3. **No Text Wrapping**: HTML `<input>` elements cannot wrap text
4. **No Size Configuration**: No props or settings to adjust text size

## Code References
- `humanlayer-wui/src/components/ui/input.tsx:5-18` - Base Input component definition
- `humanlayer-wui/src/components/internal/SessionDetail/components/ResponseInput.tsx:53-61` - Chat input implementation
- `humanlayer-wui/src/components/internal/SessionDetail/hooks/useSessionActions.ts:66-75` - Keyboard handling logic
- `humanlayer-wui/src/App.css:178` - Global font family definition (IBM Plex Mono)

## Architecture Insights

1. **Component Hierarchy**: ResponseInput → Input → HTML input element
2. **Design Pattern**: Single-line chat inputs with Enter to send (common in chat UIs)
3. **Styling System**: Tailwind CSS with responsive breakpoints
4. **No Component Variants**: Input component has no textarea variant

## Historical Context (from thoughts/)
- Recent research on enabling chat input during running sessions (`thoughts/shared/research/2025-06-30_11-13-49_claude_message_queuing_spec.md`)
- Multiple UI improvements post-refactor, but no mention of input field issues
- Focus has been on message display, loading states, and tool outputs
- No documented complaints or plans about text input wrapping/multiline support

## Related Research
- `thoughts/shared/research/2025-07-08_12-41-49_wui_post_refactor_improvements.md` - UI improvements after refactoring
- `thoughts/shared/plans/wui_quick_win_improvements.md` - Quick UI improvements (no input field mentions)

## Open Questions
1. Was single-line input an intentional UX decision or technical limitation?
2. Would a textarea break the current keyboard shortcut patterns?
3. How would multiline input affect the send button and layout?
4. Should text size be configurable via settings or responsive to browser zoom?