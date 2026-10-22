import type { Issue, LinearClient } from '@linear/sdk'
import chalk from 'chalk'

interface CommentDisplayModel {
	author: string
	body: string
	createdAt: Date
}

interface ParentIssueDisplayModel {
	identifier: string
	title: string
	description?: string | null
	assignee?: string | null
	comments?: CommentDisplayModel[]
	_state: string
}

interface IssueDisplayModel {
	identifier?: string
	title?: string
	branch?: string | null
	url?: string | null
	description?: string | null
	assignee?: string | null
	comments?: CommentDisplayModel[]
	parents?: ParentIssueDisplayModel[]
	_state: string
	_estimate: number | null
	_assignee: string | null
}

interface ParentIssueOutputModel {
	identifier: string
	title: string
	description?: string | null
	assignee?: string | null
	comments?: CommentDisplayModel[]
}

interface IssueOutputModel {
	identifier?: string
	title?: string
	branch?: string | null
	url?: string | null
	description?: string | null
	assignee?: string | null
	comments?: CommentDisplayModel[]
	parents?: ParentIssueOutputModel[]
}

function toIssueOutputModel(issue: IssueDisplayModel): IssueOutputModel {
	const { _state, _estimate, _assignee, parents, ...output } = issue
	const result: IssueOutputModel = { ...output }
	if (parents) {
		result.parents = parents.map(({ _state: _parentState, ...parent }) => parent)
	}
	return result
}

