import type { Meta, StoryObj } from '@storybook/react'
import { MarkdownRenderer } from './MarkdownRenderer'

const meta = {
  title: 'Internal/SessionDetail/MarkdownRenderer',
  component: MarkdownRenderer,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    Story => (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '2rem',
          backgroundColor: '#0a0a0a',
        }}
      >
        <div
          style={{
            maxWidth: '800px',
            width: '100%',
            maxHeight: '80vh',
            overflow: 'auto',
            padding: '2rem',
            backgroundColor: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: '8px',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
          }}
        >
          <Story />
        </div>
      </div>
    ),
  ],
  tags: ['autodocs'],
} satisfies Meta<typeof MarkdownRenderer>

export default meta
type Story = StoryObj<typeof meta>

export const BasicText: Story = {
  args: {
    content: `# Basic Markdown Test

This is a paragraph with **bold text**, *italic text*, and ***bold italic text***.

Here's a second paragraph with ~~strikethrough text~~ and some \`inline code\`.

## Links and Lists

Check out [OpenAI's website](https://openai.com) for more information.

### Unordered List
- First item
- Second item with **bold**
- Third item with \`code\`
  - Nested item 1
  - Nested item 2
    - Double nested

### Ordered List
1. First step
2. Second step with *emphasis*
3. Third step
   1. Sub-step A
   2. Sub-step B
   3. Sub-step C`,
  },
}

export const CodeBlocks: Story = {
  args: {
    content: `# Code Block Examples

## JavaScript
\`\`\`javascript
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

const result = fibonacci(10);
console.log(\`Fibonacci of 10 is \${result}\`);
\`\`\`

## Python
\`\`\`python
def quick_sort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quick_sort(left) + middle + quick_sort(right)

numbers = [64, 34, 25, 12, 22, 11, 90]
sorted_nums = quick_sort(numbers)
print(f"Sorted array: {sorted_nums}")
\`\`\`

## TypeScript with React
\`\`\`tsx
interface ButtonProps {
  onClick: () => void;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
}

const Button: React.FC<ButtonProps> = ({ onClick, children, variant = 'primary' }) => {
  const className = variant === 'primary'
    ? 'bg-blue-500 text-white'
    : 'bg-gray-200 text-black';

  return (
    <button className={className} onClick={onClick}>
      {children}
    </button>
  );
};
\`\`\`

## JSON
\`\`\`json
{
  "name": "MarkdownRenderer",
  "version": "1.0.0",
  "features": [
    "Syntax highlighting",
    "Copy to clipboard",
    "GFM support"
  ],
  "config": {
    "sanitize": true,
    "allowedTags": ["p", "pre", "code"]
  }
}
\`\`\``,
  },
}

export const Tables: Story = {
  args: {
    content: `# GitHub Flavored Markdown Tables

## Simple Table
| Feature | Support | Notes |
|---------|---------|-------|
| Bold | ✅ | Works perfectly |
| Italic | ✅ | Also works |
| Code | ✅ | Inline and block |
| Links | ✅ | External links |

## Alignment Example
| Left Aligned | Center Aligned | Right Aligned |
|:-------------|:--------------:|--------------:|
| Row 1 Col 1 | Row 1 Col 2 | Row 1 Col 3 |
| Lorem ipsum dolor | sit amet | consectetur |
| adipiscing elit | sed do | eiusmod |

## Complex Table with Code
| Language | Example | Output |
|----------|---------|--------|
| JavaScript | \`console.log("Hello")\` | Hello |
| Python | \`print("World")\` | World |
| Go | \`fmt.Println("!")\` | ! |`,
  },
}

export const EdgeCases: Story = {
  args: {
    content: `# Edge Cases and Special Characters

## Special Characters
This text contains special characters: <>&"' and HTML entities: &lt;&gt;&amp;&quot;

## Long Lines
This is an extremely long line that should wrap properly in the container without breaking the layout or causing horizontal scrolling issues. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

## Inline Code with Special Characters
Here's some inline code with special chars: \`const str = "<div>&nbsp;</div>"\`

## Code Block with Very Long Lines
\`\`\`javascript
const veryLongVariableName = "This is a very long string that should cause horizontal scrolling in the code block rather than wrapping, which is the expected behavior for code blocks to preserve formatting and indentation properly";
\`\`\`

## Nested Blockquotes
> Level 1 quote
>> Level 2 nested quote
>>> Level 3 deeply nested quote with **bold** and *italic*
>>>> Level 4 quote with \`inline code\`

## Mixed List Types
1. Ordered item one
   - Unordered sub-item
   - Another unordered sub-item
     1. Ordered sub-sub-item
     2. Another ordered sub-sub-item
2. Ordered item two
   * Different bullet style
   + Yet another bullet style`,
  },
}

