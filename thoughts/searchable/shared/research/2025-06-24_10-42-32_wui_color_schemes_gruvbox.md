---
date: 2025-06-24 10:35:46 PDT
researcher: allison
git_commit: 454701ddcb7061d64ff8367d624590d72b0f64cc
branch: claude_and_uv
repository: humanlayer
topic: "WUI Color Schemes and Gruvbox Material Integration"
tags: [research, codebase, ui]
status: complete
last_updated: 2025-06-24
last_updated_by: allison
---

# Research: WUI Color Schemes and Gruvbox Material Integration

**Date**: 2025-06-24 10:35:46 PDT
**Researcher**: allison
**Git Commit**: 454701ddcb7061d64ff8367d624590d72b0f64cc
**Branch**: claude_and_uv
**Repository**: humanlayer
## Research Question

How are color schemes currently implemented in the wui? How might I add one? I cloned a theme I really like to `~/git/gruvbox-material`. What would it look like to be able to add this one? Do the formats match?

## Summary

The WUI uses a CSS custom properties system with predefined themes, while gruvbox-material is a Vim colorscheme. While the formats don't directly match, the color values from gruvbox-material can be easily adapted to create a new WUI theme by extracting the hex color values and mapping them to the WUI's terminal-inspired variable system.

## Detailed Findings

### WUI Color Scheme Implementation

#### Theme System Architecture

- **Storage**: Theme preference stored in localStorage with key `wui-theme`
- **Application**: Applied via `data-theme` attribute on document root
- **Context**: Custom ThemeContext manages theme state (`humanlayer-wui/src/contexts/ThemeContext.tsx:3-11`)
- **Default**: `solarized-dark` theme

#### Color Variable Structure

The WUI uses a two-tier CSS variable system (`humanlayer-wui/src/App.css:8-44`):

1. **Terminal variables** (direct color definitions):

   - `--terminal-bg`: Background color
   - `--terminal-bg-alt`: Alternative background
   - `--terminal-fg`: Foreground/text color
   - `--terminal-fg-dim`: Dimmed text
   - `--terminal-accent`: Primary accent color
   - `--terminal-accent-alt`: Secondary accent
   - `--terminal-border`: Border color
   - `--terminal-success`: Success state color
   - `--terminal-warning`: Warning state color
   - `--terminal-error`: Error state color

2. **Semantic variables** (mapped to terminal variables):
   - `--color-background: var(--terminal-bg)`
   - `--color-foreground: var(--terminal-fg)`
   - `--color-accent: var(--terminal-accent)`
   - etc.

#### Current Themes

Seven themes are defined (`humanlayer-wui/src/App.css:46-143`):

- `solarized-dark`
- `solarized-light`
- `cappuccino`
- `catppuccin`
- `high-contrast`
- `framer-dark`
- `framer-light`

### Gruvbox Material Format Analysis

#### Structure

Gruvbox Material is a Vim colorscheme with:

- **Location**: `~/git/gruvbox-material/autoload/gruvbox_material.vim`
- **Format**: Vim script with color arrays `['#hexcolor', 'terminalcode']`
- **Variants**: Three palettes (material, mix, original) with three contrast levels each

#### Color Values (Material palette, dark medium)

```vim
bg0:     ['#282828', '235']  " Main background
fg0:     ['#d4be98', '223']  " Main foreground
red:     ['#ea6962', '167']
orange:  ['#e78a4e', '208']
yellow:  ['#d8a657', '214']
green:   ['#a9b665', '142']
aqua:    ['#89b482', '108']
blue:    ['#7daea3', '109']
purple:  ['#d3869b', '175']
grey1:   ['#928374', '245']
```

## Code References

- `humanlayer-wui/src/App.css:46-143` - Theme color definitions
- `humanlayer-wui/src/contexts/ThemeContext.tsx:3-11` - Theme types and management
- `humanlayer-wui/src/components/ThemeSelector.tsx` - Theme switching UI
- `~/git/gruvbox-material/autoload/gruvbox_material.vim` - Gruvbox color palette

## Architecture Insights

### WUI Design Patterns

1. All colors defined as CSS custom properties
2. No hardcoded colors in components
3. Terminal-inspired naming convention
4. Theme applied via data attribute
5. Keyboard shortcut support (Ctrl+T)

### Format Compatibility

The formats don't directly match, but conversion is straightforward:

- **Gruvbox**: Vim arrays with hex colors and terminal codes
- **WUI**: CSS custom properties with hex colors only
- **Conversion**: Extract hex values from gruvbox arrays

## Historical Context (from thoughts/)

- WUI uses Tauri + React with Tailwind CSS v4
- Terminal-inspired design to match daemon purpose
- No shadcn/ui - custom components with Radix primitives
- Design decisions appear implementation-driven

## Implementation Guide for Adding Gruvbox Material

### Step 1: Extract Colors from Gruvbox

From `~/git/gruvbox-material/autoload/gruvbox_material.vim`, extract the hex values for the material palette.

### Step 2: Create Theme Definition

Add to `humanlayer-wui/src/App.css`:

```css
[data-theme='gruvbox-material'] {
  --terminal-bg: #282828; /* bg0 */
  --terminal-bg-alt: #32302f; /* bg1 */
  --terminal-fg: #d4be98; /* fg0 */
  --terminal-fg-dim: #928374; /* grey1 */
  --terminal-accent: #a9b665; /* green */
  --terminal-accent-alt: #89b482; /* aqua */
  --terminal-border: #504945; /* bg2 */
  --terminal-success: #a9b665; /* green */
  --terminal-warning: #d8a657; /* yellow */
  --terminal-error: #ea6962; /* red */
}
```

### Step 3: Register Theme

Update `humanlayer-wui/src/contexts/ThemeContext.tsx`:

```typescript
export const themes = [
  // ... existing themes
  'gruvbox-material',
] as const
```

### Step 4: Add to Theme Selector

Update `humanlayer-wui/src/components/ThemeSelector.tsx` to include the new theme with an appropriate icon.

## Open Questions

1. Should we support multiple gruvbox variants (hard/soft contrast)?
2. Should we add light mode support for gruvbox?
3. Would a theme import/export system be beneficial for custom themes?
