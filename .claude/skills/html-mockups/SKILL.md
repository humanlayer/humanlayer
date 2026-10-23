---
name: html-mockups
description: if the user asks for an html mockup for ui components or screens
---

## Output Location

Write mockups to the task directory if one exists:
- `.humanlayer/tasks/{task-slug}/mockup-{description}.html`

Or to a reasonable location the user specifies.

Each mockup must be a single self-contained file: put all CSS in a `<style>` block and all JS in a
`<script>` block. Do not split shared styles or scripts into sibling files. The cloud viewer serves
every artifact from its own signed URL, so an HTML file that links to a sibling `.css` or `.js` file
renders unstyled there even though it looks right when opened from disk.

## Design System: Poimandres Theme

### Color Palette

```css
:root {
  /* Backgrounds */
  --terminal-bg: #1b1e28;           /* Primary background - very dark blue-gray */
  --terminal-bg-alt: #303340;       /* Secondary/elevated background */

  /* Text */
  --terminal-fg: #a6accd;           /* Primary text - muted purple-gray */
  --terminal-fg-dim: #767c9d;       /* Secondary/muted text */

  /* Semantic Colors */
  --terminal-accent: #add7ff;       /* Primary accent - bright cyan blue */
  --terminal-success: #5de4c7;      /* Success/positive - mint green */
  --terminal-warning: #fffac2;      /* Warning/caution - pale yellow */
  --terminal-error: #d0679d;        /* Error/destructive - pink/magenta */

  /* Borders & Inputs */
  --terminal-border: #303340;       /* Border color - matches bg-alt */
  --terminal-input-bg: #ffffff05;   /* Input background - 5% white */
  --terminal-input-border: #ffffff10; /* Input border - 10% white */
  --terminal-selection: #717cb425;  /* Selection highlight */

  /* Derived */
  --terminal-accent-dim: rgba(173, 215, 255, 0.3);  /* 30% accent */
}
```

### Typography

- **Font Family**: `'JetBrains Mono', 'Fira Code', monospace`
- **Base Size**: 13px for body text
- **Labels**: 10-11px, uppercase, letter-spacing 1-1.5px
- **Buttons**: 10-11px, uppercase, letter-spacing 1-1.5px, font-weight 500

### Button Styling

All buttons use these base styles:
- **Border radius**: 0 (fully square corners - `rounded-none`)
- **Border**: 1px solid
- **Font**: Monospace, uppercase, letter-spacing
- **Transition**: 0.15s for all properties

#### Button Variants

**Default (Accent)**
```css
.btn-default {
  background: rgba(173, 215, 255, 0.2);  /* 20% accent */
  color: #add7ff;                         /* accent text */
  border-color: #add7ff;                  /* accent border */
}
.btn-default:hover {
  background: #add7ff;                    /* solid accent */
  color: #1b1e28;                         /* dark text */
}
```

**Ghost**
```css
.btn-ghost {
  background: transparent;
  color: #767c9d;                         /* dim text */
  border-color: #303340;                  /* border color */
}
.btn-ghost:hover {
  background: rgba(173, 215, 255, 0.1);   /* 10% accent */
  border-color: #add7ff;
  color: #add7ff;
}
```

**Destructive**
```css
.btn-destructive {
  background: transparent;
  color: #d0679d;                         /* error */
  border-color: #d0679d;
}
.btn-destructive:hover {
  background: #d0679d;
  color: #1b1e28;
}
```

**Loud Success CTA** (for primary actions like "Proceed to Next Step")
```css
.btn-loud-success {
  background: transparent;
  color: #5de4c7;                         /* success */
  border-color: #5de4c7;
  animation: pulse-success 2s ease-in-out infinite;
}
.btn-loud-success:hover {
  background: rgba(93, 228, 199, 0.1);    /* 10% success */
}

@keyframes pulse-success {
  0%, 100% { box-shadow: 0 0 0 0 rgba(93, 228, 199, 0.4); }
  50% { box-shadow: 0 0 0 4px rgba(93, 228, 199, 0); }
}
```

### Semantic Button Patterns

For toggle buttons that indicate state (like action buttons in bottom tray):

**Success State (enabled)**
```css
.btn-icon.active-success {
  background: rgba(93, 228, 199, 0.15);   /* 15% success */
  color: #5de4c7;
  border-color: rgba(93, 228, 199, 0.3);  /* 30% success */
}
.btn-icon.active-success:hover {
  background: rgba(93, 228, 199, 0.25);   /* 25% success */
  border-color: #5de4c7;
}
```

