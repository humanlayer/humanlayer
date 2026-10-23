import type { Meta, StoryObj } from '@storybook/react'
import { BashToolCallContent } from './bash-tool-call-content'
import { ReadToolCallContent } from './read-tool-call-content'
import { WriteToolCallContent } from './write-tool-call-content'
import { EditToolCallContent } from './edit-tool-call-content'
import { GrepToolCallContent } from './grep-tool-call-content'
import { GlobToolCallContent } from './glob-tool-call-content'
import { TaskToolCallContent } from './task-tool-call-content'
import { TodoWriteToolCallContent } from './todo-write-tool-call-content'
import { ApplyPatchToolCallContent } from './apply-patch-tool-call-content'
import { ticketAddFrontmatterPatch, ticketUpdateManyHunksPatch } from '../apply-patch-fixtures'

const meta = {
	title: 'ConversationStream/ToolContent',
	parameters: {
		layout: 'padded',
	},
} satisfies Meta

export default meta

// Apply patch tool stories
export const ApplyPatchTicketAddFrontmatter: StoryObj = {
	render: () => (
		<ApplyPatchToolCallContent
			toolInput={{ patch_text: ticketAddFrontmatterPatch }}
			isCompleted={true}
			isFocused={false}
			isGroupItem={false}
			workingDir="/Users/stet/src/ambral/ambral-auto"
		/>
	),
}

export const ApplyPatchTicketUpdateManyHunks: StoryObj = {
	render: () => (
		<ApplyPatchToolCallContent
			toolInput={{ patch_text: ticketUpdateManyHunksPatch }}
			isCompleted={true}
			isFocused={false}
			isGroupItem={false}
			workingDir="/Users/stet/src/ambral/ambral-auto"
		/>
	),
}

// Bash tool stories
export const BashRunning: StoryObj = {
	render: () => (
		<BashToolCallContent
			toolInput={{ command: 'npm run build', description: 'Build the project' }}
			isCompleted={false}
			isFocused={false}
			isGroupItem={false}
		/>
	),
}

export const BashCompleted: StoryObj = {
	render: () => (
		<BashToolCallContent
			toolInput={{ command: 'npm run build', description: 'Build the project' }}
			isCompleted={true}
			toolResultContent="Build completed successfully in 3.2s"
			isFocused={true}
			isGroupItem={false}
		/>
	),
}

export const BashPending: StoryObj = {
	render: () => (
		<BashToolCallContent
			toolInput={{ command: 'rm -rf node_modules', description: 'Remove node_modules' }}
			approvalStatus="pending"
			isCompleted={false}
			isFocused={false}
			isGroupItem={false}
		/>
	),
}

export const BashApproved: StoryObj = {
	render: () => (
		<BashToolCallContent
			toolInput={{ command: 'git push origin main', description: 'Push to main branch' }}
			approvalStatus="approved"
			isCompleted={true}
			toolResultContent="Everything up-to-date"
			isFocused={false}
			isGroupItem={false}
		/>
	),
}

export const BashDenied: StoryObj = {
	render: () => (
		<BashToolCallContent
			toolInput={{ command: 'rm -rf /', description: 'Remove root directory' }}
			approvalStatus="denied"
			isCompleted={true}
			toolResultContent="This command is too dangerous to run"
			isFocused={false}
			isGroupItem={false}
		/>
	),
}

export const BashBackground: StoryObj = {
	render: () => (
		<BashToolCallContent
			toolInput={{
				command: 'npm run dev',
				description: 'Start development server',
				run_in_background: true,
			}}
			isCompleted={false}
			isFocused={false}
			isGroupItem={false}
		/>
	),
}

// Read tool stories
export const ReadDefault: StoryObj = {
	render: () => (
		<ReadToolCallContent
			toolInput={{ file_path: '/src/components/App.tsx' }}
			isCompleted={true}
			toolResultContent="import React from 'react';\nexport const App = () => <div>Hello</div>;"
			isFocused={false}
			isGroupItem={false}
			workingDir="/Users/dev/project"
		/>
	),
}

export const ReadWithLimit: StoryObj = {
	render: () => (
		<ReadToolCallContent
			toolInput={{ file_path: '/src/components/App.tsx', limit: 100 }}
			isCompleted={true}
			toolResultContent="import React from 'react';\n..."
			isFocused={true}
			isGroupItem={false}
			workingDir="/Users/dev/project"
		/>
	),
}

export const ReadWithOffset: StoryObj = {
	render: () => (
		<ReadToolCallContent
			toolInput={{ file_path: '/src/utils/helpers.ts', offset: 50, limit: 20 }}
			isCompleted={true}
			toolResultContent="export function calculateTotal() {...}"
			isFocused={false}
			isGroupItem={false}
			workingDir="/Users/dev/project"
		/>
	),
}

