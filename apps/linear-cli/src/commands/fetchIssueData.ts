import type { Issue, LinearClient } from '@linear/sdk'

export interface IssueComment {
	author: string
	body: string
	createdAt: Date
}

export interface ParentIssue {
	identifier: string
	title: string
	description: string | null
}

export interface IssueData {
	identifier: string
	title: string
	branch: string | null
	description: string | null
	status: string
	assignee: string | null
	comments?: IssueComment[]
	parents?: ParentIssue[]
}

export async function fetchIssueData(
	linear: LinearClient,
	issueId: string,
	options?: { includeComments?: boolean; includeParents?: boolean },
): Promise<IssueData> {
	// Validate issue ID format
	if (!issueId || !/^[A-Za-z0-9]+-\d+$/i.test(issueId)) {
		throw new Error(`Invalid issue ID format: ${issueId}. Expected format: ENG-123 or B2BPROD-206`)
	}

	const normalizedId = issueId.toUpperCase()
	const issue = await linear.issue(normalizedId)

	if (!issue) {
		throw new Error(`Issue ${normalizedId} not found.`)
	}

	const state = await issue.state
	const assignee = await issue.assignee

	const issueData: IssueData = {
		identifier: issue.identifier,
		title: issue.title,
		branch: issue.branchName || null,
		description: issue.description || null,
		status: state?.name || 'Unknown',
		assignee: assignee?.name || null,
	}

	if (options?.includeComments) {
		const comments = await issue.comments()
		issueData.comments = []

		for (const comment of comments.nodes) {
			let commentUser
			try {
				commentUser = await comment.user
			} catch {
				commentUser = null
			}

			issueData.comments.push({
				author: commentUser?.name || 'Unknown',
				body: comment.body,
				createdAt: comment.createdAt,
			})
		}
	}

	if (options?.includeParents) {
		const parentIssues: Issue[] = []
		let currentIssue: Issue = issue

		while (true) {
			const parent = await currentIssue.parent
			if (!parent) break
			parentIssues.push(parent)
			currentIssue = parent
		}

		// Reverse for oldest-first ordering (root parent first)
		issueData.parents = parentIssues.reverse().map((p) => ({
			identifier: p.identifier,
			title: p.title,
			description: p.description || null,
		}))
	}

	return issueData
}
