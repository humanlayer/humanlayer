---
title: "OpenCode Web Interface Component Specification"
category: "Component Specification"
tags: ["web", "astro", "solid-js", "starlight", "documentation", "share", "ui"]
version: "1.0.0"
last_updated: "2025-01-26"
architecture_layer: "presentation"
dependencies:
  - "opencode/session"
  - "@astrojs/starlight"
  - "solid-js"
  - "shiki"
  - "marked"
related_specs:
  - "opencode_core_spec.md"
  - "session_management_spec.md"
author: "OpenCode Team"
---

# OpenCode Web Interface Component Specification

## Executive Summary

The OpenCode Web Interface (`packages/web/`) is a comprehensive documentation and session sharing web application built on Astro with Starlight for documentation and Solid.js for interactive components. It serves as both the public documentation site and the dynamic session viewer for shared OpenCode coding sessions.

## Architecture Overview

### Technology Stack
- **Framework**: [Astro 5.7.13](file:///Users/allison/git/opencode/packages/web/package.json#L21) with SSR
- **UI Framework**: [Solid.js 1.9.7](file:///Users/allison/git/opencode/packages/web/package.json#L30) for reactive components
- **Documentation**: [Starlight 0.34.3](file:///Users/allison/git/opencode/packages/web/package.json#L16) (Astro docs framework)
- **Syntax Highlighting**: [Shiki 3.4.2](file:///Users/allison/git/opencode/packages/web/package.json#L29)
- **Markdown Processing**: [Marked 15.0.12](file:///Users/allison/git/opencode/packages/web/package.json#L26)
- **Deployment**: [Cloudflare](file:///Users/allison/git/opencode/packages/web/astro.config.mjs#L18-L20) with image passthrough
- **Styling**: CSS Modules with CSS custom properties

### Core Components

## File Structure Analysis

### Configuration Files

#### [`package.json`](file:///Users/allison/git/opencode/packages/web/package.json)
**Purpose**: Package configuration and dependency management
- **Dependencies**: 
  - Core: Astro, Solid.js, Starlight
  - Syntax: Shiki, lang-map for language detection
  - UI: marked, diff, luxon for date/time
  - Fonts: IBM Plex Mono
- **Scripts**: Standard Astro development workflow
- **Workspace Integration**: References `opencode` workspace package

#### [`astro.config.mjs`](file:///Users/allison/git/opencode/packages/web/astro.config.mjs)
**Purpose**: Astro framework configuration with Starlight integration
- **Output**: Server-side rendering with Cloudflare adapter
- **Integrations**:
  - Solid.js for reactive components
  - Starlight for documentation with custom Hero/Header components
  - Rehype plugins for heading auto-linking
- **Site Configuration**: 
  - URL: https://opencode.ai
  - GitHub: https://github.com/sst/opencode
  - Custom logo, sidebar navigation
- **Theme**: Dual theme support (github-light/github-dark)

#### [`config.mjs`](file:///Users/allison/git/opencode/packages/web/config.mjs)
**Purpose**: Site-wide configuration constants
- **GitHub Repository**: Central source of truth
- **Header Links**: Navigation structure

#### [`tsconfig.json`](file:///Users/allison/git/opencode/packages/web/tsconfig.json)
**Purpose**: TypeScript configuration for Astro + Solid.js
- **JSX**: Preserve mode with solid-js import source
- **Extends**: Astro strict TypeScript configuration

### Content Management

#### [`src/content.config.ts`](file:///Users/allison/git/opencode/packages/web/src/content.config.ts)
**Purpose**: Astro content collection configuration
- **Collections**: Single `docs` collection using Starlight schema
- **Content Types**: MDX files with frontmatter validation

#### Content Structure
Documentation content organized in [`src/content/docs/`](file:///Users/allison/git/opencode/packages/web/src/content/docs/):
- **Landing Page**: [`index.mdx`](file:///Users/allison/git/opencode/packages/web/src/content/docs/index.mdx) - Splash template with hero
- **Documentation Pages**: CLI, config, models, themes, keybinds, MCP/LSP servers

### Page Components

#### [`src/pages/s/[id].astro`](file:///Users/allison/git/opencode/packages/web/src/pages/s/[id].astro)
**Purpose**: Dynamic session sharing page with server-side data fetching
**Functionality**:
- **Route**: `/s/{session-id}` for shared sessions
- **Data Fetching**: Server-side fetch from API endpoint
- **SEO**: Dynamic OG image generation with session metadata
- **Error Handling**: 404 for missing sessions
- **Integration**: Embeds Share component with session data

**Key Features**:
- Base64 title encoding for social cards
- Model and version metadata extraction
- Custom social card URL generation
- Starlight page wrapper with custom frontmatter

### Astro Components

#### [`src/components/Header.astro`](file:///Users/allison/git/opencode/packages/web/src/components/Header.astro)
**Purpose**: Custom header component with conditional rendering
**Functionality**:
- **Route Detection**: Different layout for `/s/*` (share) pages vs documentation
- **Share Pages**: Minimal header with logo and basic navigation
- **Documentation**: Default Starlight header with full navigation
- **Responsive**: Mobile-first design with breakpoint-based visibility

**Styling Features**:
- CSS Grid layout for complex responsive behavior
- Dynamic grid column calculations
- Social icon integration

#### [`src/components/Hero.astro`](file:///Users/allison/git/opencode/packages/web/src/components/Hero.astro)
**Purpose**: Hero component router for different page types
**Functionality**:
- **Landing Page**: Custom Lander component for home page
- **Other Pages**: Default Starlight hero component
- **Route Detection**: Based on slug from Starlight route

#### [`src/components/Lander.astro`](file:///Users/allison/git/opencode/packages/web/src/components/Lander.astro)
**Purpose**: Custom landing page hero with installation command and features
**Functionality**:
- **Interactive Install**: Copy-to-clipboard installation command
- **Feature Showcase**: Key OpenCode capabilities
- **Visual Elements**: Screenshot gallery with theme examples
- **Responsive Design**: Mobile-first with adaptive layouts

**Interactive Features**:
- **Copy Command**: JavaScript clipboard integration with success feedback
- **Command Display**: Responsive command formatting
- **Visual States**: Copy/success icon transitions

**Content Sections**:
1. **Hero**: Logo, tagline, call-to-action
2. **CTA**: Docs link, install command, GitHub link
3. **Features**: Native TUI, LSP, multi-session, shareable links, Claude Pro, multi-model
4. **Gallery**: Theme screenshots
5. **Footer**: Version info, SST attribution

### Solid.js Components

#### [`src/components/Share.tsx`](file:///Users/allison/git/opencode/packages/web/src/components/Share.tsx)
**Purpose**: Main session sharing interface with real-time updates
**Architecture**: Complex Solid.js component with WebSocket integration

**Core Functionality**:
- **Real-time Updates**: WebSocket connection for live session data
- **Message Rendering**: Complex message part rendering system
- **UI Components**: Expandable sections, syntax highlighting, diff views
- **Session Metadata**: Cost, tokens, models, timing information

**WebSocket Integration**:
```typescript
// Connection management with auto-reconnect
const setupWebSocket = () => {
  const wsUrl = `${wsBaseUrl}/share_poll?id=${id}`
  socket = new WebSocket(wsUrl)
  // Event handlers for open, message, error, close
}
```

**State Management**:
- **Store**: Solid.js store for session info and messages
- **Connection Status**: Reactive connection state
- **Message Sorting**: Chronological message ordering

**Message Part Rendering**:
- **User Text**: Plain text with invert styling
- **AI Text**: Markdown rendering with syntax highlighting  
- **Tool Invocations**: Structured tool call display with arguments and results
- **File Operations**: Read, write, edit operations with syntax highlighting
- **Terminal Commands**: Command execution with result display
- **Diagnostics**: LSP diagnostic error display

**UI Components**:
- `TextPart`: Expandable plain text with overflow handling
- `MarkdownPart`: Markdown rendering with expand/collapse
- `TerminalPart`: Command execution display
- `ErrorPart`: Error message formatting
- `ResultsButton`: Show/hide results toggle
- `AnchorIcon`: Deep-link anchor with copy functionality

**Utility Functions**:
- `stripWorkingDirectory`: Path normalization
- `getShikiLang`: Language detection from file extensions
- `formatDuration`: Human-readable time formatting
- `flattenToolArgs`: Nested object flattening for display
- `sortTodosByStatus`: Todo list organization

#### [`src/components/MarkdownView.tsx`](file:///Users/allison/git/opencode/packages/web/src/components/MarkdownView.tsx)
**Purpose**: Markdown rendering component with async processing
**Implementation**:
- **Library**: Uses `marked` for markdown parsing
- **Reactive**: Solid.js `createResource` for async rendering
- **Styling**: CSS module integration
- **Props**: Standard HTML div attributes with markdown prop

#### [`src/components/CodeBlock.tsx`](file:///Users/allison/git/opencode/packages/web/src/components/CodeBlock.tsx)
**Purpose**: Syntax-highlighted code display using Shiki
**Features**:
- **Syntax Highlighting**: Shiki with dual theme support (github-light/dark)
- **Language Detection**: Configurable language with fallback to text
- **Diff Support**: transformerNotationDiff for diff highlighting
- **Callback**: onRendered callback for layout calculations
- **Resource Management**: Proper cleanup on component destruction

**Configuration**:
```typescript
const [html] = createResource(() => [local.code, local.lang], async ([code, lang]) => {
  return await codeToHtml(code || "", {
    lang: lang || "text", 
    themes: { light: "github-light", dark: "github-dark" },
    transformers: [transformerNotationDiff()],
  })
})
```

#### [`src/components/DiffView.tsx`](file:///Users/allison/git/opencode/packages/web/src/components/DiffView.tsx)
**Purpose**: Side-by-side diff visualization with responsive design
**Features**:
- **Diff Parsing**: Uses `diff` library for patch parsing
- **Responsive**: Desktop side-by-side, mobile stacked
- **Row Types**: Added, removed, unchanged, modified
- **Syntax Highlighting**: Integrated CodeBlock components
- **Smart Pairing**: Removal/addition pairing for modifications

**Desktop Layout**:
- Two-column grid with before/after sections
- Visual indicators (+/-) for additions/removals
- Syntax highlighting preserved in diff context

**Mobile Layout**:
- Stacked blocks grouped by operation type
- Separate removed/added sections for clarity
- Maintains diff coloring and indicators

### Icon Components

#### [`src/components/icons/custom.tsx`](file:///Users/allison/git/opencode/packages/web/src/components/icons/custom.tsx)
**Purpose**: Custom brand icons for AI providers and OpenCode
**Components**:
- `IconOpenAI`: OpenAI brand icon
- `IconAnthropic`: Anthropic brand icon  
- `IconGemini`: Google Gemini icon
- `IconOpencode`: OpenCode logo icon

#### [`src/components/icons/index.tsx`](file:///Users/allison/git/opencode/packages/web/src/components/icons/index.tsx)
**Purpose**: Heroicons icon library integration
**Architecture**: Large collection of SVG icon components
**Usage**: Standard Heroicons with Solid.js JSX attributes

### Styling System

#### [`src/styles/custom.css`](file:///Users/allison/git/opencode/packages/web/src/styles/custom.css)
**Purpose**: Global styling overrides for Starlight theme
**Features**:
- **Color Variables**: Starlight theme customization
- **Syntax Highlighting**: Dark mode Shiki theme overrides
- **Surface Colors**: Background and divider color consistency

#### CSS Modules

##### [`share.module.css`](file:///Users/allison/git/opencode/packages/web/src/components/share.module.css)
**Purpose**: Comprehensive styling for Share component
**Architecture**: Component-based styling with CSS custom properties

**Key Features**:
- **Responsive Breakpoints**: Mobile-first design
- **CSS Custom Properties**: Dynamic sizing (`--sm-tool-width`, `--md-tool-width`, `--lg-tool-width`)
- **Terminal Styling**: Custom terminal icon and styling
- **Expandable Content**: Advanced text truncation and expansion

**Layout Components**:
- `.root`: Main container with flexible gap system
- `.header`: Session metadata display with statistics
- `.parts`: Message rendering system with decoration column
- `.message-*`: Specialized message type styling

**Interactive Elements**:
- **Button Styling**: Consistent interactive element design
- **Anchor Links**: Deep-link functionality with tooltip feedback
- **Expansion Controls**: Show more/less functionality

##### [`codeblock.module.css`](file:///Users/allison/git/opencode/packages/web/src/components/codeblock.module.css)
**Purpose**: Code block styling integration
**Features**:
- **Shiki Integration**: Background color overrides for theme consistency
- **Line Wrapping**: Break-spaces for proper code formatting

##### [`diffview.module.css`](file:///Users/allison/git/opencode/packages/web/src/components/diffview.module.css)
**Purpose**: Diff visualization styling
**Architecture**: Responsive grid system with mobile fallback

**Desktop Layout**:
- CSS Grid two-column layout
- Border system for visual separation
- Color-coded diff indicators

**Mobile Layout**:
- Block-based stacking
- Preserved diff coloring
- Responsive breakpoint switching

##### [`markdownview.module.css`](file:///Users/allison/git/opencode/packages/web/src/components/markdownview.module.css)
**Purpose**: Markdown content styling
**Features**:
- **Typography**: Consistent font sizes and line heights
- **List Styling**: Proper indentation and positioning
- **Code Styling**: Inline code with backtick indicators
- **Spacing**: Consistent vertical rhythm

### Assets and Static Files

#### Theme Assets
- **Logos**: Light/dark SVG variants in [`src/assets/`](file:///Users/allison/git/opencode/packages/web/src/assets/)
- **Screenshots**: Theme preview images (tokyonight, ayu, everforest, opencode)
- **Icons**: Landing page interaction icons (copy, check)

#### Public Assets
- **Favicon**: [`public/favicon.svg`](file:///Users/allison/git/opencode/packages/web/public/favicon.svg)
- **Social Share**: [`public/social-share.png`](file:///Users/allison/git/opencode/packages/web/public/social-share.png)
- **Theme Schema**: [`public/theme.json`](file:///Users/allison/git/opencode/packages/web/public/theme.json) - JSON schema for theme validation

### Types and Interfaces

#### [`src/types/lang-map.d.ts`](file:///Users/allison/git/opencode/packages/web/src/types/lang-map.d.ts)
**Purpose**: Type definitions for language mapping library
**Status**: Empty file - relies on library's built-in types

## Data Flow Architecture

### Session Sharing Flow
1. **URL Access**: User visits `/s/{session-id}`
2. **Server Fetch**: Astro fetches session data from API
3. **Page Render**: Server-side renders initial data
4. **WebSocket Connect**: Client establishes real-time connection
5. **Live Updates**: Session updates streamed via WebSocket
6. **UI Updates**: Solid.js reactively updates interface

### Documentation Flow
1. **Static Generation**: Astro builds documentation from MDX
2. **Starlight Processing**: Theme and navigation generation
3. **Component Integration**: Custom Hero/Header components
4. **Asset Optimization**: Image and CSS processing

## Integration Points

### External Dependencies
- **OpenCode Core**: Session data types and structures
- **API Endpoints**: `/share_data` and `/share_poll` WebSocket
- **Social Cards**: External social card service integration
- **Models.dev**: Multi-provider LLM support reference

### Internal Dependencies
- **Session Messages**: Complex message part rendering
- **Tool Results**: File operations, command execution, diagnostics
- **Real-time Updates**: WebSocket-based live session streaming

## Performance Characteristics

### Optimization Strategies
- **Code Splitting**: Solid.js components loaded only when needed
- **Image Optimization**: Sharp integration for asset processing
- **WebSocket Efficiency**: Incremental updates with message reconciliation
- **CSS Modules**: Scoped styling to prevent bloat
- **Syntax Highlighting**: Cached Shiki rendering

### Scalability Considerations
- **Server-Side Rendering**: Improved initial page load
- **Cloudflare Edge**: Global CDN distribution
- **Incremental Updates**: Only changed data transmitted
- **Resource Cleanup**: Proper WebSocket and component lifecycle management

## Security Considerations

### Content Security
- **Server-Side Validation**: Session ID validation before data fetch
- **XSS Prevention**: Proper HTML escaping in markdown rendering
- **WebSocket Security**: Secure WebSocket (WSS) connections
- **Error Handling**: Graceful degradation for failed connections

### Data Privacy
- **Session Isolation**: Individual session access controls
- **No Persistent Storage**: Client-side state only during session
- **Secure Transmission**: HTTPS/WSS for all communications

## Development Workflow

### Build Process
1. **Content Processing**: MDX to HTML via Starlight
2. **Component Building**: Solid.js compilation
3. **Asset Pipeline**: Image optimization and CSS processing
4. **Static Generation**: Pre-rendered pages with dynamic capabilities
5. **Deployment**: Cloudflare Pages with SSR functions

### Development Commands
- `astro dev`: Development server with HMR
- `astro build`: Production build
- `astro preview`: Local production preview

## Extension Points

### Customization Options
- **Theme System**: CSS custom properties for visual customization
- **Component Overrides**: Starlight component replacement system
- **Content Extensions**: MDX for rich documentation content
- **Icon System**: Modular icon component architecture

### Future Enhancements
- **Multi-language Support**: I18n integration potential
- **Advanced Search**: Full-text search across documentation
- **Enhanced Sharing**: Additional sharing formats and integrations
- **Performance Monitoring**: Real-time performance metrics
- **Collaborative Features**: Multi-user session viewing

## Error Handling and Resilience

### WebSocket Resilience
- **Auto-reconnection**: Exponential backoff strategy
- **Connection Status**: Visual feedback for connection state
- **Graceful Degradation**: Functional without real-time updates
- **Error Recovery**: Automatic retry mechanisms

### Content Fallbacks
- **Missing Sessions**: Proper 404 handling
- **API Failures**: Fallback to cached data
- **Component Errors**: Error boundaries for UI stability
- **Asset Loading**: Progressive enhancement approach

## Conclusion

The OpenCode Web Interface represents a sophisticated integration of modern web technologies to create both comprehensive documentation and dynamic session sharing capabilities. The architecture balances static site generation performance with real-time interactivity, providing an excellent user experience for both learning about OpenCode and sharing collaborative coding sessions.

The component-based architecture, comprehensive styling system, and real-time capabilities make this interface both maintainable and extensible, supporting OpenCode's mission to provide an exceptional AI-powered coding experience.
