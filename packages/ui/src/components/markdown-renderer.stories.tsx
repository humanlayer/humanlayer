import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'
import { mockUsers } from './__stories__/comment-fixtures'
import { MarkdownRenderer } from './markdown-renderer'

const meta = {
  title: 'Components/MarkdownRenderer',
  component: MarkdownRenderer,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof MarkdownRenderer>

export default meta
type Story = StoryObj<typeof meta>

const sampleMarkdown = `# Heading 1
This is a paragraph under heading 1.

## Heading 2
This is a paragraph under heading 2.

### Heading 3
This is a paragraph under heading 3.

#### Heading 4
This is a paragraph under heading 4.

##### Heading 5
This is a paragraph under heading 5.

###### Heading 6
This is a paragraph under heading 6.

## Code Examples

Here's some inline code: \`const foo = "bar"\`

### JavaScript Code Block
\`\`\`javascript
function greet(name) {
  console.log(\`Hello, \${name}!\`);
  return true;
}

greet("World");
\`\`\`

### TypeScript Code Block
\`\`\`typescript
interface User {
  id: string;
  name: string;
  email: string;
}

const getUser = async (id: string): Promise<User> => {
  const response = await fetch(\`/api/users/\${id}\`);
  return response.json();
};
\`\`\`

### Python Code Block
\`\`\`python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

print(fibonacci(10))
\`\`\`

## Lists

### Unordered List
- First item
- Second item
  - Nested item 1
  - Nested item 2
- Third item

### Ordered List
1. First step
2. Second step
   1. Sub-step A
   2. Sub-step B
3. Third step

## Text Formatting

This is **bold text** and this is *italic text*.

This is a [link to Google](https://google.com).

> This is a blockquote. It should be styled differently from regular text.

---

## Table

| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Data 1   | Data 2   | Data 3   |
| Data 4   | Data 5   | Data 6   |
`

export const Default: Story = {
  args: {
    content: sampleMarkdown,
  },
}

export const SimpleText: Story = {
  args: {
    content: 'This is a simple paragraph with **bold** and *italic* text.',
  },
}

export const CodeOnly: Story = {
  args: {
    content: `\`\`\`typescript
const config = {
  theme: 'dark',
  language: 'en',
  features: {
    markdown: true,
    syntax: true,
  }
};
\`\`\``,
  },
}

export const HeadingsOnly: Story = {
  args: {
    content: `# Main Title
## Section Title
### Subsection Title
#### Minor Heading
##### Small Heading
###### Tiny Heading`,
  },
}

export const MermaidDiagram: Story = {
  args: {
    content: `# Architecture Overview

This document describes the request lifecycle through the system.

## Request Flow

\`\`\`mermaid
graph TD
    A[Browser] -->|HTTP Request| B[API Gateway]
    B --> C{Auth Check}
    C -->|Valid| D[Application Server]
    C -->|Invalid| E[401 Unauthorized]
    D --> F[(Database)]
    D --> G[Cache Layer]
    G -->|Cache Hit| D
    F -->|Query Result| D
    D -->|JSON Response| B
    B -->|HTTP Response| A
\`\`\`

## Sequence Diagram

Here's how the authentication flow works:

\`\`\`mermaid
sequenceDiagram
    participant U as User
    participant UI as Frontend
    participant API as Auth API
    participant DB as Database

    U->>UI: Enter credentials
    UI->>API: POST /auth/login
    API->>DB: Validate credentials
    DB-->>API: User record
    API-->>UI: JWT token
    UI-->>U: Redirect to dashboard
\`\`\`

## Summary

The system uses a standard request/response pattern with JWT-based auth.`,
  },
}

// Gate check stories for line highlighting — verify source line number mapping works
const simpleMarkdown = `# Introduction

This is the first paragraph on line 3.

## Section Two

This paragraph is on line 7.

### Subsection

Another paragraph here.`

// Line 1 is "# Introduction", line 3 is "This is the first paragraph...", line 6 is "## Section Two"
export const WithCommentedHeadings: Story = {
  args: {
    onLineClick: fn(),
    content: simpleMarkdown,
    commentedLines: new Map([
      [1, [mockUsers.user1]],
      [6, [mockUsers.user1, mockUsers.user2]],
    ]),
  },
}

export const WithCommentedParagraphs: Story = {
  args: {
    onLineClick: fn(),
    content: simpleMarkdown,
    commentedLines: new Map([
      [3, [mockUsers.user1]],
      [7, [mockUsers.user2, mockUsers.user3]],
    ]),
  },
}

export const WithMixedCommentedLines: Story = {
  args: {
    onLineClick: fn(),
    content: sampleMarkdown,
    commentedLines: new Map([
      [1, [mockUsers.user1]],   // # Heading 1
      [5, [mockUsers.user2]],   // paragraph under Heading 2
      [9, [mockUsers.user1, mockUsers.user2, mockUsers.user3]], // ### Heading 3
      [24, [mockUsers.user2]],  // entire JS code block (```javascript)
      [41, [mockUsers.user1, mockUsers.user3]], // TS code block line: const getUser = async ...
      [42, [mockUsers.user1, mockUsers.user3]], // TS code block line: const response = await fetch(...)
    ]),
  },
}

// Demonstrates subtle left-border indicator for paragraph-level comments
// vs full background for headings
const longParagraphMarkdown = `# Introduction

This is the first paragraph. It only occupies a single line in source, but the rendered output may wrap across multiple visual lines depending on the viewport width. Comments on this paragraph use a subtle left-border indicator instead of highlighting the entire block.

## Details

This is a short paragraph on line 6.

This is another paragraph starting on line 8 that spans multiple source lines to demonstrate that comments on any line within the paragraph range are detected correctly and shown with the subtle indicator.

### Code Section

\`\`\`typescript
const x = 1
const y = 2
const z = x + y
\`\`\`
`

export const ParagraphVsHeadingHighlight: Story = {
  args: {
    onLineClick: fn(),
    content: longParagraphMarkdown,
    commentedLines: new Map([
      [1, [mockUsers.user1]],   // # Introduction — heading gets full highlight
      [3, [mockUsers.user2]],   // Long paragraph — gets subtle left border
      [6, [mockUsers.user1]],   // Short paragraph — gets subtle left border
    ]),
  },
}