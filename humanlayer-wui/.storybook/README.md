# Storybook Configuration

This directory contains the Storybook configuration for the humanlayer-wui project.

## Configuration Files

- `main.ts` - Main Storybook configuration with framework settings and plugin configurations
- `preview.ts` - Preview configuration with theme support and global decorators

## Features

- **React 19** support with TypeScript
- **Vite 6** integration for fast builds and hot reloading
- **Tailwind CSS 4** styling with full theme system support
- **Theme Switching** - All project themes available via toolbar
- **Radix UI Components** - Full support for existing component library
- **TypeScript** - Full type checking and IntelliSense support

## Usage

### Development Server

```bash
bun run storybook
```

Starts Storybook on http://localhost:6006

### Build Static Version

```bash
bun run build-storybook
```

Builds static Storybook files to `storybook-static/`

## Theme Support

The configuration includes support for all existing project themes:

- Solarized Dark (default)
- Solarized Light
- Cappuccino
- Catppuccin
- High Contrast
- Framer Dark/Light
- Gruvbox Dark/Light
- Monokai
- Launch
- Rosé Pine variants

Use the theme selector in the Storybook toolbar to switch between themes while developing.

## Story Files

Stories are automatically discovered from:

- `src/**/*.stories.@(js|jsx|mjs|ts|tsx)`

## TypeScript

TypeScript checking is disabled in Storybook for faster builds, but full type inference and checking is available in your editor.
