import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'
import { mockUsers } from './__stories__/comment-fixtures'
import { ArtifactRaw } from './artifact-raw'

const meta: Meta<typeof ArtifactRaw> = {
  title: 'Components/ArtifactRaw',
  component: ArtifactRaw,
  parameters: {
    layout: 'padded',
  },
  args: {
    onLineClick: fn(),
  },
}
export default meta

type Story = StoryObj<typeof ArtifactRaw>

export const Default: Story = {
  args: {
    content: '# Hello World\n\nThis is **markdown** content with `code`.',
    fileName: 'README.md',
  },
}

export const CodeFile: Story = {
  args: {
    content: `function greet(name: string): string {
  return \`Hello, \${name}!\`
}

export { greet }`,
    fileName: 'utils.ts',
  },
}

export const LongContent: Story = {
  args: {
    content: Array(100).fill('Lorem ipsum dolor sit amet.').join('\n'),
    fileName: 'long-file.txt',
  },
}

export const NoFileName: Story = {
  args: {
    content: 'Content without a filename header.',
  },
}

const codeContent = `function greet(name: string): string {
  return \`Hello, \${name}!\`
}

export function processItems(items: string[]): string[] {
  return items.map(greet)
}

export { greet }`

export const WithCommentedLines: Story = {
  args: {
    content: codeContent,
    fileName: 'utils.ts',
    commentedLines: new Map([
      [1, [mockUsers.user1]],
      [5, [mockUsers.user1, mockUsers.user2]],
    ]),
  },
}

export const WithMultipleAuthorsOnLine: Story = {
  args: {
    content: codeContent,
    fileName: 'utils.ts',
    commentedLines: new Map([
      [6, [mockUsers.user1, mockUsers.user2, mockUsers.user3]],
    ]),
  },
}
