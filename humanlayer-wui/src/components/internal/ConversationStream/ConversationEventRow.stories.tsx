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

// Base events for common message types
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

// Message stories
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
    event: {
      ...baseUserEvent,
      content:
        'Thisisaverylongmessagethatwillneverendnomatterhowhardyoutryitremainsthelongestlineintheworldandwilljustgoonandonandonandonuntileitherthiscomputerimplodesarethissolarsystemreachesitsinevitablesundeath',
    },
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'User message with very long unbroken text to test word wrapping behavior',
      },
    },
  },
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

export const AssistantMessageWithLongCodeBlocks: Story = {
  args: {
    event: {
      ...baseAssistantEvent,
      id: 10,
      sequence: 2,
      content: `\`\`\`
Thisisaverylongmessagethatwillneverendnomatterhowhardyoutryitremainsthelongestlineintheworldandwilljustgoonandonandonandonuntileitherthiscomputerimplodesarethissolarsystemreachesitsinevitablesundeath
\`\`\`

and

\`\`\`
"This is a very long message that will never end no matter how hard you try it remains the longest line in teh world and will go on and on and on and on and on likely until the sun explodes but we all know that won't be for a very long time probably but anyway how do we feel about chickens"
\`\`\``,
      createdAt: new Date('2025-10-02T20:05:14Z'),
    },
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Assistant message with long code blocks to test word wrapping behavior',
      },
    },
  },
}

// Bash Tool - shows background job feature
export const BashToolCall: Story = {
  args: {
    event: {
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
        command: 'npm run dev',
        description: 'Start development server',
        run_in_background: true,
      }),
    },
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Bash tool call with background job execution option',
      },
    },
  },
}

// Bash Tool - shows background job feature
export const BashToolCallLongCommand: Story = {
  args: {
    event: {
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
        command:
          'humanlayer-nightly launch --model opus --dangerously-skip-permissions --title "implement ENG-2090" -w ~/wt/humanlayer/ENG-2090 "/implement_plan and when you are done implementing and all tests pass high five your friends"',
        description: 'Start development server',
        run_in_background: true,
      }),
    },
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Bash tool call with background job execution option',
      },
    },
  },
}

// Read Tool - shows actual file content result
export const ReadToolCall: Story = {
  args: {
    event: {
      approvalId: undefined,
      approvalStatus: undefined,
      claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
      content: undefined,
      createdAt: new Date('2025-09-18T18:44:49Z'),
      eventType: 'tool_call' as const,
      id: 4,
      isCompleted: true,
      role: 'assistant' as const,
      sequence: 4,
      sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
      toolName: 'Read',
      toolInputJson: JSON.stringify({
        file_path: '/src/components/Button.tsx',
      }),
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
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Read tool showing file content with syntax highlighting',
      },
    },
  },
}

// Write Tool - shows diff comparison feature
export const WriteToolCall: Story = {
  args: {
    event: {
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
        file_path: '/src/utils/existing.ts',
        content: `// Updated version
export function calculate(a: number, b: number): number {
  const result = a + b;
  console.log('Result:', result);
  return result;
}`,
      }),
    },
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
    fileSnapshot: `export function calculate(a: number, b: number): number {
  return a + b;
}`,
  },
  parameters: {
    docs: {
      description: {
        story: 'Write tool with diff view showing changes to existing file',
      },
    },
  },
}

// Edit Tool - shows complex multi-line editing
export const EditToolCall: Story = {
  args: {
    event: {
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
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Edit tool showing multi-line HTML structure changes with diff view',
      },
    },
  },
}

