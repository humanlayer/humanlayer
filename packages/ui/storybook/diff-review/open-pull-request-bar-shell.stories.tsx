import type { Meta, StoryObj } from '@storybook/react-vite'

import { OpenPullRequestBarShellDemo } from './OpenPullRequestBarShellDemo'

const meta = {
  title: 'Shell Demos/OpenPullRequestBar',
  component: OpenPullRequestBarShellDemo,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof OpenPullRequestBarShellDemo>

export default meta
type Story = StoryObj<typeof meta>

/** The bar at the very bottom, under the diff it is offering a pull request for. */
export const Default: Story = {}

/** A task working in two repositories gets a row each, told apart by the sentence. */
export const TwoRepositories: Story = {
  args: { secondRepoLabel: 'fold' },
}

/** Unsent review comments are lit in the header, so the bar steps back until they are gone. */
export const WithOpenComments: Story = {
  args: { openCommentCount: 3 },
}
