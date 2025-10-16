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
const eProviderCache = new Map<string, ElectricProvider>()

function getProvider(
	documentId: string,
	electricUrl: string,
): ElectricProvider {
	let eProvider = eProviderCache.get(documentId)

	if (!eProvider) {
		const ydoc = new Y.Doc()
		const awareness = new Awareness(ydoc)

		eProvider = new ElectricProvider(electricUrl, documentId, ydoc, {
			connect: true,
			awareness,
		})

		// awareness.on('change', ({ added, updated, removed }) => {
		// 	const states = awareness.getStates()
		// })

		eProviderCache.set(documentId, eProvider)
	}

	return eProvider
}

function ActualEditor({
	documentId,
	electricUrl = 'http://localhost:4000/shape-proxy',
}: EditorProps) {
	const eProvider = getProvider(documentId, electricUrl)

	const editor = useEditor({
		extensions: createTiptapExtensions(eProvider),
	})

	return (
		<div className="editor-container">
			<div
				className="room-info-panel"
				style={{
					padding: '8px 12px',
					backgroundColor: '#f3f4f6',
					borderBottom: '1px solid #e5e7eb',
					fontSize: '12px',
					fontFamily: 'monospace',
					color: '#6b7280',
					display: 'flex',
					alignItems: 'center',
					gap: '8px',
				}}
			>
				<span style={{ fontWeight: 600 }}>Room ID:</span>
				<span
					style={{
						backgroundColor: '#fff',
						padding: '2px 8px',
						borderRadius: '4px',
						border: '1px solid #d1d5db',
					}}
				>
					{documentId}
				</span>
			</div>
			<EditorContent
				editor={editor}
				className="editor-content prose max-w-none"
			/>
		</div>
	)
}

export function Editor(props: EditorProps) {
	return <ActualEditor key={props.documentId} {...props} />
}

export default Editor
