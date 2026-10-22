import type { Meta, StoryObj } from '@storybook/react'
import { DiffViewer } from './diff-viewer'

const meta = {
	title: 'ConversationStream/DiffViewer',
	component: DiffViewer,
	parameters: {
		layout: 'padded',
	},
	tags: ['autodocs'],
} satisfies Meta<typeof DiffViewer>

export default meta
type Story = StoryObj<typeof meta>

export const TypeScriptUnified: Story = {
	args: {
		fileName: 'src/components/Settings.tsx',
		oldContent: `import { useState } from 'react'

export function Settings() {
  const [theme, setTheme] = useState('light')

  return (
    <div className="settings">
      <h1>Settings</h1>
      <select value={theme} onChange={(e) => setTheme(e.target.value)}>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </div>
  )
}`,
		newContent: `import { useState } from 'react'
import { DarkModeToggle } from './DarkModeToggle'

export function Settings() {
  const [theme, setTheme] = useState('light')

  return (
    <div className="settings">
      <h1>Settings</h1>
      <DarkModeToggle value={theme} onChange={setTheme} />
    </div>
  )
}`,
		mode: 'unified',
	},
}

export const TypeScriptSplit: Story = {
	args: {
		...TypeScriptUnified.args,
		mode: 'split',
	},
}

export const CSSEdit: Story = {
	args: {
		fileName: 'src/styles/globals.css',
		oldContent: `.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 16px;
}`,
		newContent: `.container {
  max-width: 960px;
  margin: 0 auto;
  padding: 0 24px;
  background: var(--bg-primary);
}`,
		mode: 'unified',
	},
}

export const JSONEdit: Story = {
	args: {
		fileName: 'package.json',
		oldContent: `{
  "name": "my-app",
  "version": "1.0.0",
  "dependencies": {
    "react": "^18.2.0"
  }
}`,
		newContent: `{
  "name": "my-app",
  "version": "1.1.0",
  "dependencies": {
    "react": "^18.2.0",
    "@pierre/diffs": "^1.0.10"
  }
}`,
		mode: 'unified',
	},
}

export const EmptyOldContent: Story = {
	name: 'New File (empty old content)',
	args: {
		fileName: 'src/utils/newHelper.ts',
		oldContent: '',
		newContent: `export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}`,
		mode: 'unified',
	},
}

export const EmptyNewContent: Story = {
	name: 'File Deletion (empty new content)',
	args: {
		fileName: 'src/deprecated/oldHelper.ts',
		oldContent: `export function legacyFormat(input: string): string {
  return input.trim().toLowerCase()
}`,
		newContent: '',
		mode: 'unified',
	},
}

export const SingleLineChange: Story = {
	args: {
		fileName: 'src/config.ts',
		oldContent: `const DEBUG = false`,
		newContent: `const DEBUG = true`,
		mode: 'unified',
	},
}

export const NoFileName: Story = {
	name: 'No File Name (no syntax highlighting)',
	args: {
		oldContent: `function hello() {
  console.log("hello")
}`,
		newContent: `function hello() {
  console.log("hello, world!")
}`,
		mode: 'unified',
	},
}
