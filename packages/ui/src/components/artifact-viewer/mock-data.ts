/**
 * Sample markdown content for ArtifactViewer stories
 * Uses the design discussion document created during the Pretty markdown feature implementation
 */

export const designDiscussionMarkdown = `---
task: storyriffing-pretty-markdown
type: design-discussion
repo: syncopate
branch: fix-multiline
sha: 604ec409b2c86e09ddcc3f6a7179cf73540ba46c
---

### Summary of change request

Add a "Pretty" markdown viewer tab to the ArtifactViewer component in packages/ui. This becomes a third view option (alongside existing "rendered" and "raw") and the new default tab. The Pretty view provides human-friendly, beautiful markdown rendering with:
- Real HTML heading hierarchy (h1 larger than h2, etc.)
- Nice line height and vertical rhythm
- Beautiful typography with optional semi-fixed-width font
- Fixed-width font for code blocks with syntax highlighting preserved

### Current State

- \`ArtifactViewer\` (\`packages/ui/src/components/artifact-viewer.tsx\`) has two tabs: "RENDERED" and "RAW"
- "RENDERED" tab uses \`MarkdownRenderer\` with terminal-style aesthetics:
  - Monospace font throughout (\`var(--font-mono)\`)
  - All headings same size (0.875rem) with \`#\` prefixes
  - Tight line heights (1.2 base, 1.5 for paragraphs)
  - Terminal color theme via CSS custom properties
- \`MarkdownRenderer\` (\`packages/ui/src/components/markdown-renderer.tsx\`) provides:
  - \`react-markdown\` with \`remark-gfm\` for GFM support
  - PrismLight syntax highlighting across 12 languages
  - Frontmatter YAML parsing and display
  - Custom component overrides for headings, lists, links, code
- Styling in \`markdown-terminal.css\` uses \`.prose-terminal\` class
- Storybook stories exist at \`artifact-viewer.stories.tsx\` with basic examples

### Desired End State

- ArtifactViewer shows three tabs in order: "PRETTY" (default), "RENDERED", "RAW"
- Pretty view renders markdown with:
  - Proportional or semi-fixed-width font for prose (readable body text)
  - Modular scale headings (h1=2em, h2=1.5em, h3=1.25em, etc.)
  - No \`#\` prefix on headings (clean typography)
  - Comfortable line height (~1.6) and paragraph spacing
  - Constrained line width (~70ch) for optimal readability
  - Fixed-width font for code blocks with existing syntax highlighting
  - Same frontmatter handling as current renderer
- Storybook stories demonstrate the Pretty view with various content types
- Terminal-style "RENDERED" view remains unchanged for users who prefer it

### What we're not doing

- Not modifying the existing \`MarkdownRenderer\` terminal output (it stays as-is)
- Not adding new markdown parsing features (GFM support is sufficient)
- Not changing code block syntax highlighting (PrismLight works well)
- Not adding print stylesheets or responsive breakpoints beyond basic max-width

### Patterns to follow

#### Variant-based Component with CSS Class

Use a variant prop to switch between prose styles - similar to Button variants in shadcn/ui:

\`\`\`typescript
// markdown-renderer.tsx
interface MarkdownRendererProps {
  content: string
  variant?: 'terminal' | 'pretty'  // NEW
  onCopyError?: () => any
}

export const MarkdownRenderer = memo(({ content, variant = 'terminal', onCopyError }: MarkdownRendererProps) => {
  const proseClass = variant === 'pretty' ? 'prose-pretty' : 'prose-terminal'
  // ...
  return (
    <div className={\`\${proseClass} pb-4\`}>
      {hasFrontmatter && <FrontmatterBlock data={frontmatter} />}
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {body}
      </ReactMarkdown>
    </div>
  )
})
\`\`\`

#### Conditional Component Overrides

Only prepend \`#\` to headings in terminal variant:

\`\`\`typescript
// In MarkdownRenderer
const components: Components = React.useMemo(() => {
  const headingPrefix = variant === 'terminal'

  return {
    h1({ children }) {
      return <h1>{headingPrefix ? '# ' : ''}{children}</h1>
    },
    h2({ children }) {
      return <h2>{headingPrefix ? '## ' : ''}{children}</h2>
    },
    // ... etc
  }
}, [variant, handleCopy, copiedBlocks])
\`\`\`

#### Tailwind Typography Plugin Pattern

The \`@tailwindcss/typography\` plugin provides a \`prose\` class with beautiful defaults. We can follow this pattern with custom CSS:

\`\`\`css
/* markdown-pretty.css */
.prose-pretty {
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  font-size: 1rem;
  line-height: 1.75;
  max-width: 70ch;
  color: var(--terminal-fg);
}

.prose-pretty h1 {
  font-size: 2em;
  margin-top: 0;
  margin-bottom: 0.8em;
  font-weight: 700;
  line-height: 1.2;
}

.prose-pretty h2 {
  font-size: 1.5em;
  margin-top: 1.5em;
  margin-bottom: 0.6em;
  font-weight: 600;
}

/* Code blocks use monospace */
.prose-pretty pre,
.prose-pretty code {
  font-family: var(--font-mono);
}
\`\`\`

### Design Questions

#### 1. Font Choice: System fonts vs Semi-fixed-width?

What font family should the Pretty view use for body text?

- Option A: **System font stack** - \`system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif\`
  - Pros: Native look, fast loading, optimal readability
  - Cons: Less distinctive, different across platforms

- Option B: **Semi-fixed-width** - JetBrains Mono, Fira Code, or similar
  - Pros: Code-friendly, consistent across platforms, familiar to developers
  - Cons: Need to load web font, slightly less readable for long prose

- Option C: **Inter or similar web font** - Inter, IBM Plex Sans
  - Pros: Excellent readability, consistent across platforms, professional
  - Cons: Additional font load, may clash with terminal aesthetic

Recommendation: **Option A (System font stack)** - Provides best readability without additional font loading. Code blocks will still use \`var(--font-mono)\` for familiar code appearance. The contrast between proportional prose and monospace code improves scannability.

#### 2. Tab Naming: How to label the views?

The current "RENDERED" tab could be confusing with a new "PRETTY" tab since both render markdown.

- Option A: **"PRETTY" / "TERMINAL" / "RAW"** - Clearly distinguishes the two rendered views
- Option B: **"PRETTY" / "RENDERED" / "RAW"** - Keeps existing name, may confuse users
- Option C: **"READABLE" / "TERMINAL" / "RAW"** - More descriptive but verbose

Recommendation: **Option A ("PRETTY" / "TERMINAL" / "RAW")** - Clear distinction. "TERMINAL" accurately describes the monospace, hash-prefixed style. Users understand what they'll get.

#### 3. Heading Size Scale: What modular scale to use?

What ratio should define heading size progression?

| Level | 1.125 (Minor Second) | 1.2 (Minor Third) | 1.25 (Major Third) | 1.333 (Perfect Fourth) |
|-------|---------------------|-------------------|--------------------|-----------------------|
| h1    | 1.42em             | 1.73em           | 1.95em            | 2.37em               |
| h2    | 1.27em             | 1.44em           | 1.56em            | 1.78em               |
| h3    | 1.13em             | 1.20em           | 1.25em            | 1.33em               |

- Option A: **1.2 ratio (Minor Third)** - Subtle, professional, works well at smaller sizes
- Option B: **1.25 ratio (Major Third)** - Clear hierarchy, comfortable spacing
- Option C: **Custom** - h1=2em, h2=1.5em, h3=1.25em (common web convention)

Recommendation: **Option C (Custom web convention)** - These are the most recognizable heading sizes across the web. Users immediately understand the hierarchy. h1=2em, h2=1.5em, h3=1.25em, h4/h5/h6=1em with weight/color differentiation.

#### 4. Max Width: Constrain line length or full width?

Should the Pretty view constrain line length for optimal readability?

- Option A: **Constrained (max-width: 70ch)** - Optimal reading comfort, centered or left-aligned
- Option B: **Full width** - Uses available space, consistent with terminal view
- Option C: **Responsive** - 70ch on wide screens, full width on narrow

Recommendation: **Option A (Constrained 70ch)** - Research shows 45-75 characters per line is optimal for reading. The Pretty view prioritizes readability, so this makes sense. Keep content left-aligned within the container.

#### 5. Color Theme: Inherit terminal colors or use neutral palette?

Should heading colors match terminal accent colors or use neutral black/gray?

- Option A: **Inherit terminal theme** - h1/h2 use \`--terminal-accent\`, consistent with overall UI
- Option B: **Neutral colors** - Use \`--terminal-fg\` for all text, more document-like
- Option C: **Subtle accent** - h1 uses accent, h2+ use foreground

Recommendation: **Option C (Subtle accent)** - h1 gets \`--terminal-accent\` for visual anchor, h2-h6 use \`--terminal-fg\` with reduced opacity for h4+. This creates hierarchy without overwhelming color. Strong/bold can use \`--terminal-warning\` to match terminal style.

### Resolved Design Questions

All questions resolved - implementation complete.
`