export const ReadGroupItem: StoryObj = {
	render: () => (
		<ReadToolCallContent
			toolInput={{ file_path: '/package.json' }}
			isCompleted={true}
			toolResultContent='{"name": "my-app", "version": "1.0.0"}'
			isFocused={false}
			isGroupItem={true}
			workingDir="/Users/dev/project"
		/>
	),
}

// Write tool stories
export const WritePending: StoryObj = {
	render: () => (
		<WriteToolCallContent
			toolInput={{
				file_path: '/src/new-file.tsx',
				content: "export const NewComponent = () => {\n  return <div>Hello</div>\n}\n",
			}}
			approvalStatus="pending"
			isCompleted={false}
			isFocused={false}
			isGroupItem={false}
		/>
	),
}

export const WriteApproved: StoryObj = {
	render: () => (
		<WriteToolCallContent
			toolInput={{
				file_path: '/src/new-file.tsx',
				content: "export const NewComponent = () => {\n  return <div>Hello</div>\n}\n",
			}}
			approvalStatus="approved"
			isCompleted={true}
			toolResultContent="File written successfully"
			isFocused={false}
			isGroupItem={false}
			workingDir="/Users/dev/project"
		/>
	),
}

export const WriteDenied: StoryObj = {
	render: () => (
		<WriteToolCallContent
			toolInput={{
				file_path: '/src/new-file.tsx',
				content: "export const NewComponent = () => {\n  return <div>Hello</div>\n}\n",
			}}
			approvalStatus="denied"
			isCompleted={true}
			toolResultContent="Please use a different file name"
			isFocused={false}
			isGroupItem={false}
			workingDir="/Users/dev/project"
		/>
	),
}

export const WriteLongContent: StoryObj = {
	render: () => (
		<WriteToolCallContent
			toolInput={{
				file_path: '/src/components/BigComponent.tsx',
				content: `import React from 'react'
import { useState, useEffect } from 'react'

export const BigComponent = () => {
  const [state, setState] = useState(0)

  useEffect(() => {
    console.log('mounted')
  }, [])

  return (
    <div>
      <h1>Big Component</h1>
      <p>This is a large component with lots of code...</p>
    </div>
  )
}`,
			}}
			approvalStatus="pending"
			isCompleted={false}
			isFocused={false}
			isGroupItem={false}
			workingDir="/Users/dev/project"
		/>
	),
}

// Edit tool stories
export const EditPending: StoryObj = {
	render: () => (
		<EditToolCallContent
			toolInput={{
				file_path: '/src/components/Settings.tsx',
				old_string: `import { useState } from 'react'\n\nexport function Settings() {\n  const [count, setCount] = useState(0)\n  return <div>{count}</div>\n}`,
				new_string: `import { useState, useEffect } from 'react'\n\nexport function Settings() {\n  const [count, setCount] = useState(0)\n\n  useEffect(() => {\n    document.title = \`Count: \${count}\`\n  }, [count])\n\n  return <div>{count}</div>\n}`,
			}}
			approvalStatus="pending"
			isCompleted={false}
			isFocused={false}
			isGroupItem={false}
			workingDir="/Users/dev/project"
		/>
	),
}

export const EditApproved: StoryObj = {
	render: () => (
		<EditToolCallContent
			toolInput={{
				file_path: '/src/components/Settings.tsx',
				old_string: `export const API_URL = 'http://localhost:3000'`,
				new_string: `export const API_URL = process.env.API_URL ?? 'http://localhost:3000'`,
			}}
			approvalStatus="approved"
			isCompleted={true}
			toolResultContent="File updated successfully"
			isFocused={false}
			isGroupItem={false}
			workingDir="/Users/dev/project"
		/>
	),
}

export const EditDenied: StoryObj = {
	render: () => (
		<EditToolCallContent
			toolInput={{
				file_path: '/src/config.ts',
				old_string: 'const DEBUG = false',
				new_string: 'const DEBUG = true',
			}}
			approvalStatus="denied"
			isCompleted={true}
			toolResultContent="Please don't enable debug mode in production"
			isFocused={false}
			isGroupItem={false}
			workingDir="/Users/dev/project"
		/>
	),
}

export const EditReplaceAll: StoryObj = {
	render: () => (
		<EditToolCallContent
			toolInput={{
				file_path: '/src/utils/helpers.ts',
				old_string: 'oldFunction',
				new_string: 'newFunction',
				replace_all: true,
			}}
			approvalStatus="approved"
			isCompleted={true}
			isFocused={true}
			isGroupItem={false}
			workingDir="/Users/dev/project"
		/>
	),
}