export const RealWorldExample: Story = {
  args: {
    content: `# API Documentation

## Installation

Install the package using your preferred package manager:

\`\`\`bash
npm install @humanlayer/markdown-renderer
# or
yarn add @humanlayer/markdown-renderer
# or
pnpm add @humanlayer/markdown-renderer
\`\`\`

## Quick Start

Import and use the component in your React application:

\`\`\`tsx
import { MarkdownRenderer } from '@humanlayer/markdown-renderer';

function MyComponent() {
  const content = "# Hello World\\nThis is **markdown**!";

  return (
    <MarkdownRenderer
      content={content}
      sanitize={true}
      className="my-custom-class"
    />
  );
}
\`\`\`

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| \`content\` | \`string\` | Required | The markdown content to render |
| \`sanitize\` | \`boolean\` | \`true\` | Whether to sanitize HTML |
| \`className\` | \`string\` | \`""\` | Additional CSS classes |

## Features

### 🎨 Syntax Highlighting
Supports multiple languages including:
- JavaScript/TypeScript
- Python
- Go
- Rust
- And many more!

### 📋 Copy to Clipboard
All code blocks include a copy button for easy sharing.

### 🔒 Security
HTML content is sanitized by default using DOMPurify to prevent XSS attacks.

## Examples

### Basic Usage
\`\`\`javascript
const markdown = \`
# Title
**Bold** and *italic* text
\`;

<MarkdownRenderer content={markdown} />
\`\`\`

### Advanced Configuration
\`\`\`typescript
interface Config {
  sanitize: boolean;
  allowedTags: string[];
  syntaxTheme: 'dark' | 'light';
}

const config: Config = {
  sanitize: true,
  allowedTags: ['p', 'code', 'pre'],
  syntaxTheme: 'dark'
};
\`\`\`

## Troubleshooting

> **Note:** If syntax highlighting doesn't work, ensure you've imported the necessary language modules.

### Common Issues

1. **Code not highlighted**: Check language registration
2. **Styles missing**: Verify CSS imports
3. **XSS warnings**: Enable sanitization

---

For more information, visit our [GitHub repository](https://github.com/humanlayer/markdown-renderer).`,
  },
}

export const StressTest: Story = {
  args: {
    content: `# Stress Test: Large Document

${Array.from(
  { length: 20 },
  (_, i) => `
## Section ${i + 1}

This is paragraph ${i + 1} with various markdown elements to test performance.

### Code Block ${i + 1}
\`\`\`javascript
// Function ${i + 1}
function complexFunction${i + 1}(param) {
  const result = param * ${i + 1};
  console.log(\`Result for function ${i + 1}: \${result}\`);
  return result;
}
\`\`\`

### List ${i + 1}
${Array.from({ length: 5 }, (_, j) => `${j + 1}. List item ${j + 1} in section ${i + 1}`).join('\n')}

### Table ${i + 1}
| Column A | Column B | Column C |
|----------|----------|----------|
| Data ${i}-1 | Data ${i}-2 | Data ${i}-3 |
| Data ${i}-4 | Data ${i}-5 | Data ${i}-6 |

> Blockquote ${i + 1}: Lorem ipsum dolor sit amet, consectetur adipiscing elit.

---
`,
).join('\n')}

## Performance Metrics
- Rendered ${20} sections
- Total code blocks: ${20}
- Total tables: ${20}
- Total lists: ${20}
- Total blockquotes: ${20}`,
  },
}

export const UnsanitizedContent: Story = {
  args: {
    content: `# Unsanitized Content Test

<div style="color: red;">This HTML should be removed when sanitize=true</div>

<script>alert('This script should never execute')</script>

<img src="x" onerror="alert('XSS')" />

## Safe Content

This regular markdown should render normally:

