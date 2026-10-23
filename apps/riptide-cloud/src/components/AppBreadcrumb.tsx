import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from '@humanlayer/ui/components/breadcrumb'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { Link, useLocation, useParams } from '@tanstack/react-router'

import { useSync } from '@/providers/SyncProvider'

export function AppBreadcrumb() {
	const location = useLocation()
	const params = useParams({ strict: false })
	const { artifactsMetadataCollection, tasksCollection } = useSync()

	const segments = location.pathname.split('/').filter(Boolean)
	const artifactId = params.artifactId as string | undefined
	const taskId = params.taskId as string | undefined

	// Artifact detail breadcrumb data — only query when we have an artifactId
	const { data: artifactData } = useLiveQuery(
		(q) => {
			if (!artifactId || !artifactsMetadataCollection || !tasksCollection) return undefined
			return q
				.from({ artifacts: artifactsMetadataCollection })
				.leftJoin({ tasks: tasksCollection }, ({ artifacts, tasks }) => eq(artifacts.task_id, tasks.id))
				.where(({ artifacts }) => eq(artifacts.id, artifactId))
				.select(({ artifacts, tasks }) => ({
					file_name: artifacts.file_name,
					task_slug: artifacts.task_slug,
					task_id: artifacts.task_id,
					task_name: tasks?.name,
				}))
		},
		[artifactsMetadataCollection, tasksCollection, artifactId],
	)

	// Task name data — only query when we have a taskId
	const { data: taskData } = useLiveQuery(
		(q) => {
			if (!taskId || !tasksCollection) return undefined
			return q
				.from({ tasks: tasksCollection })
				.where(({ tasks }) => eq(tasks.id, taskId))
				.select(({ tasks }) => ({ name: tasks.name }))
		},
		[tasksCollection, taskId],
	)

	// Determine breadcrumb content based on route
	// Tasks list
	if (segments[0] === 'tasks' && !taskId) {
		return (
			<Breadcrumb className="font-mono text-sm">
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbPage>Tasks</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>
		)
	}

	// Task artifacts: /tasks/:taskId/artifacts
	if (segments[0] === 'tasks' && taskId) {
		const task = taskData?.[0]
		return (
			<Breadcrumb className="font-mono text-sm">
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbLink asChild className="cursor-pointer">
							<Link to="/tasks">Tasks</Link>
						</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<Tooltip>
							<TooltipTrigger asChild>
								<BreadcrumbPage className="max-w-[40vw] truncate">
									{task?.name || 'Untitled Task'}
								</BreadcrumbPage>
							</TooltipTrigger>
							<TooltipContent className="max-w-[600px]">{task?.name || 'Untitled Task'}</TooltipContent>
						</Tooltip>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>
		)
	}

	if (segments[0] === 'artifacts') {
		if (!artifactId) {
			// /artifacts renders tasks list now
			return (
				<Breadcrumb className="font-mono text-sm">
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbPage>Tasks</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			)
		}

		const artifact = artifactData?.[0]
		const artifactTaskId = artifact?.task_id
		return (
			<Breadcrumb className="font-mono text-sm">
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbLink asChild className="cursor-pointer">
							<Link to="/tasks">Tasks</Link>
						</BreadcrumbLink>
					</BreadcrumbItem>
					{artifact && (
						<>
							<BreadcrumbSeparator />
							<BreadcrumbItem>
								{artifactTaskId ? (
									<Tooltip>
										<TooltipTrigger asChild>
											<BreadcrumbLink
												asChild
												className="cursor-pointer max-w-[30vw] truncate block"
											>
												<Link to="/tasks/$taskId/artifacts" params={{ taskId: artifactTaskId }}>
													{artifact.task_name || artifact.task_slug}
												</Link>
											</BreadcrumbLink>
										</TooltipTrigger>
										<TooltipContent className="max-w-[600px]">
											{artifact.task_name || artifact.task_slug}
										</TooltipContent>
									</Tooltip>
								) : (
									<Tooltip>
										<TooltipTrigger asChild>
											<BreadcrumbPage className="max-w-[30vw] truncate">
												{artifact.task_name || artifact.task_slug}
											</BreadcrumbPage>
										</TooltipTrigger>
										<TooltipContent className="max-w-[600px]">
											{artifact.task_name || artifact.task_slug}
										</TooltipContent>
									</Tooltip>
								)}
							</BreadcrumbItem>
							<BreadcrumbSeparator />
							<BreadcrumbItem>
								<Tooltip>
									<TooltipTrigger asChild>
										<BreadcrumbPage className="max-w-[30vw] truncate">
											{artifact.file_name}
										</BreadcrumbPage>
									</TooltipTrigger>
									<TooltipContent className="max-w-[600px]">{artifact.file_name}</TooltipContent>
								</Tooltip>
							</BreadcrumbItem>
						</>
					)}
				</BreadcrumbList>
			</Breadcrumb>
		)
	}

	if (segments[0] === 'admin' && segments[1] === 'users') {
		return (
			<Breadcrumb className="font-mono text-sm">
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbPage>Users</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>
		)
	}

	if (segments[0] === 'admin' && segments[1] === 'invitations') {
		return (
			<Breadcrumb className="font-mono text-sm">
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbPage>Invitations</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>
		)
	}

	if (segments[0] === 'settings') {
		return (
			<Breadcrumb className="font-mono text-sm">
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbPage>Settings</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>
		)
	}

	return null
}
