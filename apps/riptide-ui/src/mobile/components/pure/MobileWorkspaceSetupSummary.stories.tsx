import type { Meta, StoryObj } from '@storybook/react'

import { MobileWorkspaceSetupSummary } from './MobileWorkspaceSetupSummary'

const meta = {
	title: 'Components/Mobile/MobileWorkspaceSetupSummary',
	component: MobileWorkspaceSetupSummary,
	parameters: { layout: 'padded', viewport: { defaultViewport: 'mobile1' } },
} satisfies Meta<typeof MobileWorkspaceSetupSummary>

export default meta
type Story = StoryObj<typeof meta>

export const Queued: Story = { args: { state: 'queued', stage: 'setup_requested', hostName: "Kyle's Mac" } }
export const Running: Story = { args: { state: 'running', stage: 'setup_command', hostName: "Kyle's Mac" } }
export const Failed: Story = { args: { state: 'failed', stage: 'setup_command', message: 'bun install exited with code 1', hostName: "Kyle's Mac" } }
export const Ready: Story = { args: { state: 'ready', stage: 'done', hostName: "Kyle's Mac" } }