// Grep Tool - shows comprehensive search options
export const GrepToolCall: Story = {
  args: {
    event: {
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
  parameters: {
    docs: {
      description: {
        story: 'Grep tool with context lines, line numbers, and content output mode',
      },
    },
  },
}

// Glob Tool - shows complex pattern and results
export const GlobToolCall: Story = {
  args: {
    event: {
      approvalId: 'approval-glob-1',
      approvalStatus: 'pending' as const,
      claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
      content: undefined,
      createdAt: new Date('2025-09-18T18:44:53Z'),
      eventType: 'tool_call' as const,
      id: 8,
      isCompleted: true,
      role: 'assistant' as const,
      sequence: 8,
      sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
      toolName: 'Glob',
      toolInputJson: JSON.stringify({
        pattern: 'src/**/*.{ts,tsx,js,jsx}',
        path: '/Users/johndoe/Projects/myapp',
      }),
      toolResultContent: `/Users/johndoe/Projects/myapp/src/index.tsx
/Users/johndoe/Projects/myapp/src/App.tsx
/Users/johndoe/Projects/myapp/src/components/Button.tsx
/Users/johndoe/Projects/myapp/src/components/Header.tsx
/Users/johndoe/Projects/myapp/src/utils/helpers.ts
/Users/johndoe/Projects/myapp/src/utils/validators.ts
/Users/johndoe/Projects/myapp/src/api/client.ts
/Users/johndoe/Projects/myapp/src/types/index.ts`,
    },
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Glob tool with complex pattern matching multiple file extensions',
      },
    },
  },
}

// LS Tool - shows tree structure output
export const LSToolCall: Story = {
  args: {
    event: {
      approvalId: 'approval-ls-1',
      approvalStatus: 'pending' as const,
      claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
      content: undefined,
      createdAt: new Date('2025-09-18T18:44:54Z'),
      eventType: 'tool_call' as const,
      id: 9,
      isCompleted: true,
      role: 'assistant' as const,
      sequence: 9,
      sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
      toolName: 'LS',
      toolInputJson: JSON.stringify({
        path: '/src',
        recursive: true,
      }),
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
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'LS tool with recursive option showing tree structure',
      },
    },
  },
}

// Task Tool - shows detailed task results
export const TaskToolCall: Story = {
  args: {
    event: {
      approvalId: 'approval-task-1',
      approvalStatus: 'approved' as const,
      claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
      content: undefined,
      createdAt: new Date('2025-09-18T18:44:55Z'),
      eventType: 'tool_call' as const,
      id: 10,
      isCompleted: true,
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
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Task tool showing codebase-locator agent with detailed authentication findings',
      },
    },
  },
}

// TodoWrite Tool - shows mixed status states
export const TodoWriteToolCall: Story = {
  args: {
    event: {
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
          {
            content: 'Install dependencies',
            status: 'completed',
            activeForm: 'Installing dependencies',
          },
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
    },
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'TodoWrite tool showing task list with mixed completion statuses',
      },
    },
  },
}

// WebSearch Tool - shows domain filtering
export const WebSearchToolCall: Story = {
  args: {
    event: {
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
        query: 'TypeScript best practices 2025',
        allowed_domains: ['typescript.org', 'microsoft.com', 'github.com'],
      }),
    },
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'WebSearch tool with domain filtering to restrict results to specific sites',
      },
    },
  },
}

// WebFetch Tool - shows content extraction result
export const WebFetchToolCall: Story = {
  args: {
    event: {
      approvalId: 'approval-webfetch-1',
      approvalStatus: 'approved' as const,
      claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
      content: undefined,
      createdAt: new Date('2025-09-18T18:44:58Z'),
      eventType: 'tool_call' as const,
      id: 13,
      isCompleted: true,
      role: 'assistant' as const,
      sequence: 13,
      sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
      toolName: 'WebFetch',
      toolInputJson: JSON.stringify({
        url: 'https://react.dev/blog/2025/01/15/react-19',
      }),
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
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'WebFetch tool showing extracted content from a web page',
      },
    },
  },
}

