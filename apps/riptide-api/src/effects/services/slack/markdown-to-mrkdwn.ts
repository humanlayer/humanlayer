/**
 * Converts a subset of CommonMark / GitHub Markdown into Slack's `mrkdwn` flavor.
 *
 * Ported from the reference Python `SlackMarkdownConverter`
 * (https://github.com/fla9ua/markdown_to_mrkdwn). The plugin system and table
 * handling are intentionally omitted; the remaining line-level conversions are
 * faithful, including fenced-code passthrough and `***bold italic***` handling.
 *
 * IMPORTANT: this does NOT HTML-escape `&` / `<` / `>`. Slack requires those to
 * be escaped in `mrkdwn`, so callers passing user-controlled text must escape
 * first, then convert. Escaping the input is compatible with every rule here and
 * leaves the `<url|text>` link markup this function emits intact.
 */

const TRIPLE_START = '%%BOLDITALIC_START%%'
const TRIPLE_END = '%%BOLDITALIC_END%%'
const TRIPLE_EMPHASIS = /(?<!\*)\*\*\*([^*\n]+?)\*\*\*(?!\*)/g
const TRIPLE_PLACEHOLDER = /%%BOLDITALIC_START%%(.*?)%%BOLDITALIC_END%%/g
const CODE_FENCE = /^```(\w*)\s*$/

/**
 * Ordered replacements applied to each non-code line. Identity transforms that
 * Slack already shares with Markdown (ordered lists, inline code, blockquotes)
 * are omitted. Order matters and mirrors the reference implementation.
 */
const LINE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
	[/^(\s*)- \[ \] (.+)/g, '$1• ☐ $2'], // Unchecked task list
	[/^(\s*)- \[[xX]\] (.+)/g, '$1• ☑ $2'], // Checked task list
	[/^(\s*)[-*] (.+)/g, '$1• $2'], // Unordered list
	[/!\[.*?\]\((.+?)\)/g, '<$1>'], // Image → bare URL
	[/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '_$1_'], // Italic
	[/^###### (.+?)\s*$/g, '*$1*'], // H6 → bold
	[/^##### (.+?)\s*$/g, '*$1*'], // H5 → bold
	[/^#### (.+?)\s*$/g, '*$1*'], // H4 → bold
	[/^### (.+?)\s*$/g, '*$1*'], // H3 → bold
	[/^## (.+?)\s*$/g, '*$1*'], // H2 → bold
	[/^# (.+?)\s*$/g, '*$1*'], // H1 → bold
	[/(^|\s)~\*\*(.+?)\*\*(\s|$)/g, '$1 *$2* $3'], // Bold with surrounding-space handling
	[/(?<!\*)\*\*(.+?)\*\*(?!\*)/g, '*$1*'], // Bold
	[/__(.+?)__/g, '*$1*'], // Underline → bold
	[/\[(.+?)\]\((.+?)\)/g, '<$2|$1>'], // Link
	[/^(---|\*\*\*|___)$/g, '──────────'], // Horizontal rule
	[/~~(.+?)~~/g, '~$1~'], // Strikethrough
]

/** Convert Markdown text to Slack `mrkdwn`. Returns `''` for empty input. */
export function markdownToMrkdwn(markdown: string): string {
	if (!markdown) return ''

	let inCodeBlock = false
	return markdown
		.split('\n')
		.map((rawLine) => {
			const fence = CODE_FENCE.exec(rawLine)
			if (fence) {
				inCodeBlock = !inCodeBlock
				return inCodeBlock && fence[1] ? `\`\`\`${fence[1]}` : '```'
			}
			if (inCodeBlock) return rawLine

			// Shield ***bold italic*** so the bold and italic rules don't fight over the shared asterisks.
			let line = rawLine.replace(
				TRIPLE_EMPHASIS,
				(_match, inner: string) => `${TRIPLE_START}${inner}${TRIPLE_END}`,
			)
			for (const [pattern, replacement] of LINE_PATTERNS) {
				line = line.replace(pattern, replacement)
			}
			line = line.replace(TRIPLE_PLACEHOLDER, '*_$1_*')
			return line.replace(/\s+$/, '')
		})
		.join('\n')
}
