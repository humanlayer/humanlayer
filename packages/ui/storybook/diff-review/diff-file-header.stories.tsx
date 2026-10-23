import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'

import { DiffFileHeader } from '../../src/components/diff-review/diff-file-header'

const meta = { title: 'Components/Diff Review/Diff File Header', component: DiffFileHeader, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof DiffFileHeader>
export default meta
type Story = StoryObj<typeof meta>

export const Modified: Story = {
	args: { path: 'apps/riptide-ui/src/components/diffs/WiredSessionDiffReviewPanel.tsx', changeType: 'modified', additions: 28, deletions: 6, commentCount: 2, generated: false, reviewed: false, collapsed: false, onReviewedChange: fn(), onCollapsedChange: fn() },
}
export const ReviewedAndCollapsed: Story = { args: { ...Modified.args, reviewed: true, collapsed: true } }
export const Generated: Story = { args: { ...Modified.args, path: 'bun.lock', generated: true, additions: 14, deletions: 9 } }