// MultiEdit Tool - shows multiple edits with diff
export const MultiEditToolCall: Story = {
  args: {
    event: {
      approvalId: 'approval-multiedit-1',
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
      toolName: 'MultiEdit',
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
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
    fileSnapshot: `function validateEmail(email) { return email.includes("@"); }
function validatePhone(phone) { return phone.length === 10; }
function validateZipCode(zip) { return zip.length === 5; }`,
  },
  parameters: {
    docs: {
      description: {
        story: 'MultiEdit tool showing multiple validation function improvements with diff view',
      },
    },
  },
}

// NotebookRead Tool - shows notebook content output
export const NotebookReadToolCall: Story = {
  args: {
    event: {
      approvalId: 'approval-notebookread-1',
      approvalStatus: 'pending' as const,
      claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
      content: undefined,
      createdAt: new Date('2025-09-18T18:44:57Z'),
      eventType: 'tool_call' as const,
      id: 15,
      isCompleted: true,
      role: 'assistant' as const,
      sequence: 15,
      sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
      toolName: 'NotebookRead',
      toolInputJson: JSON.stringify({
        notebook_path: '/notebooks/data_analysis.ipynb',
      }),
      toolResultContent: '[Cell 1 - markdown]: # Data Analysis\n[Cell 2 - code]: import pandas as pd',
    },
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'NotebookRead tool showing Jupyter notebook content',
      },
    },
  },
}

// NotebookEdit Tool - shows insert mode editing
export const NotebookEditToolCall: Story = {
  args: {
    event: {
      approvalId: 'approval-notebookedit-1',
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
      toolName: 'NotebookEdit',
      toolInputJson: JSON.stringify({
        notebook_path: '/notebooks/visualization.ipynb',
        cell_id: 'after_cell_2',
        new_source: '# Data Visualization\n\nThis section creates interactive charts using Plotly.',
        cell_type: 'markdown',
        edit_mode: 'insert',
      }),
    },
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'NotebookEdit tool showing insert mode for adding new cell',
      },
    },
  },
}

// ExitPlanMode Tool - shows rich markdown plan
export const ExitPlanModeToolCall: Story = {
  args: {
    event: {
      approvalId: 'approval-exitplan-1',
      approvalStatus: 'pending' as const,
      claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
      content: undefined,
      createdAt: new Date('2025-09-18T18:44:57Z'),
      eventType: 'tool_call' as const,
      id: 17,
      isCompleted: false,
      role: 'assistant' as const,
      sequence: 17,
      sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
      toolName: 'ExitPlanMode',
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
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'ExitPlanMode tool showing structured markdown implementation plan',
      },
    },
  },
}

// MCP Linear Tool - shows completed Linear API call
export const MCPLinearToolCall: Story = {
  args: {
    event: {
      approvalId: 'approval-mcp-1',
      approvalStatus: 'approved' as const,
      claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
      content: undefined,
      createdAt: new Date('2025-09-19T10:00:00Z'),
      eventType: 'tool_call' as const,
      id: 18,
      isCompleted: true,
      role: 'assistant' as const,
      sequence: 18,
      sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
      toolName: 'mcp__linear__list_issues',
      toolInputJson: JSON.stringify({
        assignee: 'me',
        team: 'engineering',
        limit: 10,
      }),
      toolResultContent: 'Found 8 issues assigned to you in the engineering team',
    },
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'MCP Linear integration showing issue list query',
      },
    },
  },
}

// MCP GitHub Tool - shows completed GitHub API call
export const MCPGitHubToolCall: Story = {
  name: 'MCP GitHub Tool Call',
  args: {
    event: {
      approvalId: 'approval-mcp-2',
      approvalStatus: 'approved' as const,
      claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
      content: undefined,
      createdAt: new Date('2025-09-19T10:05:00Z'),
      eventType: 'tool_call' as const,
      id: 19,
      isCompleted: true,
      role: 'assistant' as const,
      sequence: 19,
      sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
      toolName: 'mcp__github__create_pr',
      toolInputJson: JSON.stringify({
        repo: 'humanlayer/humanlayer',
        title: 'Add dark mode support',
        body: 'This PR implements dark mode functionality across the application',
        base: 'main',
        head: 'feature/dark-mode',
      }),
      toolResultContent: 'Pull request #123 created successfully',
    },
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'MCP GitHub integration showing pull request creation',
      },
    },
  },
}

