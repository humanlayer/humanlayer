import { LinearClient, LinearDocument } from '@linear/sdk'
import chalk from 'chalk'

interface IssueComment {
	author: string
	body: string
	createdAt: Date
}

interface IssueData {
	identifier?: string
	title?: string
	branch?: string | null
	description?: string | null
	assignee?: string | null
	comments?: IssueComment[]
	_state?: string
	_estimate?: number | null
	_assignee?: string | null
}

export async function listIssuesV2(
	linear: LinearClient | undefined,
	options: {
		maxIssues?: string
		team?: string
		status?: string
		size?: string
		assignee?: string
		sortAsc?: boolean
		outputFormat?: string
		fields?: string
		idsOnly?: boolean
		skipIfLastCommentBy?: string
	},
) {
	try {
		if (!linear) {
			throw new Error('Linear client not initialized. Check your API key.')
		}

		const limit = parseInt(options.maxIssues || '10', 10)
		const outputFormat = options.outputFormat || 'markdown'
		const idsOnly = options.idsOnly || false
		const useCompactJson = outputFormat === 'json'
		const usePrettyJson = outputFormat === 'rich-json'

		// Check if --fields was explicitly provided by user (not just the default)
		const defaultFields = 'identifier,title,branch'
		const fieldsExplicitlyProvided = options.fields && options.fields !== defaultFields

		// Validate mutually exclusive options
		if (idsOnly && fieldsExplicitlyProvided) {
			console.error(chalk.red('Error: --ids-only and --fields cannot be used together'))
			process.exit(1)
		}

		const requestedFields = idsOnly
			? ['identifier']
			: options.fields
				? options.fields.split(',').map((f) => f.trim())
				: ['identifier', 'title', 'branch']

		// Build filter conditions
		const filterConditions: LinearDocument.IssueFilter[] = []

		// Handle team filter
		if (options.team) {
			const teamKey = options.team.trim().toUpperCase()
			const teams = await linear.teams()
			const matchingTeam = teams.nodes.find((team) => team.key.toUpperCase() === teamKey)

			if (!matchingTeam) {
				console.error(chalk.red(`Error: No team found with key "${teamKey}"`))
				process.exit(1)
			}

			filterConditions.push({
				team: { id: { eq: matchingTeam.id } },
			})
		}

		// Handle assignee filter
		if (options.assignee) {
			const assigneeValue = options.assignee.trim()

			// Fetch all users to find the matching one
			const users = await linear.users()
			const matchingUser = users.nodes.find(
				(user) =>
					user.name.toLowerCase() === assigneeValue.toLowerCase() ||
					user.email.toLowerCase() === assigneeValue.toLowerCase() ||
					user.displayName.toLowerCase() === assigneeValue.toLowerCase(),
			)

			if (!matchingUser) {
				console.error(chalk.red(`Error: No user found matching "${assigneeValue}"`))
				process.exit(1)
			}

			filterConditions.push({
				assignee: { id: { eq: matchingUser.id } },
			})
		}

		// Handle status filter (comma-separated values)
		if (options.status) {
			const statuses = options.status.split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''))
			if (statuses.length === 1) {
				filterConditions.push({
					state: { name: { eq: statuses[0] } },
				})
			} else {
				filterConditions.push({
					or: statuses.map((status) => ({
						state: { name: { eq: status } },
					})),
				})
			}
		}

		// Handle issue size filter (comma-separated numbers)
		if (options.size) {
			const sizes = options.size.split(',').map((s) => parseInt(s.trim(), 10))
			if (sizes.length === 1) {
				filterConditions.push({
					estimate: { eq: sizes[0] },
				})
			} else {
				filterConditions.push({
					or: sizes.map((size) => ({
						estimate: { eq: size },
					})),
				})
			}
		}

		// Construct the final filter
		const filter = filterConditions.length > 0 ? { and: filterConditions } : undefined

		// Fetch issues with sorting
		const queryOptions: LinearDocument.IssuesQueryVariables = {
			first: limit,
			filter,
		}

		if (options.sortAsc) {
			queryOptions.orderBy = LinearDocument.PaginationOrderBy.UpdatedAt
		}

		const result = await linear.issues(queryOptions)

		// Filter by last comment author if specified
		if (options.skipIfLastCommentBy) {
			const filterName = options.skipIfLastCommentBy.toLowerCase()
			const filteredIssues = []

			for (const issue of result.nodes) {
				const comments = await issue.comments()
				if (comments.nodes.length === 0) {
					// No comments, include this issue
					filteredIssues.push(issue)
					continue
				}

				// Get the most recent comment (comments are ordered by createdAt desc by default)
				const lastComment = comments.nodes[0]
				if (!lastComment) {
					// No comments found, include this issue
					filteredIssues.push(issue)
					continue
				}
				let commentUser
				try {
					commentUser = await lastComment.user
				} catch {
					commentUser = null
				}

				const authorName = (commentUser?.name || 'Unknown').toLowerCase()
				if (!authorName.includes(filterName)) {
					// Last comment is NOT from the specified author, include this issue
					filteredIssues.push(issue)
				}
				// Otherwise, skip this issue (last comment is from specified author)
			}

			// Replace result.nodes with filtered list
			result.nodes.length = 0
			result.nodes.push(...filteredIssues)
		}

		if (!result.nodes.length) {
			if (useCompactJson || usePrettyJson) {
				console.log(JSON.stringify([], null, usePrettyJson ? 2 : undefined))
			} else {
				console.log(chalk.yellow('No issues found matching the criteria.'))
			}
			return
		}

		// Handle ids-only mode
		if (idsOnly) {
			const ids = result.nodes.map((issue) => issue.identifier)
			if (useCompactJson || usePrettyJson) {
				console.log(JSON.stringify(ids, null, usePrettyJson ? 2 : undefined))
			} else {
				// Markdown/plain format - one ID per line
				ids.forEach((id) => console.log(id))
			}
			return
		}

		// Collect all issue data
		const issuesData = []
		for (const issue of result.nodes) {
			const issueData: IssueData = {}

			if (requestedFields.includes('identifier')) {
				issueData.identifier = issue.identifier
			}

			if (requestedFields.includes('title')) {
				issueData.title = issue.title
			}

			if (requestedFields.includes('branch')) {
				issueData.branch = issue.branchName || null
			}

			if (requestedFields.includes('description')) {
				issueData.description = issue.description || null
			}

			if (requestedFields.includes('assignee')) {
				const assignee = await issue.assignee
				issueData.assignee = assignee?.name || null
			}

			if (requestedFields.includes('comments')) {
				const commentsResult = await issue.comments()
				const commentList: IssueComment[] = []

				for (const comment of commentsResult.nodes) {
					let commentUser
					try {
						commentUser = await comment.user
					} catch {
						commentUser = null
					}

					commentList.push({
						author: commentUser?.name || 'Unknown',
						body: comment.body,
						createdAt: comment.createdAt,
					})
				}

				issueData.comments = commentList
			}

			// Always fetch state and assignee for markdown format
			const state = await issue.state
			const assignee = await issue.assignee

			issueData._state = state?.name || 'Unknown'
			issueData._estimate = issue.estimate || null
			issueData._assignee = assignee?.name || null

			issuesData.push(issueData)
		}

		// Output based on format
		if (useCompactJson || usePrettyJson) {
			// For JSON, remove the internal fields and output clean JSON
			const cleanedData = issuesData.map((issue) => ({
				identifier: issue.identifier,
				title: issue.title,
				branch: issue.branch,
				description: issue.description,
				assignee: issue.assignee,
				comments: issue.comments,
			}))
			console.log(JSON.stringify(cleanedData, null, usePrettyJson ? 2 : undefined))
		} else {
			// Markdown format
			console.log(chalk.bold(`\nFound ${issuesData.length} issue${issuesData.length > 1 ? 's' : ''}:`))

			for (const issue of issuesData) {
				console.log('')

				if (requestedFields.includes('identifier') && requestedFields.includes('title')) {
					console.log(`[${chalk.cyan(issue.identifier)}] ${issue.title}`)
				} else if (requestedFields.includes('identifier')) {
					console.log(`[${chalk.cyan(issue.identifier)}]`)
				} else if (requestedFields.includes('title')) {
					console.log(issue.title)
				}

				console.log(chalk.dim(`  Status: ${issue._state}`))

				if (issue._estimate) {
					console.log(chalk.dim(`  Size: ${issue._estimate}`))
				}

				if (requestedFields.includes('assignee') && issue.assignee) {
					console.log(chalk.dim(`  Assignee: ${issue.assignee}`))
				} else if (issue._assignee) {
					console.log(chalk.dim(`  Assignee: ${issue._assignee}`))
				}

				if (requestedFields.includes('branch') && issue.branch) {
					console.log(chalk.dim(`  Branch: ${issue.branch}`))
				}

				if (requestedFields.includes('description') && issue.description) {
					console.log(chalk.bold('\n  Description:'))
					console.log('  ' + issue.description.split('\n').join('\n  '))
				}

				if (requestedFields.includes('comments') && issue.comments && issue.comments.length > 0) {
					console.log(chalk.bold('\n  Comments:'))
					for (const comment of issue.comments) {
						const commentDate = new Date(comment.createdAt)
						const dateStr = commentDate.toISOString().split('T')[0]
						const timeStr = commentDate.toTimeString().split(' ')[0]
						console.log(chalk.dim(`  [${dateStr} ${timeStr}] ${comment.author}:`))
						console.log('  ' + comment.body.split('\n').join('\n  '))
						console.log('')
					}
				}
			}

			// Show pagination info if there are more issues
			if (result.pageInfo.hasNextPage) {
				console.log(chalk.dim(`\nShowing first ${limit} issues. There may be more issues available.`))
			}
		}
	} catch (error) {
		console.error(chalk.red('Error fetching issues:'), error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}