export async function getIssueV2(
	linear: LinearClient | undefined,
	issueId: string,
	options: {
		outputFormat?: string
		fields?: string
	},
) {
	try {
		if (!linear) {
			throw new Error('Linear client not initialized. Check your API key.')
		}

		// Validate issue ID format
		if (!issueId || !/^[A-Za-z0-9]+-\d+$/i.test(issueId)) {
			console.error(chalk.red('Error: Invalid issue ID format. Expected format: ENG-123 or B2BPROD-206'))
			process.exit(1)
		}

		const normalizedId = issueId.toUpperCase()
		const outputFormat = options.outputFormat || 'json'
		const useCompactJson = outputFormat === 'json'
		const usePrettyJson = outputFormat === 'rich-json'

		const requestedFields = options.fields
			? options.fields.split(',').map((f) => f.trim())
			: ['identifier', 'title', 'branch']

		// Fetch the issue
		const issue = await linear.issue(normalizedId)

		if (!issue) {
			console.error(chalk.red(`Issue ${normalizedId} not found.`))
			process.exit(1)
		}

		// Collect issue data based on requested fields
		const issueData: IssueDisplayModel = {
			_state: 'Unknown',
			_estimate: null,
			_assignee: null,
		}

		if (requestedFields.includes('identifier')) {
			issueData.identifier = issue.identifier
		}

		if (requestedFields.includes('title')) {
			issueData.title = issue.title
		}

		if (requestedFields.includes('branch')) {
			issueData.branch = issue.branchName || null
		}

		if (requestedFields.includes('url')) {
			issueData.url = issue.url || null
		}

		if (requestedFields.includes('description')) {
			issueData.description = issue.description || null
		}

		if (requestedFields.includes('assignee')) {
			const assignee = await issue.assignee
			issueData.assignee = assignee?.name || null
		}

		if (requestedFields.includes('comments')) {
			const comments = await issue.comments()
			const commentsData: CommentDisplayModel[] = []

			for (const comment of comments.nodes) {
				let commentUser
				try {
					commentUser = await comment.user
				} catch {
					commentUser = null
				}

				commentsData.push({
					author: commentUser?.name || 'Unknown',
					body: comment.body,
					createdAt: comment.createdAt,
				})
			}
			issueData.comments = commentsData
		}

		// Fetch parent issues if requested
		if (requestedFields.includes('parents')) {
			const parentIssues: Issue[] = []
			let currentIssue: Issue = issue

			while (true) {
				const parent = await currentIssue.parent
				if (!parent) break
				parentIssues.push(parent)
				currentIssue = parent
			}

			if (parentIssues.length > 0) {
				const parentsData: ParentIssueDisplayModel[] = []

				// Reverse to show oldest parent first
				for (let i = parentIssues.length - 1; i >= 0; i--) {
					const parentIssue = parentIssues[i]
					if (!parentIssue) continue

					const parentData: ParentIssueDisplayModel = {
						identifier: parentIssue.identifier,
						title: parentIssue.title,
						_state: 'Unknown',
					}

					// Fetch additional parent fields if needed
					if (requestedFields.includes('description')) {
						parentData.description = parentIssue.description || null
					}

					if (requestedFields.includes('assignee')) {
						const parentAssignee = await parentIssue.assignee
						parentData.assignee = parentAssignee?.name || null
					}

					if (requestedFields.includes('comments')) {
						const parentComments = await parentIssue.comments()
						const parentCommentsData: CommentDisplayModel[] = []

						for (const comment of parentComments.nodes) {
							let commentUser
							try {
								commentUser = await comment.user
							} catch {
								commentUser = null
							}

							parentCommentsData.push({
								author: commentUser?.name || 'Unknown',
								body: comment.body,
								createdAt: comment.createdAt,
							})
						}
						parentData.comments = parentCommentsData
					}

					const parentState = await parentIssue.state
					parentData._state = parentState?.name || 'Unknown'

					parentsData.push(parentData)
				}

				issueData.parents = parentsData
			}
		}

		// Always fetch state and estimate for markdown format
		const state = await issue.state
		const assignee = await issue.assignee

		issueData._state = state?.name || 'Unknown'
		issueData._estimate = issue.estimate || null
		issueData._assignee = assignee?.name || null

		// Output based on format
		if (useCompactJson || usePrettyJson) {
			console.log(JSON.stringify(toIssueOutputModel(issueData), null, usePrettyJson ? 2 : undefined))
		} else {
			// Markdown format
			if (requestedFields.includes('identifier') && requestedFields.includes('title')) {
				console.log(`[${chalk.cyan(issueData.identifier ?? '')}] ${issueData.title ?? ''}`)
			} else if (requestedFields.includes('identifier')) {
				console.log(`[${chalk.cyan(issueData.identifier ?? '')}]`)
			} else if (requestedFields.includes('title')) {
				console.log(issueData.title ?? '')
			}

			console.log(chalk.dim(`Status: ${issueData._state}`))

			if (issueData._estimate) {
				console.log(chalk.dim(`Size: ${issueData._estimate}`))
			}

			if (requestedFields.includes('assignee') && issueData.assignee) {
				console.log(chalk.dim(`Assignee: ${issueData.assignee}`))
			} else if (issueData._assignee) {
				console.log(chalk.dim(`Assignee: ${issueData._assignee}`))
			}

			if (requestedFields.includes('branch') && issueData.branch) {
				console.log(chalk.dim(`Branch: ${issueData.branch}`))
			}

			if (requestedFields.includes('description') && issueData.description) {
				console.log(chalk.bold('\nDescription:'))
				console.log(issueData.description)
			}

			if (requestedFields.includes('comments') && issueData.comments && issueData.comments.length > 0) {
				console.log(chalk.bold('\nComments:'))
				for (const comment of issueData.comments) {
					const commentDate = new Date(comment.createdAt)
					const dateStr = commentDate.toISOString().split('T')[0]
					const timeStr = commentDate.toTimeString().split(' ')[0]
					console.log(chalk.dim(`[${dateStr} ${timeStr}] ${comment.author}:`))
					console.log(comment.body)
					console.log('')
				}
			}

			// Display parent issues if requested
			if (requestedFields.includes('parents') && issueData.parents && issueData.parents.length > 0) {
				console.log(chalk.bold.yellow('\n════════════════════════════════════���══════════════════════════'))
				console.log(chalk.bold.yellow('PARENT ISSUES:'))
				console.log(chalk.bold.yellow('═══════════════════════════════════════════════════════════════'))

				const parents = issueData.parents
				for (let i = 0; i < parents.length; i++) {
					const parentRecord = parents[i]
					if (!parentRecord) continue

					const levelPrefix = '  '.repeat(i) + '↳ '
					console.log(chalk.yellow(`\n${levelPrefix}Parent Level ${i + 1}:`))

					console.log(chalk.bold(`\n${levelPrefix}[${parentRecord.identifier}] ${parentRecord.title}`))
					console.log(chalk.dim(`${levelPrefix}Status: ${parentRecord._state}`))

					if (requestedFields.includes('assignee') && parentRecord.assignee) {
						console.log(chalk.dim(`${levelPrefix}Assignee: ${parentRecord.assignee}`))
					}

					if (requestedFields.includes('description') && parentRecord.description) {
						console.log(chalk.bold(`\n${levelPrefix}Description:`))
						const descLines = parentRecord.description.split('\n')
						for (const line of descLines) {
							console.log(`${levelPrefix}${line}`)
						}
					}

					if (
						requestedFields.includes('comments') &&
						parentRecord.comments &&
						parentRecord.comments.length > 0
					) {
						console.log(chalk.bold(`\n${levelPrefix}Comments:`))
						for (const comment of parentRecord.comments) {
							const commentDate = new Date(comment.createdAt)
							const dateStr = commentDate.toISOString().split('T')[0]
							const timeStr = commentDate.toTimeString().split(' ')[0]
							console.log(chalk.dim(`${levelPrefix}[${dateStr} ${timeStr}] ${comment.author}:`))
							const commentLines = comment.body.split('\n')
							for (const line of commentLines) {
								console.log(`${levelPrefix}${line}`)
							}
							console.log('')
						}
					}
				}
			}
		}
	} catch (error) {
		console.error(chalk.red('Error fetching issue:'), Error.isError(error) ? error.message : Bun.inspect(error))
		process.exit(1)
	}
}
