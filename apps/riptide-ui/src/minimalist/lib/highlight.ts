import type { Element, ElementContent, Root } from 'hast'
import { common, createLowlight } from 'lowlight'

const lowlight = createLowlight(common)

/**
 * A rehype step that colors fenced code which names its language (```ts), in the common
 * languages lowlight knows. Unnamed or unknown languages stay plain rather than guessed at.
 */
export function highlightCode() {
	return (tree: Root) => {
		visit(tree)
	}
}

function visit(node: Root | Element) {
	for (const child of node.children) {
		if (child.type !== 'element') continue
		const language =
			child.tagName === 'code' && node.type === 'element' && node.tagName === 'pre' ? languageOf(child) : null
		if (language) child.children = colored(language, textOf(child))
		else visit(child)
	}
}

function languageOf(code: Element): string | null {
	const classes = code.properties.className
	const name = (Array.isArray(classes) ? classes : [])
		.map(String)
		.find((value) => value.startsWith('language-'))
		?.slice('language-'.length)
	return name && name !== 'mermaid' && lowlight.registered(name) ? name : null
}

function colored(language: string, text: string): ElementContent[] {
	try {
		return lowlight.highlight(language, text).children as ElementContent[]
	} catch {
		return [{ type: 'text', value: text }]
	}
}

function textOf(node: ElementContent): string {
	if (node.type === 'text') return node.value
	return node.type === 'element' ? node.children.map(textOf).join('') : ''
}
