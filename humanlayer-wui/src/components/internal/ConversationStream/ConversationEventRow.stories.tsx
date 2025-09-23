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

// Task Tool Stories
const baseTaskToolEvent: ConversationEvent = {
  approvalId: 'approval-task-1',
  approvalStatus: 'pending' as const,
  claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
  content: undefined,
  createdAt: new Date('2025-09-18T18:44:55Z'),
  eventType: 'tool_call' as const,
  id: 10,
  isCompleted: false,
  role: 'assistant' as const,
  sequence: 10,
  sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
  toolName: 'Task',
  toolInputJson: JSON.stringify({
    description: 'Find authentication logic',
    prompt:
      'Search the codebase for authentication implementation, including login, logout, and session management',
    subagent_type: 'codebase-locator',
  }),
}

export const TaskCodebaseLocator: Story = {
  args: {
    event: baseTaskToolEvent,
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
}

export const TaskWebSearcher: Story = {
  args: {
    ...TaskCodebaseLocator.args,
    event: {
      ...baseTaskToolEvent,
      toolInputJson: JSON.stringify({
        description: 'Research React 19 features',
        prompt:
          'Find information about the latest React 19 features and breaking changes, focusing on the new hooks and performance improvements',
        subagent_type: 'web-search-researcher',
      }),
    },
  },
}

export const TaskCompleted: Story = {
  args: {
    ...TaskCodebaseLocator.args,
    event: {
      ...baseTaskToolEvent,
      approvalStatus: 'approved' as const,
      isCompleted: true,
      toolResultContent: `Found 12 files related to authentication:

/src/auth/login.tsx - Main login component with form validation
/src/auth/logout.tsx - Logout handler and cleanup logic
/src/auth/session.ts - Session management utilities
/src/auth/hooks/useAuth.ts - Custom authentication hook
/src/api/auth.ts - Authentication API endpoints
/src/middleware/authMiddleware.ts - Route protection middleware
/src/components/LoginForm.tsx - Reusable login form component
/src/components/ProtectedRoute.tsx - Protected route wrapper
/src/stores/authStore.ts - Authentication state management
/src/types/auth.ts - Authentication type definitions
/src/utils/tokens.ts - JWT token utilities
/config/auth.config.ts - Authentication configuration

Key findings:
- Authentication uses JWT tokens stored in httpOnly cookies
- Session management includes refresh token rotation
- Protected routes use HOC pattern with middleware
- Auth state managed via Zustand store`,
    },
  },
}

export const TaskCodebaseAnalyzer: Story = {
  args: {
    ...TaskCodebaseLocator.args,
    event: {
      ...baseTaskToolEvent,
      toolInputJson: JSON.stringify({
        description: 'Analyze database schema',
        prompt:
          'Analyze the database schema and models to understand the data structure and relationships',
        subagent_type: 'codebase-analyzer',
      }),
      approvalStatus: 'approved' as const,
      isCompleted: true,
      toolResultContent:
        'Database schema analysis complete. Found 15 models with complex relationships including User, Post, Comment, and Tag entities.',
    },
  },
}

export const TaskGeneralPurpose: Story = {
  args: {
    ...TaskCodebaseLocator.args,
    event: {
      ...baseTaskToolEvent,
      toolInputJson: JSON.stringify({
        description: 'Refactor API client',
        prompt:
          'Refactor the API client to use async/await instead of promises and add proper error handling',
        subagent_type: 'general-purpose',
      }),
    },
  },
}

export const TaskThoughtsLocator: Story = {
  args: {
    ...TaskCodebaseLocator.args,
    event: {
      ...baseTaskToolEvent,
      toolInputJson: JSON.stringify({
        description: 'Find design decisions',
        prompt:
          'Look for any documented design decisions or architecture notes related to the authentication system',
        subagent_type: 'thoughts-locator',
      }),
      isCompleted: true,
      toolResultContent:
        'Found 3 relevant documents in thoughts/ directory discussing authentication architecture decisions.',
    },
  },
}

// TodoWrite Tool Stories
const baseTodoWriteToolEvent: ConversationEvent = {
  approvalId: undefined,
  approvalStatus: undefined,
  claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
  content: undefined,
  createdAt: new Date('2025-09-18T18:44:56Z'),
  eventType: 'tool_call' as const,
  id: 11,
  isCompleted: false,
  role: 'assistant' as const,
  sequence: 11,
  sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
  toolName: 'TodoWrite',
  toolInputJson: JSON.stringify({
    todos: [
      {
        content: 'Set up project structure',
        status: 'completed',
        activeForm: 'Setting up project structure',
      },
      { content: 'Install dependencies', status: 'completed', activeForm: 'Installing dependencies' },
      {
        content: 'Create main components',
        status: 'in_progress',
        activeForm: 'Creating main components',
      },
      { content: 'Add routing', status: 'pending', activeForm: 'Adding routing' },
      {
        content: 'Implement state management',
        status: 'pending',
        activeForm: 'Implementing state management',
      },
    ],
  }),
}

export const TodoWriteAllPending: Story = {
  args: {
    event: {
      ...baseTodoWriteToolEvent,
      toolInputJson: JSON.stringify({
        todos: [
          { content: 'Analyze requirements', status: 'pending', activeForm: 'Analyzing requirements' },
          {
            content: 'Design database schema',
            status: 'pending',
            activeForm: 'Designing database schema',
          },
          { content: 'Create API endpoints', status: 'pending', activeForm: 'Creating API endpoints' },
          { content: 'Build UI components', status: 'pending', activeForm: 'Building UI components' },
        ],
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

export const TodoWriteInProgress: Story = {
  args: {
    event: baseTodoWriteToolEvent,
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
}

export const TodoWriteCompleted: Story = {
  args: {
    ...TodoWriteInProgress.args,
    event: {
      ...baseTodoWriteToolEvent,
      toolInputJson: JSON.stringify({
        todos: [
          {
            content: 'Set up project structure',
            status: 'completed',
            activeForm: 'Setting up project structure',
          },
          {
            content: 'Install dependencies',
            status: 'completed',
            activeForm: 'Installing dependencies',
          },
          {
            content: 'Create main components',
            status: 'completed',
            activeForm: 'Creating main components',
          },
          { content: 'Add routing', status: 'completed', activeForm: 'Adding routing' },
          {
            content: 'Implement state management',
            status: 'completed',
            activeForm: 'Implementing state management',
          },
        ],
      }),
      isCompleted: true,
    },
  },
}

export const TodoWriteFocused: Story = {
  args: {
    ...TodoWriteInProgress.args,
    isFocused: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows a focused TodoWrite tool call with expanded todo list visible.',
      },
    },
  },
}

export const TodoWriteLongList: Story = {
  args: {
    ...TodoWriteInProgress.args,
    event: {
      ...baseTodoWriteToolEvent,
      toolInputJson: JSON.stringify({
        todos: [
          {
            content: 'Research existing solutions',
            status: 'completed',
            activeForm: 'Researching existing solutions',
          },
          {
            content: 'Define project requirements',
            status: 'completed',
            activeForm: 'Defining project requirements',
          },
          {
            content: 'Set up development environment',
            status: 'completed',
            activeForm: 'Setting up development environment',
          },
          {
            content: 'Initialize Git repository',
            status: 'completed',
            activeForm: 'Initializing Git repository',
          },
          {
            content: 'Create project scaffolding',
            status: 'completed',
            activeForm: 'Creating project scaffolding',
          },
          {
            content: 'Configure build tools',
            status: 'in_progress',
            activeForm: 'Configuring build tools',
          },
          {
            content: 'Set up testing framework',
            status: 'pending',
            activeForm: 'Setting up testing framework',
          },
          {
            content: 'Create database models',
            status: 'pending',
            activeForm: 'Creating database models',
          },
          {
            content: 'Implement authentication',
            status: 'pending',
            activeForm: 'Implementing authentication',
          },
          { content: 'Build API endpoints', status: 'pending', activeForm: 'Building API endpoints' },
          { content: 'Design UI mockups', status: 'pending', activeForm: 'Designing UI mockups' },
          {
            content: 'Implement frontend components',
            status: 'pending',
            activeForm: 'Implementing frontend components',
          },
          { content: 'Add form validation', status: 'pending', activeForm: 'Adding form validation' },
          {
            content: 'Integrate with external APIs',
            status: 'pending',
            activeForm: 'Integrating with external APIs',
          },
          { content: 'Write unit tests', status: 'pending', activeForm: 'Writing unit tests' },
          {
            content: 'Perform integration testing',
            status: 'pending',
            activeForm: 'Performing integration testing',
          },
          { content: 'Deploy to staging', status: 'pending', activeForm: 'Deploying to staging' },
          { content: 'Conduct user testing', status: 'pending', activeForm: 'Conducting user testing' },
          { content: 'Fix reported bugs', status: 'pending', activeForm: 'Fixing reported bugs' },
          { content: 'Deploy to production', status: 'pending', activeForm: 'Deploying to production' },
        ],
      }),
    },
  },
}

// WebSearch Tool Stories
const baseWebSearchToolEvent: ConversationEvent = {
  approvalId: 'approval-websearch-1',
  approvalStatus: 'pending' as const,
  claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
  content: undefined,
  createdAt: new Date('2025-09-18T18:44:57Z'),
  eventType: 'tool_call' as const,
  id: 12,
  isCompleted: false,
  role: 'assistant' as const,
  sequence: 12,
  sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
  toolName: 'WebSearch',
  toolInputJson: JSON.stringify({
    query: 'React 19 new features and changes',
  }),
}

export const WebSearchSimple: Story = {
  args: {
    event: baseWebSearchToolEvent,
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
}

export const WebSearchWithDomainFilter: Story = {
  args: {
    ...WebSearchSimple.args,
    event: {
      ...baseWebSearchToolEvent,
      toolInputJson: JSON.stringify({
        query: 'TypeScript best practices 2025',
        allowed_domains: ['typescript.org', 'microsoft.com', 'github.com'],
      }),
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows web search with allowed domain filters to restrict results to specific sites.',
      },
    },
  },
}

export const WebSearchWithBlockedDomains: Story = {
  args: {
    ...WebSearchSimple.args,
    event: {
      ...baseWebSearchToolEvent,
      toolInputJson: JSON.stringify({
        query: 'JavaScript frameworks comparison',
        blocked_domains: ['medium.com', 'dev.to'],
      }),
    },
  },
}

export const WebSearchCompleted: Story = {
  args: {
    ...WebSearchSimple.args,
    event: {
      ...baseWebSearchToolEvent,
      approvalStatus: 'approved' as const,
      isCompleted: true,
      toolResultContent: `Found 8 results for "React 19 new features and changes"

1. React 19 Release Notes - Official React Blog
2. What's New in React 19: A Complete Guide
3. Breaking Changes in React 19 You Need to Know
4. React 19: New Hooks and Performance Improvements
5. Migrating from React 18 to React 19
6. React 19 Server Components Deep Dive
7. React 19 Concurrent Features Explained
8. Community Reactions to React 19`,
    },
  },
}

export const WebSearchNoResults: Story = {
  args: {
    ...WebSearchSimple.args,
    event: {
      ...baseWebSearchToolEvent,
      toolInputJson: JSON.stringify({
        query: 'extremely specific technical query with no matches',
      }),
      isCompleted: true,
      toolResultContent: '',
    },
  },
}

export const WebSearchFocused: Story = {
  args: {
    ...WebSearchCompleted.args,
    isFocused: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows a focused web search with expand hint for viewing full results.',
      },
    },
  },
}

// WebFetch Tool Stories
const baseWebFetchToolEvent: ConversationEvent = {
  approvalId: 'approval-webfetch-1',
  approvalStatus: 'pending' as const,
  claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
  content: undefined,
  createdAt: new Date('2025-09-18T18:44:58Z'),
  eventType: 'tool_call' as const,
  id: 13,
  isCompleted: false,
  role: 'assistant' as const,
  sequence: 13,
  sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
  toolName: 'WebFetch',
  toolInputJson: JSON.stringify({
    url: 'https://react.dev/blog/2025/01/15/react-19',
  }),
}

export const WebFetchSimple: Story = {
  args: {
    event: baseWebFetchToolEvent,
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
}

export const WebFetchWithPrompt: Story = {
  args: {
    ...WebFetchSimple.args,
    event: {
      ...baseWebFetchToolEvent,
      toolInputJson: JSON.stringify({
        url: 'https://docs.github.com/en/actions/learn-github-actions',
        prompt: 'Extract information about workflow syntax and job configuration',
      }),
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows web fetch with a prompt to guide content extraction.',
      },
    },
  },
}

export const WebFetchCompleted: Story = {
  args: {
    ...WebFetchSimple.args,
    event: {
      ...baseWebFetchToolEvent,
      approvalStatus: 'approved' as const,
      isCompleted: true,
      toolResultContent: `# React 19 Release Notes

React 19 is now stable! This release brings several major improvements...

## New Features

### React Compiler
The React Compiler is no longer experimental and can optimize your components...

### Server Components
Server Components are now stable and ready for production use...

### New Hooks
- useFormStatus: Track form submission state
- useOptimistic: Optimistic UI updates
- use: Simplified data fetching

## Breaking Changes

- Removed defaultProps in favor of default parameters
- Stricter hydration mismatch errors
- Updated TypeScript requirements

[Content continues for 15KB...]`,
    },
  },
}

export const WebFetchError: Story = {
  args: {
    ...WebFetchSimple.args,
    event: {
      ...baseWebFetchToolEvent,
      toolInputJson: JSON.stringify({
        url: 'https://example.com/nonexistent-page',
      }),
      approvalStatus: 'approved' as const,
      isCompleted: true,
      toolResultContent: 'Error: Failed to fetch URL - 404 Not Found',
    },
  },
}

export const WebFetchLongUrl: Story = {
  args: {
    ...WebFetchSimple.args,
    event: {
      ...baseWebFetchToolEvent,
      toolInputJson: JSON.stringify({
        url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all?section=examples&subsection=handling-errors&filter=modern',
      }),
    },
  },
}

export const WebFetchFocused: Story = {
  args: {
    ...WebFetchCompleted.args,
    isFocused: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows a focused web fetch with expand hint for viewing full content.',
      },
    },
  },
}

// MultiEdit Tool Stories
const baseMultiEditToolEvent: ConversationEvent = {
  approvalId: 'approval-multiedit-1',
  approvalStatus: 'pending' as const,
  claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
  content: undefined,
  createdAt: new Date('2025-09-18T18:44:57Z'),
  eventType: 'tool_call' as const,
  id: 13,
  isCompleted: false,
  role: 'assistant' as const,
  sequence: 13,
  sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
  toolName: 'MultiEdit',
  toolInputJson: JSON.stringify({
    file_path: '/src/components/Header.tsx',
    edits: [
      { old_string: 'className="header"', new_string: 'className="header-main"' },
      { old_string: '<h1>Welcome</h1>', new_string: '<h1>Welcome to Our App</h1>' },
      { old_string: 'Home', new_string: 'Dashboard', replace_all: true },
    ],
  }),
}

export const MultiEditSimple: Story = {
  args: {
    event: baseMultiEditToolEvent,
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
}

export const MultiEditWithReplaceAll: Story = {
  args: {
    ...MultiEditSimple.args,
    event: {
      ...baseMultiEditToolEvent,
      toolInputJson: JSON.stringify({
        file_path: '/src/config/settings.ts',
        edits: [
          { old_string: 'localhost', new_string: 'api.example.com', replace_all: true },
          { old_string: '3000', new_string: '8080', replace_all: true },
          { old_string: 'debug: true', new_string: 'debug: false' },
        ],
      }),
    },
  },
}

export const MultiEditComplexDiff: Story = {
  args: {
    ...MultiEditSimple.args,
    event: {
      ...baseMultiEditToolEvent,
      toolInputJson: JSON.stringify({
        file_path: '/src/utils/validators.ts',
        edits: [
          {
            old_string: 'function validateEmail(email) { return email.includes("@"); }',
            new_string:
              'function validateEmail(email) { const regex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/; return regex.test(email); }',
          },
          {
            old_string: 'function validatePhone(phone) { return phone.length === 10; }',
            new_string:
              'function validatePhone(phone) { const cleaned = phone.replace(/\\D/g, ""); return cleaned.length === 10; }',
          },
        ],
      }),
    },
    fileSnapshot: `function validateEmail(email) { return email.includes("@"); }
function validatePhone(phone) { return phone.length === 10; }
function validateZipCode(zip) { return zip.length === 5; }`,
  },
}

export const MultiEditCompleted: Story = {
  args: {
    ...MultiEditSimple.args,
    event: {
      ...baseMultiEditToolEvent,
      approvalStatus: 'approved' as const,
      isCompleted: true,
      toolResultContent: '3 edits applied successfully',
    },
  },
}

// NotebookRead Tool Stories
const baseNotebookReadToolEvent: ConversationEvent = {
  approvalId: 'approval-notebookread-1',
  approvalStatus: 'pending' as const,
  claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
  content: undefined,
  createdAt: new Date('2025-09-18T18:44:57Z'),
  eventType: 'tool_call' as const,
  id: 14,
  isCompleted: false,
  role: 'assistant' as const,
  sequence: 14,
  sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
  toolName: 'NotebookRead',
  toolInputJson: JSON.stringify({
    notebook_path: '/notebooks/data_analysis.ipynb',
  }),
}

export const NotebookReadFullFile: Story = {
  args: {
    event: baseNotebookReadToolEvent,
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
}

export const NotebookReadSingleCell: Story = {
  args: {
    ...NotebookReadFullFile.args,
    event: {
      ...baseNotebookReadToolEvent,
      toolInputJson: JSON.stringify({
        notebook_path: '/notebooks/data_analysis.ipynb',
        cell_id: 'cell_3_code',
      }),
    },
  },
}

export const NotebookReadCompleted: Story = {
  args: {
    ...NotebookReadFullFile.args,
    event: {
      ...baseNotebookReadToolEvent,
      isCompleted: true,
      toolResultContent: '[Cell 1 - markdown]: # Data Analysis\n[Cell 2 - code]: import pandas as pd',
    },
  },
}

// NotebookEdit Tool Stories
const baseNotebookEditToolEvent: ConversationEvent = {
  approvalId: 'approval-notebookedit-1',
  approvalStatus: 'pending' as const,
  claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
  content: undefined,
  createdAt: new Date('2025-09-18T18:44:57Z'),
  eventType: 'tool_call' as const,
  id: 15,
  isCompleted: false,
  role: 'assistant' as const,
  sequence: 15,
  sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
  toolName: 'NotebookEdit',
  toolInputJson: JSON.stringify({
    notebook_path: '/notebooks/data_analysis.ipynb',
    new_source: 'import pandas as pd\nimport numpy as np\n\n# Load data\ndf = pd.read_csv("data.csv")',
    cell_type: 'code',
    edit_mode: 'replace',
  }),
}

export const NotebookEditReplace: Story = {
  args: {
    event: baseNotebookEditToolEvent,
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
}

export const NotebookEditInsert: Story = {
  args: {
    ...NotebookEditReplace.args,
    event: {
      ...baseNotebookEditToolEvent,
      toolInputJson: JSON.stringify({
        notebook_path: '/notebooks/visualization.ipynb',
        cell_id: 'after_cell_2',
        new_source: '# Data Visualization\n\nThis section creates interactive charts using Plotly.',
        cell_type: 'markdown',
        edit_mode: 'insert',
      }),
    },
  },
}

export const NotebookEditDelete: Story = {
  args: {
    ...NotebookEditReplace.args,
    event: {
      ...baseNotebookEditToolEvent,
      toolInputJson: JSON.stringify({
        notebook_path: '/notebooks/cleanup.ipynb',
        cell_id: 'obsolete_cell_5',
        new_source: '',
        edit_mode: 'delete',
      }),
    },
  },
}

export const NotebookEditCompleted: Story = {
  args: {
    ...NotebookEditReplace.args,
    event: {
      ...baseNotebookEditToolEvent,
      approvalStatus: 'approved' as const,
      isCompleted: true,
      toolResultContent: 'Cell updated successfully',
    },
  },
}

// ExitPlanMode Tool Stories
const baseExitPlanModeToolEvent: ConversationEvent = {
  approvalId: 'approval-exitplan-1',
  approvalStatus: 'pending' as const,
  claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
  content: undefined,
  createdAt: new Date('2025-09-18T18:44:57Z'),
  eventType: 'tool_call' as const,
  id: 16,
  isCompleted: false,
  role: 'assistant' as const,
  sequence: 16,
  sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
  toolName: 'ExitPlanMode',
  toolInputJson: JSON.stringify({
    plan: `## Implementation Plan

1. **Set up project structure**
   - Create directories for components, utils, and tests
   - Initialize package.json with dependencies
   - Configure TypeScript and ESLint

2. **Implement core functionality**
   - Create base components
   - Add state management
   - Set up routing

3. **Testing and deployment**
   - Write unit tests
   - Add integration tests
   - Deploy to staging`,
  }),
}

export const ExitPlanModeShort: Story = {
  args: {
    event: {
      ...baseExitPlanModeToolEvent,
      toolInputJson: JSON.stringify({
        plan: '1. Initialize project\n2. Build features\n3. Test\n4. Deploy',
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

export const ExitPlanModeLong: Story = {
  args: {
    event: baseExitPlanModeToolEvent,
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
}

export const ExitPlanModeWithMarkdown: Story = {
  args: {
    ...ExitPlanModeLong.args,
    event: {
      ...baseExitPlanModeToolEvent,
      toolInputJson: JSON.stringify({
        plan: `# Project Roadmap

## Phase 1: Foundation
- **Database Design** - Create schema and relationships
- **API Structure** - RESTful endpoints with OpenAPI spec
- **Authentication** - JWT-based auth with refresh tokens

## Phase 2: Features
- User management system
- File upload capabilities
- Real-time notifications

## Phase 3: Polish
- Performance optimization
- Security audit
- Documentation

> Ready to begin implementation!`,
      }),
    },
  },
}

export const ExitPlanModeCompleted: Story = {
  args: {
    ...ExitPlanModeLong.args,
    event: {
      ...baseExitPlanModeToolEvent,
      approvalStatus: 'approved' as const,
      isCompleted: true,
      toolResultContent: 'Plan mode exited successfully',
    },
  },
}

// MCP Tool stories
const baseMCPLinearToolEvent: ConversationEvent = {
  approvalId: 'approval-mcp-1',
  approvalStatus: 'pending' as const,
  claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
  content: undefined,
  createdAt: new Date('2025-09-19T10:00:00Z'),
  eventType: 'tool_call' as const,
  id: 20,
  isCompleted: false,
  role: 'assistant' as const,
  sequence: 20,
  sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
  toolName: 'mcp__linear__list_issues',
  toolInputJson: JSON.stringify({
    assignee: 'me',
    team: 'engineering',
    limit: 10,
  }),
}

export const MCPLinearListIssues: Story = {
  args: {
    event: baseMCPLinearToolEvent,
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
}

export const MCPLinearListIssuesCompleted: Story = {
  args: {
    ...MCPLinearListIssues.args,
    event: {
      ...baseMCPLinearToolEvent,
      approvalStatus: 'approved' as const,
      isCompleted: true,
      toolResultContent: 'Found 8 issues assigned to you in the engineering team',
    },
  },
}

const baseMCPGitHubToolEvent: ConversationEvent = {
  approvalId: 'approval-mcp-2',
  approvalStatus: 'pending' as const,
  claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
  content: undefined,
  createdAt: new Date('2025-09-19T10:05:00Z'),
  eventType: 'tool_call' as const,
  id: 21,
  isCompleted: false,
  role: 'assistant' as const,
  sequence: 21,
  sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
  toolName: 'mcp__github__create_pr',
  toolInputJson: JSON.stringify({
    repo: 'humanlayer/humanlayer',
    title: 'Add dark mode support',
    body: 'This PR implements dark mode functionality across the application',
    base: 'main',
    head: 'feature/dark-mode',
  }),
}

export const MCPGitHubCreatePR: Story = {
  args: {
    event: baseMCPGitHubToolEvent,
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
}

export const MCPGitHubCreatePRApproved: Story = {
  args: {
    ...MCPGitHubCreatePR.args,
    event: {
      ...baseMCPGitHubToolEvent,
      approvalStatus: 'approved' as const,
    },
  },
}

export const MCPGitHubCreatePRCompleted: Story = {
  args: {
    ...MCPGitHubCreatePR.args,
    event: {
      ...baseMCPGitHubToolEvent,
      approvalStatus: 'approved' as const,
      isCompleted: true,
      toolResultContent: 'Pull request #123 created successfully',
    },
  },
}

const baseMCPGenericToolEvent: ConversationEvent = {
  approvalId: 'approval-mcp-3',
  approvalStatus: 'pending' as const,
  claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
  content: undefined,
  createdAt: new Date('2025-09-19T10:10:00Z'),
  eventType: 'tool_call' as const,
  id: 22,
  isCompleted: false,
  role: 'assistant' as const,
  sequence: 22,
  sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
  toolName: 'mcp__custom_service__complex_method_name',
  toolInputJson: JSON.stringify({
    complexParam: {
      nested: {
        values: [1, 2, 3],
      },
    },
    simpleParam: 'test-value',
    anotherParam: 42,
  }),
}

export const MCPGenericService: Story = {
  args: {
    event: baseMCPGenericToolEvent,
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
}

export const MCPGenericServiceDenied: Story = {
  args: {
    ...MCPGenericService.args,
    event: {
      ...baseMCPGenericToolEvent,
      approvalStatus: 'denied' as const,
    },
  },
}

export const MCPGenericServiceError: Story = {
  args: {
    ...MCPGenericService.args,
    event: {
      ...baseMCPGenericToolEvent,
      approvalStatus: 'approved' as const,
      isCompleted: true,
      toolResultContent: 'Error: Service unavailable - failed to connect to custom_service',
    },
  },
}
