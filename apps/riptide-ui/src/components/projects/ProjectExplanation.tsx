/** Shared with project onboarding so contextual help uses the same vocabulary. */
export function ProjectExplanation() {
	return (
		<>
			<p>
				A <strong className="font-semibold text-foreground">project</strong> is a bundle of one or more
				repositories that you work on often.
			</p>
			<div>
				<p>
					Projects are used as templates for <strong className="font-semibold text-foreground">tasks</strong>,
					which contain:
				</p>
				<ul className="mt-2 list-disc space-y-1 pl-5">
					<li>
						<strong className="font-semibold text-foreground">coding agent sessions</strong>
					</li>
					<li>
						<strong className="font-semibold text-foreground">artifacts</strong> like linear/jira/github
						issues &amp; design documents
					</li>
					<li>
						<strong className="font-semibold text-foreground">diffs and PR data</strong> for your changes
						across all the task&apos;s repositories
					</li>
				</ul>
			</div>
		</>
	)
}
