import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card'
import { useShape } from '@electric-sql/react'
import { useState } from 'react'
import { Editor } from './components/Editor'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { Label } from './components/ui/label'
import './index.css'

export function App() {
	// NOTE that this is probably non-optimal and should be used with another library that handles the aborting
	// Use the template parameter as the type exported from the database

	const { data, isError, isLoading, error, lastSyncedAt } = useShape<{
		file_path: string
		title: string
		id: string
	}>({
		url: 'http://localhost:3000/v1/shape',
		params: {
			table: 'thoughts_documents',
		},
	})

	const [title, setTitle] = useState('')
	const [filepath, setFilepath] = useState('')
	const [orgId, setOrgId] = useState('')
	const [createDocumentMessage, setCreateDocumentMessage] = useState('')
	const [createDocumentError, setCreateDocumentError] = useState('')
	const [selectedDocument, setSelectedDocument] = useState<string | null>(
		null,
	)
	const createDocument = async () => {
		try {
			const response = await fetch(
				'http://localhost:4000/v1/thoughts-documents/create',
				{
					method: 'POST',
					body: JSON.stringify({
						title,
						filePath: filepath,
						organizationId: orgId,
					}),
				},
			)
			if (response.ok) {
				console.log('Document Created')
				setTitle('')
				setFilepath('')
				setCreateDocumentMessage(
					`Document created with title ${(await response.json())?.title}`,
				)
			}
		} catch (error: any) {
			console.error(error)
			setCreateDocumentError(error.message)
			setCreateDocumentMessage('')
		}
	}

	if (isLoading) return <>Loading</>
	return (
		<div className="container mx-auto p-8 relative z-10">
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
				<Card>
					<CardHeader>
						<CardTitle>Documents</CardTitle>
						<CardDescription>
							<p>
								This is the list of documents in the database
								(last synced at{' '}
								{new Date(lastSyncedAt!).toLocaleString()})
							</p>
							{isError && (
								<span className="text-red-500">
									{JSON.stringify(error)}
								</span>
							)}

							<div>
								{data.map((row) => (
									<div
										key={'row-' + row.id}
										className={
											selectedDocument === row.id
												? 'rounded-sm p-1 bg-gray-200'
												: ''
										}
									>
										<div className="flex flex-col px-4 py-2">
											<div className="">
												<span
													className="hover:underline cursor-pointer"
													onClick={() =>
														setSelectedDocument(
															row.id,
														)
													}
												>
													{row.title}
												</span>{' '}
												(
												<code className="px-2 py-0.5">
													{row.file_path}
												</code>
												)
											</div>
										</div>
									</div>
								))}
							</div>
						</CardDescription>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>Create a Document</CardTitle>
						<CardDescription>
							Create a Document for your organization
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="flex flex-col gap-4">
							<div className="flex flex-col gap-2">
								<Label htmlFor="title">Document Title</Label>
								<Input
									id="title"
									value={title}
									onChange={(e) => setTitle(e.target.value)}
								/>
							</div>
							<div className="flex flex-col gap-2">
								<Label htmlFor="filepath">
									Document File Path
								</Label>
								<Input
									id="filepath"
									value={filepath}
									onChange={(e) =>
										setFilepath(e.target.value)
									}
								/>
							</div>
							<div className="flex flex-col gap-2">
								<Label htmlFor="organization">
									Organization ID
								</Label>
								<Input
									id="organization"
									value={orgId}
									onChange={(e) => setOrgId(e.target.value)}
								/>
							</div>
							<Button onClick={createDocument}>Submit</Button>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Collaborative Editor</CardTitle>
						<CardDescription>
							<p>
								Tiptap editor with Y.js + Electric collaboration
							</p>
						</CardDescription>
					</CardHeader>
					<div className="p-4">
						{selectedDocument ? (
							<Editor
								documentId={selectedDocument ?? ''}
								electricUrl="http://localhost:4000/shape-proxy"
							/>
						) : (
							<p>Please select a document</p>
						)}

						{/* NOTE THIS MUST BE THE URL OF THE BUN APP WHICH IS 4000*/}
					</div>
				</Card>
			</div>
		</div>
	)
}

export default App