- **Bold text**
- *Italic text*
- \`inline code\`

\`\`\`javascript
// This code block is safe
console.log("Hello, world!");
\`\`\``,
    sanitize: true,
  },
}

export const EmptyAndNull: Story = {
  args: {
    content: '',
  },
}

export const LanguageShowcase: Story = {
  args: {
    content: `# Programming Language Showcase

## Go
\`\`\`go
package main

import (
    "fmt"
    "time"
)

func worker(id int, jobs <-chan int, results chan<- int) {
    for j := range jobs {
        fmt.Println("worker", id, "started job", j)
        time.Sleep(time.Second)
        results <- j * 2
    }
}
\`\`\`

## Rust
\`\`\`rust
fn main() {
    let mut vec = Vec::new();
    vec.push(1);
    vec.push(2);

    for i in &vec {
        println!("Value: {}", i);
    }

    let sum: i32 = vec.iter().sum();
    println!("Sum: {}", sum);
}
\`\`\`

## Clojure
\`\`\`clojure
(defn fibonacci [n]
  (if (<= n 1)
    n
    (+ (fibonacci (- n 1))
       (fibonacci (- n 2)))))

(println (map fibonacci (range 10)))
\`\`\`

## Lua
\`\`\`lua
local function factorial(n)
    if n <= 1 then
        return 1
    else
        return n * factorial(n - 1)
    end
end

for i = 1, 10 do
    print(string.format("%d! = %d", i, factorial(i)))
end
\`\`\`

## Zig
\`\`\`zig
const std = @import("std");

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();

    var i: u32 = 0;
    while (i < 10) : (i += 1) {
        try stdout.print("Count: {}\\n", .{i});
    }
}
\`\`\`

## Bash
\`\`\`bash
#!/bin/bash

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

if command_exists node; then
    echo "Node.js is installed"
    node --version
else
    echo "Node.js is not installed"
fi
\`\`\``,
  },
}

export const MathAndSymbols: Story = {
  args: {
    content: `# Mathematical and Special Symbols

## Math Expressions
This renderer doesn't support LaTeX, but here are some Unicode math symbols:

- Addition: 2 + 2 = 4
- Multiplication: 3 × 4 = 12
- Division: 10 ÷ 2 = 5
- Square root: √16 = 4
- Pi: π ≈ 3.14159
- Infinity: ∞
- Sum: ∑(i=1 to n) = n(n+1)/2
- Integral: ∫f(x)dx

## Greek Letters
α β γ δ ε ζ η θ ι κ λ μ ν ξ ο π ρ σ τ υ φ χ ψ ω

## Arrows and Symbols
→ ← ↑ ↓ ↔ ⇒ ⇐ ⇔ ➜ ✓ ✗ ★ ☆ ♠ ♣ ♥ ♦

## Emojis
🚀 Rocket Science
💡 Bright Ideas
🎯 On Target
⚡ Lightning Fast
🔥 On Fire
✨ Magic Happens`,
  },
}

export const CodeBlocksLong: Story = {
  args: {
    content: `# Long block examples

## One really long inline code string
I'm out here just typing this bananas thing that should really just wrap \`Thisisaverylongmessagethatwillneverendnomatterhowhardyoutryitremainsthelongestlineintheworldandwilljustgoonandonandonandonuntileitherthiscomputerimplodesarethissolarsystemreachesitsinevitablesundeath\` 

## One standard long inline code string
I'm out here just typing this bananas thing that should really just wrap \`This is a very long message that will never end no matter how hard you try it remains the longest line in teh world and will go on and on and on and on and on likely until the sun explodes but we all know that won't be for a very long time probably but anyway how do we feel about chickens\`

## Plaintext Long Single String
\`\`\`
Thisisaverylongmessagethatwillneverendnomatterhowhardyoutryitremainsthelongestlineintheworldandwilljustgoonandonandonandonuntileitherthiscomputerimplodesarethissolarsystemreachesitsinevitablesundeath
\`\`\`

## Plaintext Long Broken Up String
\`\`\`
This is a very long message that will never end no matter how hard you try it remains the longest line in teh world and will go on and on and on and on and on likely until the sun explodes but we all know that won't be for a very long time probably but anyway how do we feel about chickens
\`\`\`


`,
  },
}
