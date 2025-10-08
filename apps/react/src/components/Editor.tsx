import { EditorContent, useEditor } from '@tiptap/react'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { createTiptapExtensions } from '../lib/tiptap'
import { ElectricProvider } from '../y-electric'
import './editor.css'

interface EditorProps {
	documentId: string
	electricUrl?: string
}

// Cache provider instances per document
const providerCache = new Map<string, ElectricProvider>()

function getProvider(
	documentId: string,
	electricUrl: string,
): ElectricProvider {
	let provider = providerCache.get(documentId)

	if (!provider) {
		const ydoc = new Y.Doc()
		const awareness = new Awareness(ydoc)

		provider = new ElectricProvider(electricUrl, documentId, ydoc, {
			connect: true,
			awareness,
		})

		awareness.on('change', ({ added, updated, removed }) => {
			const states = awareness.getStates()
			console.log(
				`Current users in document ${documentId}:`,
				Array.from(states.values()),
			)
		})

		providerCache.set(documentId, provider)
	}

	return provider
}

export function Editor({
	documentId,
	electricUrl = 'http://localhost:4000/shape-proxy',
}: EditorProps) {
	const provider = getProvider(documentId, electricUrl)

	const editor = useEditor(
		{
			extensions: createTiptapExtensions(provider),
		},
		[documentId],
	) // Add dependency array to prevent recreation

	return (
		<div className="editor-container">
			<EditorContent
				editor={editor}
				className="editor-content prose max-w-none"
			/>
		</div>
	)
}

export default Editor
