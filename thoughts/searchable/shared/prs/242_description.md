## What problem(s) was I solving?

The WUI had a limited selection of 7 color themes, missing popular warm-toned themes that many developers prefer. After conducting research on the Gruvbox Material colorscheme (a popular Vim theme known for its warm, earthy tones and reduced eye strain), I identified an opportunity to expand the theme options to better serve user preferences.

## What user-facing changes did I ship?

- Added two new theme options to the WUI theme selector: "Gruvbox Dark" and "Gruvbox Light"
- Both themes are now available in the theme selector dropdown (accessible via the palette icon or Ctrl+T)
- Users can switch to these themes for a warmer, more comfortable viewing experience with earthy color tones

## How I implemented it

Based on the research documented in `thoughts/shared/research/2025-06-24_10-42-32_wui_color_schemes_gruvbox.md`, I:

1. Extracted color values from the Gruvbox Material palette (medium contrast variant)
2. Added CSS custom property definitions for both themes in `humanlayer-wui/src/App.css`:
   - `gruvbox-dark`: Dark theme with warm background (#282828) and muted accent colors
   - `gruvbox-light`: Light theme with cream background (#fbf1c7) and complementary colors
3. Updated the TypeScript theme type in `humanlayer-wui/src/contexts/ThemeContext.tsx` to include the new theme options
4. Added the themes to the theme selector component in `humanlayer-wui/src/components/ThemeSelector.tsx` with Box icons

The implementation follows the existing WUI pattern of using CSS custom properties with the `data-theme` attribute, ensuring consistency with the current theme system.

## How to verify it

- [x] I have ensured `make check test` passes

Manual verification steps:

- [ ] Launch the WUI application
- [ ] Open the theme selector (click palette icon or press Ctrl+T)
- [ ] Select "Gruvbox Dark" theme and verify the dark warm-toned colors are applied
- [ ] Select "Gruvbox Light" theme and verify the light cream-toned colors are applied
- [ ] Verify theme persistence by refreshing the page
- [ ] Check that all UI elements (buttons, borders, text, status indicators) display correctly with appropriate contrast

## Description for the changelog

Add Gruvbox Dark and Light themes to WUI for users who prefer warm, earthy color tones