// MCP Generic Service Tool - shows generic MCP service call
export const MCPGenericToolCall: Story = {
  args: {
    event: {
      approvalId: 'approval-mcp-3',
      approvalStatus: 'pending' as const,
      claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
      content: undefined,
      createdAt: new Date('2025-09-19T10:10:00Z'),
      eventType: 'tool_call' as const,
      id: 20,
      isCompleted: false,
      role: 'assistant' as const,
      sequence: 20,
      sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
      toolName: 'mcp__custom_service__complex_method_name',
      toolInputJson:
        '{"complexParam":{"test": "abc","nested":{"values":[1,2,3]}},"simpleParam":"test-value","anotherParam":42, "arr": [], "arr2": [1, 2, 3]}',
    },
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Generic MCP service integration with complex nested parameters',
      },
    },
  },
}

// User message with JavaScript code block
export const UserMessageWithCodeBlock: Story = {
  args: {
    event: {
      id: 743,
      sessionId: '3cb4b1e6-1e57-4a76-b3bb-c2a03b7a0563',
      claudeSessionId: '2ddb9694-11f1-4bfe-ac9d-9a9dd6dac356',
      sequence: 1,
      eventType: 'message' as const,
      createdAt: new Date('2025-09-23T18:06:11Z'),
      role: 'user' as const,
      content: "```javascript\nconsole.log('yo');\n```",
      isCompleted: false,
      approvalId: undefined,
      approvalStatus: undefined,
    },
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    shouldIgnoreMouseEvent: () => false,
    isFocused: false,
    isLast: false,
    responseEditorIsFocused: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'User message containing a JavaScript code block with syntax highlighting',
      },
    },
  },
}

// MCP Linear list_issues - shows Linear tickets listing
export const MCPLinearListIssuesToolCall: Story = {
  args: {
    event: {
      approvalId: 'approval-mcp-linear-1',
      approvalStatus: 'approved' as const,
      claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
      content: undefined,
      createdAt: new Date('2025-10-01T15:09:00Z'),
      eventType: 'tool_call' as const,
      id: 21,
      isCompleted: true,
      role: 'assistant' as const,
      sequence: 21,
      sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
      toolName: 'mcp__linear__list_issues',
      toolInputJson: JSON.stringify({
        limit: 10,
        includeArchived: false,
      }),
      toolResultContent: `Found 8 issues:

1. **ENG-2219** - Add MCP tool event content storybook story
   Status: In Progress | Priority: High
   Assignee: @nyx | Updated: 2025-10-01
   https://linear.app/humanlayer/issue/ENG-2219

2. **ENG-2218** - Improve welcome message on first use
   Status: Done | Priority: Medium
   Assignee: @dexter | Updated: 2025-09-30
   https://linear.app/humanlayer/issue/ENG-2218

3. **ENG-2123** - Consolidate session launch modal with SessionDetail view
   Status: Done | Priority: High
   Assignee: @sundeep | Updated: 2025-09-29
   https://linear.app/humanlayer/issue/ENG-2123

4. **ENG-2120** - Fix conversation stream rendering performance
   Status: In Progress | Priority: High
   Assignee: @nyx | Updated: 2025-09-28
   https://linear.app/humanlayer/issue/ENG-2120

5. **ENG-1753** - Add Linear image attachment support
   Status: In Review | Priority: Medium
   Assignee: @allison | Updated: 2025-09-24
   https://linear.app/humanlayer/issue/ENG-1753

6. **ENG-1646** - Explore Linear API integration options
   Status: Done | Priority: Low
   Assignee: @allison | Updated: 2025-09-20
   https://linear.app/humanlayer/issue/ENG-1646

7. **ENG-1411** - Research Linear MCP server capabilities
   Status: Done | Priority: Medium
   Assignee: @allison | Updated: 2025-09-15
   https://linear.app/humanlayer/issue/ENG-1411

8. **ENG-2100** - Implement dark mode for WUI
   Status: Todo | Priority: Low
   Assignee: Unassigned | Updated: 2025-09-10
   https://linear.app/humanlayer/issue/ENG-2100`,
    },
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          'MCP Linear integration showing list of issues with status, priority, and assignee details',
      },
    },
  },
}

