import type { Meta, StoryObj } from '@storybook/react'
import { ConversationEventRow } from './ConversationEventRow'
import type { ConversationEvent } from '@humanlayer/hld-sdk'

const meta = {
  title: 'Internal/ConversationEventRow',
  component: ConversationEventRow,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  decorators: [
    Story => (
      <div className="border border-border p-4 w-full mx-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ConversationEventRow>

export default meta
type Story = StoryObj<typeof meta>

const baseUserEvent: ConversationEvent = {
  approvalId: undefined,
  approvalStatus: undefined,
  claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
  content: 'Just say hello',
  createdAt: new Date('2025-09-18T18:44:46Z'),
  eventType: 'message' as const,
  id: 1,
  isCompleted: false,
  role: 'user' as const,
  sequence: 1,
  sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
}

export const UserMessage: Story = {
  args: {
    event: baseUserEvent,
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
}

export const UserMessageLongUnbrokenText: Story = {
  args: {
    ...UserMessage.args,
    event: {
      ...baseUserEvent,
      content:
        'Thisisaverylongmessagethatwillneverendnomatterhowhardyoutryitremainsthelongestlineintheworldandwilljustgoonandonandonandonuntileitherthiscomputerimplodesarethissolarsystemreachesitsinevitablesundeath',
    },
  },
}

const baseAssistantEvent: ConversationEvent = {
  approvalId: undefined,
  approvalStatus: undefined,
  claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
  content: 'Hello! How can I help you today?',
  createdAt: new Date('2025-09-18T18:44:47Z'),
  eventType: 'message' as const,
  id: 2,
  isCompleted: false,
  role: 'assistant' as const,
  sequence: 2,
  sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
}

export const AssistantMessage: Story = {
  args: {
    event: baseAssistantEvent,
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
}

export const AssistantThinking: Story = {
  args: {
    ...AssistantMessage.args,
    event: {
      ...baseAssistantEvent,
      eventType: 'thinking' as const,
      content: '',
    },
  },
}

export const AssistantThinkingWithContent: Story = {
  args: {
    ...AssistantMessage.args,
    event: {
      ...baseAssistantEvent,
      content: '<thinking>I need to analyze this request carefully...</thinking>',
    },
  },
}

export const AssistantWithCodeBlock: Story = {
  args: {
    ...AssistantMessage.args,
    event: {
      ...baseAssistantEvent,
      content: `Here's a simple Python function:

\`\`\`python
def hello_world():
    print("Hello, World!")
    return True
\`\`\`

This function prints a greeting and returns True.`,
    },
  },
}

export const AssistantLongMessage: Story = {
  args: {
    ...AssistantMessage.args,
    event: {
      ...baseAssistantEvent,
      content: `I'll help you understand this complex topic. Let me break it down into several parts:

## Part 1: Introduction
This is a comprehensive explanation that covers multiple aspects of the subject. We'll explore various dimensions and provide detailed insights.

## Part 2: Technical Details
The technical implementation involves several key components:
- Component A: Handles the primary processing
- Component B: Manages the data flow
- Component C: Provides the user interface

## Part 3: Best Practices
When implementing this solution, consider these important factors:
1. Always validate input data
2. Implement proper error handling
3. Optimize for performance
4. Write comprehensive tests

## Part 4: Conclusion
By following these guidelines, you'll be able to create a robust and maintainable solution that meets all requirements.`,
    },
  },
}

// Stories that demonstrate copy functionality
export const UserMessageFocused: Story = {
  args: {
    ...UserMessage.args,
    isFocused: true,
    event: {
      ...baseUserEvent,
      content: 'This message is focused and should show the copy button on hover',
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows a focused user message. The copy button becomes visible on hover.',
      },
    },
  },
}

export const AssistantMessageFocused: Story = {
  args: {
    ...AssistantMessage.args,
    isFocused: true,
    event: {
      ...baseAssistantEvent,
      content:
        'This assistant message is focused. The copy button appears when you hover over the row.',
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows a focused assistant message. The copy button becomes visible on hover.',
      },
    },
  },
}

export const MessageWithMultiLineContent: Story = {
  args: {
    ...UserMessage.args,
    event: {
      ...baseUserEvent,
      content: `Please help me with this multi-line request.
I need to:
1. Parse this data
2. Transform it into a new format
3. Save it to a database

Can you provide a solution?`,
    },
  },
  parameters: {
    docs: {
      description: {
        story:
          'Shows a message with multi-line content. The copy button will copy all content including line breaks.',
      },
    },
  },
}

// Tool call stories
const baseBashToolEvent: ConversationEvent = {
  approvalId: 'approval-123',
  approvalStatus: 'pending' as const,
  claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
  content: undefined,
  createdAt: new Date('2025-09-18T18:44:48Z'),
  eventType: 'tool_call' as const,
  id: 3,
  isCompleted: false,
  role: 'assistant' as const,
  sequence: 3,
  sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
  toolName: 'Bash',
  toolInputJson: JSON.stringify({
    command: 'ls -la',
    description: 'List all files in current directory',
  }),
}

export const BashToolCallPending: Story = {
  args: {
    event: baseBashToolEvent,
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
}

export const BashToolCallApproved: Story = {
  args: {
    ...BashToolCallPending.args,
    event: {
      ...baseBashToolEvent,
      approvalStatus: 'approved' as const,
    },
  },
}

export const BashToolCallCompleted: Story = {
  args: {
    ...BashToolCallPending.args,
    event: {
      ...baseBashToolEvent,
      approvalStatus: 'approved' as const,
      isCompleted: true,
    },
  },
}

export const BashToolCallDenied: Story = {
  args: {
    ...BashToolCallPending.args,
    event: {
      ...baseBashToolEvent,
      approvalStatus: 'denied' as const,
    },
  },
}

export const BashToolCallWithTimeout: Story = {
  args: {
    ...BashToolCallPending.args,
    event: {
      ...baseBashToolEvent,
      toolInputJson: JSON.stringify({
        command: 'npm install',
        description: 'Install dependencies',
        timeout: 60000,
      }),
    },
  },
}

export const BashToolCallBackgroundJob: Story = {
  args: {
    ...BashToolCallPending.args,
    event: {
      ...baseBashToolEvent,
      toolInputJson: JSON.stringify({
        command: 'npm run dev',
        description: 'Start development server',
        run_in_background: true,
      }),
    },
  },
}

export const BashToolCallLongCommand: Story = {
  args: {
    ...BashToolCallPending.args,
    event: {
      ...baseBashToolEvent,
      toolInputJson: JSON.stringify({
        command:
          'git log --graph --pretty=format:"%Cred%h%Creset -%C(yellow)%d%Creset %s %Cgreen(%cr) %C(bold blue)<%an>%Creset" --abbrev-commit --date=relative --branches',
        description: 'Show git history with graph',
      }),
    },
  },
}

// Read Tool Stories
const baseReadToolEvent: ConversationEvent = {
  approvalId: undefined,
  approvalStatus: undefined,
  claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
  content: undefined,
  createdAt: new Date('2025-09-18T18:44:49Z'),
  eventType: 'tool_call' as const,
  id: 4,
  isCompleted: false,
  role: 'assistant' as const,
  sequence: 4,
  sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
  toolName: 'Read',
  toolInputJson: JSON.stringify({
    file_path: '/src/components/Button.tsx',
  }),
}

export const ReadToolPending: Story = {
  args: {
    event: baseReadToolEvent,
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
}

export const ReadToolCompleted: Story = {
  args: {
    ...ReadToolPending.args,
    event: {
      ...baseReadToolEvent,
      isCompleted: true,
      toolResultContent: `import React from 'react';

interface ButtonProps {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}

export function Button({ label, onClick, variant = 'primary' }: ButtonProps) {
  return (
    <button
      className={\`btn btn-\${variant}\`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}`,
    },
  },
}

export const ReadToolWithLongPath: Story = {
  args: {
    ...ReadToolPending.args,
    event: {
      ...baseReadToolEvent,
      toolInputJson: JSON.stringify({
        file_path:
          '/Users/johndoe/Projects/my-awesome-application/src/components/features/authentication/LoginForm/LoginForm.tsx',
      }),
    },
  },
}

export const ReadToolWithOffsetLimit: Story = {
  args: {
    ...ReadToolPending.args,
    event: {
      ...baseReadToolEvent,
      toolInputJson: JSON.stringify({
        file_path: '/src/utils/helpers.ts',
        offset: 50,
        limit: 100,
      }),
    },
  },
}

export const ReadToolCompletedLarge: Story = {
  args: {
    ...ReadToolPending.args,
    event: {
      ...baseReadToolEvent,
      isCompleted: true,
      toolResultContent: Array(500)
        .fill(null)
        .map((_, i) => `Line ${i + 1}: Some code content here`)
        .join('\n'),
    },
  },
}

export const ReadToolFocused: Story = {
  args: {
    ...ReadToolCompleted.args,
    isFocused: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows a focused Read tool call with expand hint visible.',
      },
    },
  },
}

// Write Tool Stories
const baseWriteToolEvent: ConversationEvent = {
  approvalId: 'approval-456',
  approvalStatus: 'pending' as const,
  claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
  content: undefined,
  createdAt: new Date('2025-09-18T18:44:50Z'),
  eventType: 'tool_call' as const,
  id: 5,
  isCompleted: false,
  role: 'assistant' as const,
  sequence: 5,
  sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
  toolName: 'Write',
  toolInputJson: JSON.stringify({
    file_path: '/src/utils/newFile.ts',
    content: `export function calculate(a: number, b: number): number {
  return a + b;
}

export function format(value: number): string {
  return value.toLocaleString();
}`,
  }),
}

export const WriteToolPendingNewFile: Story = {
  args: {
    event: baseWriteToolEvent,
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
    fileSnapshot: '',
  },
}

export const WriteToolPendingWithDiff: Story = {
  args: {
    ...WriteToolPendingNewFile.args,
    event: {
      ...baseWriteToolEvent,
      toolInputJson: JSON.stringify({
        file_path: '/src/utils/existing.ts',
        content: `// Updated version
export function calculate(a: number, b: number): number {
  const result = a + b;
  console.log('Result:', result);
  return result;
}`,
      }),
    },
    fileSnapshot: `export function calculate(a: number, b: number): number {
  return a + b;
}`,
  },
}

export const WriteToolCompleted: Story = {
  args: {
    ...WriteToolPendingNewFile.args,
    event: {
      ...baseWriteToolEvent,
      approvalStatus: 'approved' as const,
      isCompleted: true,
      toolResultContent: '',
    },
  },
}

export const WriteToolDenied: Story = {
  args: {
    ...WriteToolPendingNewFile.args,
    event: {
      ...baseWriteToolEvent,
      approvalStatus: 'denied' as const,
    },
  },
}

export const WriteToolError: Story = {
  args: {
    ...WriteToolPendingNewFile.args,
    event: {
      ...baseWriteToolEvent,
      approvalStatus: 'approved' as const,
      isCompleted: true,
      toolResultContent: 'Error: Permission denied - cannot write to system directory',
    },
  },
}

export const WriteToolLongContent: Story = {
  args: {
    ...WriteToolPendingNewFile.args,
    event: {
      ...baseWriteToolEvent,
      toolInputJson: JSON.stringify({
        file_path: '/src/components/ComplexComponent.tsx',
        content: Array(100)
          .fill(null)
          .map((_, i) => `  // Line ${i + 1}: Some component code here`)
          .join('\n'),
      }),
    },
    fileSnapshot: Array(50)
      .fill(null)
      .map((_, i) => `  // Original line ${i + 1}`)
      .join('\n'),
  },
}

// Edit Tool Stories
const baseEditToolEvent: ConversationEvent = {
  approvalId: 'approval-789',
  approvalStatus: 'pending' as const,
  claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
  content: undefined,
  createdAt: new Date('2025-09-18T18:44:51Z'),
  eventType: 'tool_call' as const,
  id: 6,
  isCompleted: false,
  role: 'assistant' as const,
  sequence: 6,
  sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
  toolName: 'Edit',
  toolInputJson: JSON.stringify({
    file_path: '/src/components/Button.tsx',
    old_string: 'onClick={onClick}',
    new_string: 'onClick={handleClick}',
  }),
}

export const EditToolPending: Story = {
  args: {
    event: baseEditToolEvent,
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
}

export const EditToolSplitView: Story = {
  args: {
    ...EditToolPending.args,
    event: {
      ...baseEditToolEvent,
      toolInputJson: JSON.stringify({
        file_path: '/src/utils/validators.ts',
        old_string: `function validateEmail(email: string): boolean {
  return email.includes('@');
}`,
        new_string: `function validateEmail(email: string): boolean {
  const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  return emailRegex.test(email);
}`,
      }),
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows Edit tool with split view diff. Click the toggle button to switch views.',
      },
    },
  },
}

export const EditToolReplaceAll: Story = {
  args: {
    ...EditToolPending.args,
    event: {
      ...baseEditToolEvent,
      toolInputJson: JSON.stringify({
        file_path: '/src/config.ts',
        old_string: 'localhost',
        new_string: 'api.example.com',
        replace_all: true,
      }),
    },
  },
}

export const EditToolCompleted: Story = {
  args: {
    ...EditToolPending.args,
    event: {
      ...baseEditToolEvent,
      approvalStatus: 'approved' as const,
      isCompleted: true,
      toolResultContent:
        "The file /src/components/Button.tsx has been updated. Here's the result of running `cat -n` on a snippet of the edited file:",
    },
  },
}

export const EditToolDenied: Story = {
  args: {
    ...EditToolPending.args,
    event: {
      ...baseEditToolEvent,
      approvalStatus: 'denied' as const,
    },
  },
}

export const EditToolError: Story = {
  args: {
    ...EditToolPending.args,
    event: {
      ...baseEditToolEvent,
      approvalStatus: 'approved' as const,
      isCompleted: true,
      toolResultContent: 'Error: Found 3 matches of the string to replace, but replace_all is false',
    },
  },
}

export const EditToolMultiLineEdit: Story = {
  args: {
    ...EditToolPending.args,
    event: {
      ...baseEditToolEvent,
      toolInputJson: JSON.stringify({
        file_path: '/src/components/Header.tsx',
        old_string: `<header className="header">
      <h1>Welcome</h1>
      <nav>
        <ul>
          <li>Home</li>
          <li>About</li>
        </ul>
      </nav>
    </header>`,
        new_string: `<header className="header-main">
      <div className="header-content">
        <h1 className="title">Welcome to Our Site</h1>
        <nav className="navigation">
          <ul className="nav-list">
            <li className="nav-item">Home</li>
            <li className="nav-item">About</li>
            <li className="nav-item">Contact</li>
          </ul>
        </nav>
      </div>
    </header>`,
      }),
    },
  },
}

// Grep Tool Stories
const baseGrepToolEvent: ConversationEvent = {
  approvalId: 'approval-grep-1',
  approvalStatus: 'pending' as const,
  claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
  content: undefined,
  createdAt: new Date('2025-09-18T18:44:52Z'),
  eventType: 'tool_call' as const,
  id: 7,
  isCompleted: false,
  role: 'assistant' as const,
  sequence: 7,
  sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
  toolName: 'Grep',
  toolInputJson: JSON.stringify({
    pattern: 'function.*export',
    path: '/src',
  }),
}

export const GrepContentMode: Story = {
  args: {
    event: {
      ...baseGrepToolEvent,
      toolInputJson: JSON.stringify({
        pattern: 'TODO',
        path: '/src',
        output_mode: 'content',
        '-n': true,
        '-A': 2,
        '-B': 1,
      }),
    },
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
}

export const GrepFilesMode: Story = {
  args: {
    ...GrepContentMode.args,
    event: {
      ...baseGrepToolEvent,
      toolInputJson: JSON.stringify({
        pattern: 'import.*React',
        path: '/src',
        output_mode: 'files_with_matches',
        type: 'tsx',
      }),
      isCompleted: true,
      toolResultContent: `/src/components/Button.tsx
/src/components/Header.tsx
/src/components/Footer.tsx
/src/pages/Home.tsx
/src/pages/About.tsx`,
    },
  },
}

export const GrepCountMode: Story = {
  args: {
    ...GrepContentMode.args,
    event: {
      ...baseGrepToolEvent,
      toolInputJson: JSON.stringify({
        pattern: 'console\\.log',
        path: '/src',
        output_mode: 'count',
      }),
      isCompleted: true,
      toolResultContent: `/src/utils/debug.js:47
/src/components/Logger.js:12
/src/api/client.js:3
/src/test/helpers.js:28`,
    },
  },
}

export const GrepCaseInsensitive: Story = {
  args: {
    ...GrepContentMode.args,
    event: {
      ...baseGrepToolEvent,
      toolInputJson: JSON.stringify({
        pattern: 'error',
        path: '/src/utils',
        '-i': true,
        glob: '*.ts',
      }),
      isCompleted: true,
      toolResultContent: `/src/utils/errors.ts
/src/utils/validation.ts
/src/utils/logger.ts`,
    },
  },
}

export const GrepNoMatches: Story = {
  args: {
    ...GrepContentMode.args,
    event: {
      ...baseGrepToolEvent,
      toolInputJson: JSON.stringify({
        pattern: 'nonexistentpattern',
        path: '/src',
      }),
      isCompleted: true,
      toolResultContent: '',
    },
  },
}

export const GrepMultiline: Story = {
  args: {
    ...GrepContentMode.args,
    event: {
      ...baseGrepToolEvent,
      toolInputJson: JSON.stringify({
        pattern: 'interface.*{[\\s\\S]*?}',
        path: '/src/types',
        multiline: true,
        output_mode: 'content',
      }),
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows grep with multiline pattern matching across line boundaries.',
      },
    },
  },
}

// Glob Tool Stories
const baseGlobToolEvent: ConversationEvent = {
  approvalId: 'approval-glob-1',
  approvalStatus: 'pending' as const,
  claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
  content: undefined,
  createdAt: new Date('2025-09-18T18:44:53Z'),
  eventType: 'tool_call' as const,
  id: 8,
  isCompleted: false,
  role: 'assistant' as const,
  sequence: 8,
  sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
  toolName: 'Glob',
  toolInputJson: JSON.stringify({
    pattern: '**/*.tsx',
  }),
}

export const GlobSimplePattern: Story = {
  args: {
    event: baseGlobToolEvent,
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
}

export const GlobComplexPattern: Story = {
  args: {
    ...GlobSimplePattern.args,
    event: {
      ...baseGlobToolEvent,
      toolInputJson: JSON.stringify({
        pattern: 'src/**/*.{ts,tsx,js,jsx}',
        path: '/Users/johndoe/Projects/myapp',
      }),
      isCompleted: true,
      toolResultContent: `/Users/johndoe/Projects/myapp/src/index.tsx
/Users/johndoe/Projects/myapp/src/App.tsx
/Users/johndoe/Projects/myapp/src/components/Button.tsx
/Users/johndoe/Projects/myapp/src/components/Header.tsx
/Users/johndoe/Projects/myapp/src/utils/helpers.ts
/Users/johndoe/Projects/myapp/src/utils/validators.ts
/Users/johndoe/Projects/myapp/src/api/client.ts
/Users/johndoe/Projects/myapp/src/types/index.ts`,
    },
  },
}

export const GlobNoMatches: Story = {
  args: {
    ...GlobSimplePattern.args,
    event: {
      ...baseGlobToolEvent,
      toolInputJson: JSON.stringify({
        pattern: '*.nonexistent',
      }),
      isCompleted: true,
      toolResultContent: '',
    },
  },
}

export const GlobTestFiles: Story = {
  args: {
    ...GlobSimplePattern.args,
    event: {
      ...baseGlobToolEvent,
      toolInputJson: JSON.stringify({
        pattern: '**/*.test.{ts,tsx}',
      }),
      isCompleted: true,
      toolResultContent: `/src/components/Button.test.tsx
/src/components/Header.test.tsx
/src/utils/helpers.test.ts
/src/utils/validators.test.ts
/src/api/client.test.ts`,
    },
  },
}

// LS Tool Stories
const baseLSToolEvent: ConversationEvent = {
  approvalId: 'approval-ls-1',
  approvalStatus: 'pending' as const,
  claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
  content: undefined,
  createdAt: new Date('2025-09-18T18:44:54Z'),
  eventType: 'tool_call' as const,
  id: 9,
  isCompleted: false,
  role: 'assistant' as const,
  sequence: 9,
  sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
  toolName: 'LS',
  toolInputJson: JSON.stringify({
    path: '/src/components',
  }),
}

export const LSDirectory: Story = {
  args: {
    event: baseLSToolEvent,
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
}

export const LSRecursive: Story = {
  args: {
    ...LSDirectory.args,
    event: {
      ...baseLSToolEvent,
      toolInputJson: JSON.stringify({
        path: '/src',
        recursive: true,
      }),
      isCompleted: true,
      toolResultContent: `/src/
├── components/
│   ├── Button.tsx
│   ├── Button.test.tsx
│   ├── Header.tsx
│   ├── Header.test.tsx
│   └── Footer.tsx
├── utils/
│   ├── helpers.ts
│   ├── helpers.test.ts
│   ├── validators.ts
│   └── validators.test.ts
├── api/
│   ├── client.ts
│   └── client.test.ts
├── types/
│   └── index.ts
├── App.tsx
└── index.tsx`,
    },
  },
}

export const LSEmptyDirectory: Story = {
  args: {
    ...LSDirectory.args,
    event: {
      ...baseLSToolEvent,
      toolInputJson: JSON.stringify({
        path: '/src/empty-folder',
      }),
      isCompleted: true,
      toolResultContent: '',
    },
  },
}

export const LSWithHiddenFiles: Story = {
  args: {
    ...LSDirectory.args,
    event: {
      ...baseLSToolEvent,
      toolInputJson: JSON.stringify({
        path: '/',
      }),
      isCompleted: true,
      toolResultContent: `.git/
.gitignore
.env
.env.example
.prettierrc
.eslintrc.js
README.md
package.json
tsconfig.json
src/
public/
node_modules/`,
    },
  },
}
