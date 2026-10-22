import type { Meta, StoryObj } from '@storybook/react'

import { CodeViewStackDemo } from './CodeViewStackDemo'

const meta = { title: 'Shell Demos/Diff Review/Code View Stack', component: CodeViewStackDemo, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof CodeViewStackDemo>
export default meta
type Story = StoryObj<typeof meta>

export const ManyFiles: Story = { args: {} }
export const CollapsedFile: Story = { args: { initiallyCollapsed: true } }
export const BinaryPlaceholder: Story = { args: { placeholder: 'binary' } }
export const PendingVersion: Story = { args: { placeholder: 'pending' } }
export const ReviewedAndCollapsed: Story = { args: { initiallyReviewed: true } }
export const GeneratedAutoCollapsed: Story = { args: { generated: true } }
export const UnifiedWithComments: Story = { args: { withComments: true } }
export const SplitWithComments: Story = { args: { withComments: true, diffStyle: 'split' } }