export const EditFocused: StoryObj = {
	render: () => (
		<EditToolCallContent
			toolInput={{
				file_path: '/src/App.tsx',
				old_string: 'import { useState } from "react"',
				new_string: 'import { useState, useEffect } from "react"',
			}}
			approvalStatus="pending"
			isCompleted={false}
			isFocused={true}
			isGroupItem={false}
			workingDir="/Users/dev/project"
		/>
	),
}

// Grep tool stories
export const GrepFilesWithMatches: StoryObj = {
	render: () => (
		<GrepToolCallContent
			toolInput={{
				pattern: 'useState',
				path: 'src/',
				output_mode: 'files_with_matches',
			}}
			isCompleted={true}
			toolResultContent={`src/App.tsx
src/components/Settings.tsx
src/hooks/useTheme.ts`}
			isFocused={false}
			isGroupItem={false}
		/>
	),
}

export const GrepContent: StoryObj = {
	render: () => (
		<GrepToolCallContent
			toolInput={{
				pattern: 'export',
				path: 'src/',
				output_mode: 'content',
			}}
			isCompleted={true}
			toolResultContent={`src/App.tsx:1:export const App = () => {}
src/index.tsx:5:export default App`}
			isFocused={true}
			isGroupItem={false}
		/>
	),
}

export const GrepCount: StoryObj = {
	render: () => (
		<GrepToolCallContent
			toolInput={{
				pattern: 'TODO',
				output_mode: 'count',
			}}
			isCompleted={true}
			toolResultContent={`src/App.tsx:3
src/utils/helpers.ts:7`}
			isFocused={false}
			isGroupItem={false}
		/>
	),
}

export const GrepNoMatches: StoryObj = {
	render: () => (
		<GrepToolCallContent
			toolInput={{
				pattern: 'nonexistent',
				path: 'src/',
			}}
			isCompleted={true}
			toolResultContent="No matches found."
			isFocused={false}
			isGroupItem={false}
		/>
	),
}

// Glob tool stories
export const GlobDefault: StoryObj = {
	render: () => (
		<GlobToolCallContent
			toolInput={{
				pattern: '**/*.tsx',
				path: 'src/components/',
			}}
			isCompleted={true}
			toolResultContent={`src/components/Settings.tsx
src/components/DarkModeToggle.tsx
src/components/App.tsx`}
			isFocused={false}
			isGroupItem={false}
		/>
	),
}

export const GlobFocused: StoryObj = {
	render: () => (
		<GlobToolCallContent
			toolInput={{
				pattern: '*.test.ts',
				path: 'src/',
			}}
			isCompleted={true}
			toolResultContent={`src/utils.test.ts
src/helpers.test.ts`}
			isFocused={true}
			isGroupItem={false}
		/>
	),
}

// Task tool stories
export const TaskRunning: StoryObj = {
	render: () => (
		<TaskToolCallContent
			toolInput={{
				description: 'Research existing theme implementations',
				prompt: 'Find all files related to theming and analyze the current approach',
				subagent_type: 'codebase-analyzer',
			}}
			isCompleted={false}
			isFocused={false}
			isGroupItem={false}
		/>
	),
}

export const TaskCompleted: StoryObj = {
	render: () => (
		<TaskToolCallContent
			toolInput={{
				description: 'Analyze authentication patterns',
				prompt: 'Find all authentication-related code and summarize the approach',
				subagent_type: 'codebase-analyzer',
			}}
			isCompleted={true}
			toolResultContent="Found 15 files using session-based authentication. Current implementation uses bcrypt for password hashing."
			isFocused={true}
			isGroupItem={false}
		/>
	),
}

// TodoWrite tool stories
export const TodoWriteDefault: StoryObj = {
	render: () => (
		<TodoWriteToolCallContent
			toolInput={{
				todos: [
					{ content: 'Add dark mode toggle component', status: 'completed', activeForm: 'Adding dark mode toggle' },
					{ content: 'Update Settings page', status: 'in_progress', activeForm: 'Updating Settings page' },
					{ content: 'Add localStorage persistence', status: 'pending', activeForm: 'Adding persistence' },
				],
			}}
			isCompleted={true}
			isFocused={false}
			isGroupItem={false}
		/>
	),
}

export const TodoWriteFocused: StoryObj = {
	render: () => (
		<TodoWriteToolCallContent
			toolInput={{
				todos: [
					{ content: 'Research JWT implementation', status: 'completed', activeForm: 'Researching JWT' },
					{ content: 'Install dependencies', status: 'in_progress', activeForm: 'Installing dependencies' },
					{ content: 'Update middleware', status: 'pending', activeForm: 'Updating middleware' },
					{ content: 'Add tests', status: 'pending', activeForm: 'Adding tests' },
				],
			}}
			isCompleted={true}
			isFocused={true}
			isGroupItem={false}
		/>
	),
}
