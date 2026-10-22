import type { Meta, StoryObj } from '@storybook/react-vite'
import type React from 'react'
import { fn } from 'storybook/test'
import { DraftLauncherFormWrapper, type DraftLauncherFormWrapperProps } from './draft-launcher-form'

const MOCK_RECENT_DIRECTORIES = [
	'~/go/src/github.com/humanlayer/syncopate',
	'~/go/src/github.com/humanlayer/humanlayer',
	'~/wt/syncopate/eng-2523',
]

const meta = {
  title: 'Shell Demos/DraftLauncherForm',
  component: DraftLauncherFormWrapper as any,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  args: {
    onLaunch: fn(),
    onDiscard: fn(),
    recentDirectories: MOCK_RECENT_DIRECTORIES,
  },
  decorators: [
    (Story: React.FC) => (
      <div className="max-w-2xl mx-auto">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<DraftLauncherFormWrapperProps>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  args: {},
}

export const WithTitle: Story = {
  args: {
    initialTitle: 'Implement user authentication',
    initialWorkingDir: '/Users/dev/project',
  },
}

export const FilledOut: Story = {
  args: {
    initialTitle: 'Add dark mode toggle',
    initialWorkingDir: '/Users/dev/my-project',
    initialModel: 'opus',
    initialContent: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Please add a dark mode toggle to the settings page. It should persist the preference to localStorage and apply the theme immediately.',
            },
          ],
        },
      ],
    },
  },
}

export const UploadingOneFile: Story = {
  name: 'Uploading 1 File',
  args: {
    initialTitle: 'Fix image rendering bug',
    initialWorkingDir: '/Users/dev/project',
    initialContent: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See the attached screenshot ' },
            {
              type: 'file-mention',
              attrs: {
                id: '@.humanlayer/tasks/my-task/screenshot.png',
                label: 'screenshot.png',
                isDirectory: false,
                isArtifact: true,
              },
            },
            { type: 'text', text: ' ' },
          ],
        },
      ],
    },
    pendingUploadCount: 1,
  },
}

export const UploadingMultipleFiles: Story = {
  name: 'Uploading 3 Files',
  args: {
    initialTitle: 'Fix image rendering bug',
    initialWorkingDir: '/Users/dev/project',
    initialContent: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Here are the error screenshots ' },
            {
              type: 'file-mention',
              attrs: {
                id: '@.humanlayer/tasks/my-task/error-1.png',
                label: 'error-1.png',
                isDirectory: false,
                isArtifact: true,
              },
            },
            { type: 'text', text: ' ' },
            {
              type: 'file-mention',
              attrs: {
                id: '@.humanlayer/tasks/my-task/error-2.png',
                label: 'error-2.png',
                isDirectory: false,
                isArtifact: true,
              },
            },
            { type: 'text', text: ' ' },
          ],
        },
      ],
    },
    pendingUploadCount: 3,
  },
}

// Non-owner stories: ownership-aware checkbox label and auto-toggle behavior

export const NonOwnerFirstSessionCheckboxOn: Story = {
  name: 'Non-Owner: First session, checkbox auto-ON (local default differs from task default)',
  args: {
    initialTitle: 'Implement auth flow',
    // Simulates settingsStore.defaultDirectory being the user's local default
    initialWorkingDir: '/Users/alice/my-projects',
    showUpdateTaskDirCheckbox: true,
    initialUpdateTaskDir: true,
    updateTaskDirCheckboxLabel: 'Save as my default for this task',
  },
}

export const NonOwnerFirstSessionCheckboxOff: Story = {
  name: 'Non-Owner: First session, checkbox OFF (local default matches task default)',
  args: {
    initialTitle: 'Research codebase',
    // Simulates settingsStore.defaultDirectory matching task.default_working_directory
    initialWorkingDir: '/Users/shared/project',
    showUpdateTaskDirCheckbox: false,
    initialUpdateTaskDir: false,
    updateTaskDirCheckboxLabel: 'Save as my default for this task',
  },
}

export const NonOwnerWithExistingSettings: Story = {
  name: 'Non-Owner: Existing task_user_settings row (pre-filled from per-user override)',
  args: {
    initialTitle: 'Fix bug in auth module',
    // Simulates userSettings.working_directory being the non-owner's override
    initialWorkingDir: '/Users/alice/forked-project',
    showUpdateTaskDirCheckbox: false,
    initialUpdateTaskDir: false,
    updateTaskDirCheckboxLabel: 'Save as my default for this task',
  },
}

export const OwnerDefaultBehavior: Story = {
  name: 'Owner: Default behavior (label and prefill unchanged)',
  args: {
    initialTitle: 'Add feature X',
    initialWorkingDir: '/Users/owner/task-project',
    showUpdateTaskDirCheckbox: true,
    initialUpdateTaskDir: false,
    // No updateTaskDirCheckboxLabel — uses the default owner wording
  },
}
