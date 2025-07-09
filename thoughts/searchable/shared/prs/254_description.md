## What problem(s) was I solving?

The session table search interface was missing a visual hint for the Tab key functionality that cycles through session status filters. Users had no way to discover this keyboard shortcut without documentation or trial and error.

## What user-facing changes did I ship?

- Added a small, unobtrusive keyboard hint below the search bar that shows "cycle session status with TAB"
- The hint uses a styled `<kbd>` element to clearly indicate it's a keyboard shortcut
- Positioned the hint at the bottom right of the search component with appropriate styling to match the UI theme

## How I implemented it

- Modified the `SessionTableSearch` component to wrap the existing content in a flex column layout
- Added a new row below the search bar containing the keyboard hint text
- Used existing Tailwind classes and component styles to ensure visual consistency
- The hint is always visible and uses muted text color to avoid being distracting

## How to verify it

- [x] I have ensured `make check test` passes
- [ ] Navigate to the sessions table view in the HumanLayer WUI
- [ ] Observe the new keyboard hint below the search bar
- [ ] Press Tab to verify it still cycles through session status filters as expected
- [ ] Verify the hint text is readable but not intrusive

## Description for the changelog

Add keyboard hint for Tab key session status cycling in WUI search interface