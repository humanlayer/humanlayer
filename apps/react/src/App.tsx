import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card'
import type { Score } from '@codelayer/database'
import { useShape } from '@electric-sql/react'
import './index.css'

export function App() {
	// NOTE that this is probably non-optimal and should be used with another library that handles the aborting
	// Use the template parameter as the type exported from the database
	const { data, isError, isLoading, error, lastSyncedAt } = useShape<Score>({
		url: 'http://localhost:3000/v1/shape',
		params: {
			table: 'scores',
			where: 'value > 0', // any valid postgres WHERE clause
		},
	})

	if (isLoading) return <>Loading</>
	return (
		<div className="container mx-auto p-8 text-center relative z-10">
			<Card>
				<CardHeader>
					<CardTitle>Scores</CardTitle>
					<CardDescription>
						<p>This is the list of shapes in the database</p>
						<p>Last synced at: {lastSyncedAt}</p>
						{isError && (
							<span className="text-red-500">
								{JSON.stringify(error)}
							</span>
						)}
						<p>Shape:</p>
						<div>
							{data.map((row) => (
								<div key={'row-' + row.id}>
									{row.name}: {row.value}
								</div>
							))}
						</div>
					</CardDescription>
				</CardHeader>
			</Card>
		</div>
	)
}

export default App