**Warning State (enabled)**
```css
.btn-icon.active-warning {
  background: rgba(255, 250, 194, 0.15);  /* 15% warning */
  color: #fffac2;
  border-color: rgba(255, 250, 194, 0.3); /* 30% warning */
}
.btn-icon.active-warning:hover {
  background: rgba(255, 250, 194, 0.25);  /* 25% warning */
  border-color: #fffac2;
}
```

**Error State (enabled)**
```css
.btn-icon.active-error {
  background: rgba(208, 103, 157, 0.15);  /* 15% error */
  color: #d0679d;
  border-color: rgba(208, 103, 157, 0.4); /* 40% error */
}
.btn-icon.active-error:hover {
  background: rgba(208, 103, 157, 0.25);  /* 25% error */
  border-color: #d0679d;
}
```

### Component Patterns

#### Container with Left Border Indicator
```css
.input-wrapper {
  border-left: 2px solid var(--terminal-accent);
  padding-left: 12px;
  margin-left: 4px;
}

/* Focused state */
.input-wrapper.focused {
  border-left-color: var(--terminal-accent);
}

/* Error/deny state */
.input-wrapper.error {
  border-left-color: var(--terminal-error);
}
```

#### Status Badge
```css
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: var(--terminal-bg-alt);
  border: 1px solid var(--terminal-border);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.status-badge.ready {
  color: var(--terminal-success);
  border-color: var(--terminal-success);
  background: rgba(93, 228, 199, 0.1);
}
```

#### Keyboard Shortcut
```css
.kbd {
  display: inline-block;
  padding: 1px 4px;
  font-size: 9px;
  background: var(--terminal-bg-alt);
  border: 1px solid var(--terminal-border);
  color: var(--terminal-fg-dim);
  margin-left: 4px;
}
```

#### Card/Panel
```css
.panel {
  background: var(--terminal-bg);
  border: 1px solid var(--terminal-border);
  padding: 24px;
}

.panel-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: var(--terminal-fg-dim);
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--terminal-border);
}
```

#### Form Elements
```css
input, select, textarea {
  width: 100%;
  background: var(--terminal-bg-alt);
  border: 1px solid var(--terminal-border);
  color: var(--terminal-fg);
  padding: 10px 12px;
  font-family: inherit;
  font-size: 13px;
}

input:focus, select:focus, textarea:focus {
  outline: none;
  border-color: var(--terminal-accent);
}

label {
  display: block;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--terminal-fg-dim);
  margin-bottom: 8px;
}
```

### Layout Patterns


### Icon Styling
```css
.icon {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.icon-sm {
  width: 12px;
  height: 12px;
}
```

### Annotation Pattern (for mockup notes)
```css
.annotation {
  margin-top: 20px;
  padding: 16px;
  background: rgba(173, 215, 255, 0.05);
  border: 1px dashed var(--terminal-border);
}

.annotation-title {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--terminal-accent);
  margin-bottom: 12px;
}
```

## HTML Template

Start mockups with this template:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mockup - [Description]</title>
  <style>
    :root {
      --terminal-bg: #1b1e28;
      --terminal-bg-alt: #303340;
      --terminal-fg: #a6accd;
      --terminal-fg-dim: #767c9d;
      --terminal-accent: #add7ff;
      --terminal-border: #303340;
      --terminal-success: #5de4c7;
      --terminal-warning: #fffac2;
      --terminal-error: #d0679d;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      background: #0d0f14;
      color: var(--terminal-fg);
      padding: 40px;
      line-height: 1.5;
    }

    h1 {
      color: var(--terminal-accent);
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 2px;
      margin-bottom: 40px;
      text-align: center;
    }

    /* Add component styles here */
  </style>
</head>
<body>
  <h1>Mockup Title</h1>

  <!-- Mockup content here -->

</body>
</html>
```

## Guidelines

1. **Keep it rough** - Mockups are for exploration, not pixel-perfect designs
3. **Include annotations** - Add notes explaining behavior, states, interactions
4. **Show multiple states** - Before/after, hover states, error states
5. **Use real-ish content** - Don't use lorem ipsum, use realistic labels
6. **Square corners everywhere** - No border-radius except explicit rounded elements
7. **Uppercase labels** - All labels, buttons, section headers are uppercase
8. **Monospace everything** - The entire UI uses monospace fonts


## Next Steps

When you've finished the mockup, you can display it to the user in your next message or in a task document (e.g. design discussion, plan, etc.) with the following syntax:

```task-artifact
path/to/mockup.html
```
