import type { Meta, StoryObj } from '@storybook/react'
import { DiffViewer } from './DiffViewer'

const meta: Meta<typeof DiffViewer> = {
  title: 'Components/DiffViewer',
  component: DiffViewer,
  parameters: {
    layout: 'padded',
  },
  argTypes: {
    mode: {
      control: { type: 'radio' },
      options: ['unified', 'split'],
    },
  },
}

export default meta
type Story = StoryObj<typeof meta>

export const SimpleSplitView: Story = {
  args: {
    oldContent: 'const greeting = "Hello"',
    newContent: 'const greeting = "Hello World"',
    mode: 'split',
  },
}

export const SimpleUnifiedView: Story = {
  args: {
    oldContent: 'const greeting = "Hello"',
    newContent: 'const greeting = "Hello World"',
    mode: 'unified',
  },
}

export const MultiLineChanges: Story = {
  args: {
    oldContent: `function greet(name) {
  console.log("Hello, " + name);
  return "Hello, " + name;
}`,
    newContent: `function greet(name, title = "") {
  const fullName = title ? \`\${title} \${name}\` : name;
  console.log(\`Hello, \${fullName}\`);
  return \`Hello, \${fullName}\`;
}`,
    mode: 'unified',
  },
}

export const MultiLineSplitView: Story = {
  args: {
    oldContent: `function greet(name) {
  console.log("Hello, " + name);
  return "Hello, " + name;
}`,
    newContent: `function greet(name, title = "") {
  const fullName = title ? \`\${title} \${name}\` : name;
  console.log(\`Hello, \${fullName}\`);
  return \`Hello, \${fullName}\`;
}`,
    mode: 'split',
  },
}

export const LineAdditions: Story = {
  args: {
    oldContent: `const config = {
  debug: false,
};`,
    newContent: `const config = {
  debug: false,
  verbose: true,
  logLevel: 'info',
};`,
    mode: 'unified',
  },
}

export const LineDeletions: Story = {
  args: {
    oldContent: `const config = {
  debug: false,
  verbose: true,
  logLevel: 'info',
};`,
    newContent: `const config = {
  debug: false,
};`,
    mode: 'unified',
  },
}

export const ComplexChanges: Story = {
  args: {
    oldContent: `class Calculator {
  constructor() {
    this.result = 0;
  }

  add(a, b) {
    return a + b;
  }

  subtract(a, b) {
    return a - b;
  }
}`,
    newContent: `class Calculator {
  constructor(initialValue = 0) {
    this.result = initialValue;
    this.history = [];
  }

  add(a, b) {
    const result = a + b;
    this.history.push({ operation: 'add', operands: [a, b], result });
    return result;
  }

  subtract(a, b) {
    const result = a - b;
    this.history.push({ operation: 'subtract', operands: [a, b], result });
    return result;
  }

  multiply(a, b) {
    const result = a * b;
    this.history.push({ operation: 'multiply', operands: [a, b], result });
    return result;
  }

  getHistory() {
    return this.history;
  }
}`,
    mode: 'unified',
  },
}

export const WithFileSnapshot: Story = {
  args: {
    oldContent: 'console.log("Hello, World!");',
    newContent: 'console.log("Hello, TypeScript!");',
    mode: 'unified',
    showFullFile: true,
    fileSnapshot: `// main.ts
import { greet } from './greeting';

function main() {
  console.log("Hello, World!");
  greet("User");
}

main();`,
  },
}

export const EmptyToContent: Story = {
  args: {
    oldContent: '',
    newContent: `function newFunction() {
  return "I am new!";
}`,
    mode: 'unified',
  },
}

export const ContentToEmpty: Story = {
  args: {
    oldContent: `function oldFunction() {
  return "I will be deleted";
}`,
    newContent: '',
    mode: 'unified',
  },
}

export const IndentationChanges: Story = {
  args: {
    oldContent: `if (condition) {
console.log("Bad indentation");
}`,
    newContent: `if (condition) {
  console.log("Fixed indentation");
}`,
    mode: 'unified',
  },
}

export const WhitespaceOnlyChanges: Story = {
  args: {
    oldContent: 'const value = "test";  ',
    newContent: 'const value = "test";',
    mode: 'unified',
  },
}

export const UndefinedContent: Story = {
  args: {
    oldContent: undefined as any,
    newContent: undefined as any,
    mode: 'unified',
  },
}

export const PartiallyUndefinedOld: Story = {
  args: {
    oldContent: undefined as any,
    newContent: 'const greeting = "Hello World"',
    mode: 'unified',
  },
}

export const PartiallyUndefinedNew: Story = {
  args: {
    oldContent: 'const greeting = "Hello"',
    newContent: undefined as any,
    mode: 'unified',
  },
}

// Real-world broken case that ENG-2188 fixed
export const MalformedToolInput: Story = {
  name: 'Malformed Tool Input (ENG-2188 Bug Fix)',
  args: {
    oldContent: undefined as any,
    newContent: undefined as any,
    mode: 'unified',
  },
  parameters: {
    docs: {
      description: {
        story: `This demonstrates the bug from ENG-2188 where malformed tool input JSON
        (e.g., {"file_path": "/test.js"} without old_string/new_string fields)
        would cause a TypeError. With the fix, this now displays an empty diff instead of crashing.`,
      },
    },
  },
}

// Another real case: Edit tool with null values
export const EditToolNullValues: Story = {
  name: 'Edit Tool with Null Values',
  args: {
    oldContent: null as any,
    newContent: null as any,
    mode: 'split',
  },
  parameters: {
    docs: {
      description: {
        story: `Simulates Edit tool receiving null values from backend JSON parsing.
        Previously would crash with "Cannot read properties of null".
        Now handles gracefully showing empty diff panels.`,
      },
    },
  },
}

// Partial content case common in Write tool
export const WriteToolMissingContent: Story = {
  name: 'Write Tool Missing Content',
  args: {
    oldContent: '// Existing file content\nfunction main() {\n  console.log("hello");\n}',
    newContent: undefined as any,
    mode: 'unified',
  },
  parameters: {
    docs: {
      description: {
        story: `Simulates Write tool when content field is missing from JSON.
        Should show the existing file content with no additions.`,
      },
    },
  },
}