// BashOutput Tool - shows successful background job output
export const BashOutputToolCallSuccess: Story = {
  args: {
    event: {
      approvalId: undefined,
      approvalStatus: undefined,
      claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
      content: undefined,
      createdAt: new Date('2025-10-08T18:50:08Z'),
      eventType: 'tool_call' as const,
      id: 22,
      isCompleted: true,
      role: 'assistant' as const,
      sequence: 22,
      sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
      toolName: 'BashOutput',
      toolInputJson: JSON.stringify({
        bash_id: '01dfa1',
      }),
    },
    toolResult: {
      approvalId: undefined,
      approvalStatus: undefined,
      claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
      content: undefined,
      createdAt: new Date('2025-10-08T18:50:09Z'),
      eventType: 'tool_result' as const,
      id: 23,
      isCompleted: true,
      role: 'user' as const,
      sequence: 23,
      sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
      toolResultContent: `<status>completed</status>

<exit_code>0</exit_code>

<stdout>
hey
</stdout>

<timestamp>2025-10-08T18:50:08.532Z</timestamp>`,
    },
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'BashOutput tool showing successful background job completion with stdout',
      },
    },
  },
}

// BashOutput Tool - shows failed background job output
export const BashOutputToolCallFailure: Story = {
  args: {
    event: {
      approvalId: undefined,
      approvalStatus: undefined,
      claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
      content: undefined,
      createdAt: new Date('2025-10-08T18:51:08Z'),
      eventType: 'tool_call' as const,
      id: 24,
      isCompleted: true,
      role: 'assistant' as const,
      sequence: 24,
      sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
      toolName: 'BashOutput',
      toolInputJson: JSON.stringify({
        bash_id: 'c148de',
      }),
    },
    toolResult: {
      approvalId: undefined,
      approvalStatus: undefined,
      claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
      content: undefined,
      createdAt: new Date('2025-10-08T18:51:09Z'),
      eventType: 'tool_result' as const,
      id: 25,
      isCompleted: true,
      role: 'user' as const,
      sequence: 25,
      sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
      toolResultContent: `<status>failed</status>

<exit_code>2</exit_code>

<stderr>
ls: cannot access '/this/directory/does/not/exist': No such file or directory
</stderr>

<timestamp>2025-10-08T18:51:08.049Z</timestamp>`,
    },
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'BashOutput tool showing failed background job with stderr and exit code',
      },
    },
  },
}

// Error Boundary Demo - shows error boundary with compact inline fallback UI
export const ErrorBoundaryDemo: Story = {
  args: {} as any,
  render: () => {
    // Create an event that throws when the component tries to access properties during render
    const brokenEvent = new Proxy(
      {
        id: 1,
        sessionId: 'test-session',
        claudeSessionId: 'test-claude-session',
        sequence: 1,
        createdAt: new Date(),
        isCompleted: false,
      },
      {
        get(target, prop) {
          // Throw error when component tries to access eventType during render
          if (prop === 'eventType') {
            throw new Error('Test error: ConversationEventRow rendering failed')
          }
          return (target as any)[prop]
        },
      },
    ) as ConversationEvent

    return (
      <ConversationEventRow
        event={brokenEvent}
        shouldIgnoreMouseEvent={() => false}
        setFocusedEventId={() => {}}
        setFocusSource={() => {}}
        isFocused={false}
        isLast={true}
        responseEditorIsFocused={false}
      />
    )
  },
  parameters: {
    docs: {
      description: {
        story:
          'Demonstrates error boundary behavior by using a Proxy that throws when the component accesses properties during render. Shows the compact "response-editor" variant fallback UI with refresh functionality.',
      },
    },
  },
}
