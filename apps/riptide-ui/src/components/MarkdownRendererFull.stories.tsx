import type { Meta, StoryObj } from '@storybook/react-vite'
import MarkdownRendererFull from './MarkdownRendererFull'

const meta = {
	title: 'Riptide/MarkdownRendererFull',
	component: MarkdownRendererFull,
	parameters: {
		layout: 'padded',
	},
	decorators: [
		(Story) => (
			<div className="max-w-3xl rounded border border-border bg-background p-6">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof MarkdownRendererFull>

export default meta
type Story = StoryObj<typeof meta>

export const MathNotation: Story = {
	args: {
		content: `Quick one, and a good instinct to ask - the tilde is everywhere in this notation.

## The \`\\sim\` means "sampled from" / "distributed according to"

$$
\\tau \\sim \\pi_\\theta
$$

The same idea works inline: $X \\sim \\mathrm{Normal}(0,1)$ reads "X is distributed as a standard normal." Unicode math like τ, π, θ, ∼, 𝔼, and ∫ should remain ordinary prose.

## Reading it inside the expectation

$$
\\mathbb{E}_{\\tau \\sim \\pi_\\theta}\\big[R(\\tau)\\big]
$$

The subscript on \`𝔼\` tells you what you're averaging over.

\`\`\`math
\\int P(\\tau|\\theta) R(\\tau) \\, d\\tau
\`\`\`

Existing fenced code should still render as code:

\`\`\`ts
const rollout = sample(policy)
\`\`\``,
	},
}

export const PreservedXmlTags: Story = {
	args: {
		content: `<comment id="comment-123">
Please preserve this review feedback.
</comment>

Assistant reply with **Markdown** still rendered.`,
		preserveSingleLineBreaks: true,
		preserveXmlTags: true,
	},
}
