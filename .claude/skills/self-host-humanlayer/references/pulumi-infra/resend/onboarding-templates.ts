import * as resend from '@humanlayer/pulumi-resend'
import type * as pulumi from '@pulumi/pulumi'
import dedent from 'dedent'

const from = 'PLACEHOLDER_FROM_NAME_PLACEHOLDER <PLACEHOLDER_FROM_EMAIL_PLACEHOLDER>'
const replyTo = ['PLACEHOLDER_REPLY_TO_EMAIL_PLACEHOLDER']

const unsubscribeFooterText = 'Unsubscribe: {{{RESEND_UNSUBSCRIBE_URL}}}'
const unsubscribeFooterHtml = '<p><a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Unsubscribe</a></p>'

// Email images are hosted as static assets in the riptide-ui SPA's public/ folder,
// which deploys to S3 + CloudFront at PLACEHOLDER_APP_DOMAIN_PLACEHOLDER. A file at
// apps/riptide-ui/public/email/onboarding/<name> is served at
// `${onboardingAssetBase}/<name>`. Version filenames (-v1, -v2) when changing an
// image: Gmail/Outlook proxy-cache images by URL and won't refetch a changed file.
const onboardingAssetBase = 'https://PLACEHOLDER_APP_DOMAIN_PLACEHOLDER/email/onboarding'

export function createOnboardingTemplates(opts: { provider: pulumi.ProviderResource }) {
	const welcomeText = dedent`
		welcome aboard - best way to get started:

		1. Install the app: https://PLACEHOLDER_CLOUD_DOMAIN_PLACEHOLDER/install (the docs live there too)
		2. Watch the product tour: https://hlyr.dev/prd-626

		we read every reply - if you get stuck on anything - install, sign-in, your first task - just respond here

		we also hang out in Discord with other folks building with HumanLayer: https://hlyr.dev/discord

		- dex
	`

	const welcomeHtml = dedent`
		<p>welcome aboard - best way to get started:</p>
		<ol>
			<li>Install the app: <a href="https://PLACEHOLDER_CLOUD_DOMAIN_PLACEHOLDER/install">PLACEHOLDER_CLOUD_DOMAIN_PLACEHOLDER/install</a> (the docs live there too)</li>
			<li>Watch the product tour: <a href="https://hlyr.dev/prd-626">hlyr.dev/prd-626</a></li>
		</ol>
		<p><strong>we read every reply</strong> - if you get stuck on anything - install, sign-in, your first task - just respond here</p>
		<p>we also hang out in Discord with other folks building with HumanLayer: <a href="https://hlyr.dev/discord">hlyr.dev/discord</a></p>
		<p>- dex</p>
	`

	const welcome = new resend.Template(
		'onboarding-v1-welcome',
		{
			name: 'onboarding-v1-welcome',
			alias: 'onboarding-v1-welcome',
			from,
			replyTo,
			subject: 'getting started',
			text: `${welcomeText}\n\n${unsubscribeFooterText}`,
			html: `${welcomeHtml}\n${unsubscribeFooterHtml}`,
			variables: [{ key: 'firstName', type: 'string', fallbackValue: 'there' }],
		},
		{ provider: opts.provider },
	)

	// --- Email 1 (day-1 slot): create your first RPI task, or connect a tracker ---
	// Default copy: user has NOT created an RPI task yet. Copy from
	// 04-prd-appendix-full-sequence.md "Email 1" default body.
	const rpiTaskDefaultText = dedent`
		the best first task is something already on your to-do list - and you don't need a tightly-spec'd ticket

		create an RPI task and HumanLayer walks you through the whole workflow:

		- researches the codebase
		- writes a design discussion for you to iterate on
		- breaks the work into a phased structure outline
		- implements phase by phase

		these steps are grounded in good context engineering, avoiding "the dumb zone", and turning a vague request into a high-quality, well-grounded spec before any code gets written

		you catch the important decisions early, in the design, when they're cheap to change - not in PR review, when they're expensive

		Want to see the whole thing end to end first? Here's a walkthrough of shipping a real feature: https://youtube.com/watch?v=kBqRubi7dSk&t=1859

		- dex
	`

	const rpiTaskDefaultHtml = dedent`
		<p>the best first task is something already on your to-do list - and you don't need a tightly-spec'd ticket</p>
		<p>create an <strong>RPI task</strong> and HumanLayer walks you through the whole workflow:</p>
		<ul>
			<li>researches the codebase</li>
			<li>writes a design discussion for you to iterate on</li>
			<li>breaks the work into a phased structure outline</li>
			<li>implements phase by phase</li>
		</ul>
		<p>these steps are grounded in good context engineering, avoiding "the dumb zone", and turning a vague request into a high-quality, well-grounded spec before any code gets written</p>
		<p>you catch the important decisions early, in the design, when they're cheap to change - not in PR review, when they're expensive</p>
		<p>Want to see the whole thing end to end first? Here's a walkthrough of shipping a real feature: <a href="https://youtube.com/watch?v=kBqRubi7dSk&amp;t=1859">youtube.com/watch?v=kBqRubi7dSk&amp;t=1859</a></p>
		<p style="text-align:center;"><img src="${onboardingAssetBase}/rpi-workflow-v1.png" alt="The RPI workflow: worktree, questions, research, design, outline, implement, PR" width="260" style="display:block;width:100%;max-width:260px;height:auto;margin:0 auto;border-radius:6px;" /></p>
		<p>- dex</p>
	`

	const rpiTaskDefault = new resend.Template(
		'onboarding-v1-rpi-task-default',
		{
			name: 'onboarding-v1-rpi-task-default',
			alias: 'onboarding-v1-rpi-task-default',
			from,
			replyTo,
			subject: 'tasks guide you through research / plan / implement workflows',
			text: `${rpiTaskDefaultText}\n\n${unsubscribeFooterText}`,
			html: `${rpiTaskDefaultHtml}\n${unsubscribeFooterHtml}`,
			variables: [{ key: 'firstName', type: 'string', fallbackValue: 'there' }],
		},
		{ provider: opts.provider },
	)

	// Already-done variant: user HAS created an RPI task but has NOT connected a
	// tracker. Copy from "Email 1" already-done body (connect your tracker).
	const rpiTaskTrackerText = dedent`
		congrats on launching your first task.

		if your work usually starts in linear or jira, you can connect your tracker to link tasks directly tickets

		the artifacts your agents produce will get automatically attached to the ticket

		whoever files the tickets will thank you. maybe. or they wont. but at least you wont have to copy docs in and out of jira any more

		connect at https://PLACEHOLDER_CLOUD_DOMAIN_PLACEHOLDER/admin/settings

		- dex
	`

	const rpiTaskTrackerHtml = dedent`
		<p>congrats on launching your first task.</p>
		<p>if your work usually starts in linear or jira, you can connect your tracker to link tasks directly tickets</p>
		<p style="text-align:center;"><img src="${onboardingAssetBase}/connect-tracker-v1.png" alt="Issue Source selector with Inline, Linear, and Jira options and a Connect Linear panel" width="600" style="display:block;width:100%;max-width:600px;height:auto;margin:0 auto;border-radius:6px;" /></p>
		<p>the artifacts your agents produce will get automatically attached to the ticket</p>
		<p>whoever files the tickets will thank you. maybe. or they wont. but at least you wont have to copy docs in and out of jira any more</p>
		<p>connect at <a href="https://PLACEHOLDER_CLOUD_DOMAIN_PLACEHOLDER/admin/settings">PLACEHOLDER_CLOUD_DOMAIN_PLACEHOLDER/admin/settings</a></p>
		<p>- dex</p>
	`

	const rpiTaskTrackerVariant = new resend.Template(
		'onboarding-v1-rpi-task-tracker-variant',
		{
			name: 'onboarding-v1-rpi-task-tracker-variant',
			alias: 'onboarding-v1-rpi-task-tracker-variant',
			from,
			replyTo,
			subject: 'launch tasks from linear and jira',
			text: `${rpiTaskTrackerText}\n\n${unsubscribeFooterText}`,
			html: `${rpiTaskTrackerHtml}\n${unsubscribeFooterHtml}`,
			variables: [{ key: 'firstName', type: 'string', fallbackValue: 'there' }],
		},
		{ provider: opts.provider },
	)

	// --- Email 2 (day-3 slot): your first design doc ---
	// Milestone: design discussion iterated (>=2 versions). Default copy: not yet
	// iterated. Already-done variant: iterated. Admin-only P.S. is appended to the
	// done variant as a separate admin template (Resend templates can't branch
	// inline), so the done copy ships as done-non-admin + done-admin.
	const designDocAdminBlockText = dedent`
		P.S. You're an admin on your org - HumanLayer gets a lot better with your team in it. Invite them here: https://PLACEHOLDER_CLOUD_DOMAIN_PLACEHOLDER/admin/invitations
	`

	const designDocAdminBlockHtml = dedent`
		<p>P.S. You're an admin on your org - HumanLayer gets a lot better with your team in it. Invite them here: <a href="https://PLACEHOLDER_CLOUD_DOMAIN_PLACEHOLDER/admin/invitations">PLACEHOLDER_CLOUD_DOMAIN_PLACEHOLDER/admin/invitations</a></p>
	`

	const designDocDefaultText = dedent`
		most design problems get caught at the worst possible moment: PR review, after the code is written.

		in humanlayer, every task starts with a design discussion - a short doc that captures the approach, the tradeoffs, and the open questions before any implementation happens

		if you haven't yet: open your first task and walk through the design phase - and don't just accept the first draft, push on it, answer the questions, etc

		More on the thinking behind Design Discussion artifacts: https://hlyr.dev/qrspi-mlops

		Questions about the workflow? Our Discord is full of people comparing notes: https://hlyr.dev/discord

		- dex
	`

	const designDocDefaultHtml = dedent`
		<p>most design problems get caught at the worst possible moment: PR review, after the code is written.</p>
		<p>in humanlayer, every task starts with a design discussion - a short doc that captures the approach, the tradeoffs, and the open questions before any implementation happens</p>
		<p>if you haven't yet: open your first task and walk through the design phase - and don't just accept the first draft, push on it, answer the questions, etc</p>
		<p>More on the thinking behind Design Discussion artifacts:</p>
		<p style="text-align:center;"><a href="https://hlyr.dev/qrspi-mlops"><img src="${onboardingAssetBase}/yt-design-discussion-v1.jpg" alt="Watch: the thinking behind Design Discussion artifacts (YouTube)" width="500" style="display:block;width:100%;max-width:500px;height:auto;margin:0 auto;border-radius:6px;" /></a></p>
		<p>Questions about the workflow? Our Discord is full of people comparing notes: <a href="https://hlyr.dev/discord">hlyr.dev/discord</a></p>
		<p>- dex</p>
	`

	const designDocDefault = new resend.Template(
		'onboarding-v1-design-doc-default',
		{
			name: 'onboarding-v1-design-doc-default',
			alias: 'onboarding-v1-design-doc-default',
			from,
			replyTo,
			subject: 'catch problems during design discussion, not PR review',
			text: `${designDocDefaultText}\n\n${unsubscribeFooterText}`,
			html: `${designDocDefaultHtml}\n${unsubscribeFooterHtml}`,
			variables: [{ key: 'firstName', type: 'string', fallbackValue: 'there' }],
		},
		{ provider: opts.provider },
	)

	const designDocDoneText = dedent`
		so, you've gone back and forth on a design doc now - nice - now it's time to share it with a teammate

		a design doc is most valuable before the code exists, when a teammate's "wait, what about..." comment is cheapest to act on.

		open the doc, hit "Copy Cloud Link" in the top right sharing settings, and send the link to whoever would have eventually reviewed your PR

		this is all about moving the review to the moment when it's cheapest to change the outcome.

		Compare notes with other teams doing design-first work in our Discord: https://hlyr.dev/discord

		- dex
	`

	const designDocDoneHtml = dedent`
		<p>so, you've gone back and forth on a design doc now - nice - now it's time to share it with a teammate</p>
		<p>a design doc is most valuable before the code exists, when a teammate's "wait, what about..." comment is cheapest to act on.</p>
		<p>open the doc, hit "Copy Cloud Link" in the top right sharing settings, and send the link to whoever would have eventually reviewed your PR</p>
		<p style="text-align:center;"><img src="${onboardingAssetBase}/copy-cloud-link-v1.png" alt="Artifact toolbar menu with 'Copy Cloud Link' highlighted" width="400" style="display:block;width:100%;max-width:400px;height:auto;margin:0 auto;border-radius:6px;" /></p>
		<p>this is all about moving the review to the moment when it's cheapest to change the outcome.</p>
		<p>Compare notes with other teams doing design-first work in our Discord: <a href="https://hlyr.dev/discord">hlyr.dev/discord</a></p>
		<p>- dex</p>
	`

	const designDocDoneNonAdmin = new resend.Template(
		'onboarding-v1-design-doc-done-non-admin',
		{
			name: 'onboarding-v1-design-doc-done-non-admin',
			alias: 'onboarding-v1-design-doc-done-non-admin',
			from,
			replyTo,
			subject: 'your design doc deserves a second reader',
			text: `${designDocDoneText}\n\n${unsubscribeFooterText}`,
			html: `${designDocDoneHtml}\n${unsubscribeFooterHtml}`,
			variables: [{ key: 'firstName', type: 'string', fallbackValue: 'there' }],
		},
		{ provider: opts.provider },
	)

	const designDocDoneAdmin = new resend.Template(
		'onboarding-v1-design-doc-done-admin',
		{
			name: 'onboarding-v1-design-doc-done-admin',
			alias: 'onboarding-v1-design-doc-done-admin',
			from,
			replyTo,
			subject: 'your design doc deserves a second reader',
			text: `${designDocDoneText}\n\n${designDocAdminBlockText}\n\n${unsubscribeFooterText}`,
			html: `${designDocDoneHtml}\n${designDocAdminBlockHtml}\n${unsubscribeFooterHtml}`,
			variables: [{ key: 'firstName', type: 'string', fallbackValue: 'there' }],
		},
		{ provider: opts.provider },
	)

	// --- Email 3 (day-5 slot): get a comment on your design doc (the real aha) ---
	// Milestones: inbound human comment received + whether resolved. No inbound
	// comment yet -> default (share to get one). Inbound but unresolved -> variant
	// (act on it). Resolved -> skip (loop closed).
	const designCommentDefaultText = dedent`
		the highest leverage moment in humanlayer is when you share a design doc, a teammate reads it, and their "wait, what about..." lands right in your workflow - before any code exists, when changing course is (almost) free

		open one of your design docs, hit "Copy Cloud Link", and send it to whoever would've reviewed your PR anyway - their comments come back to you in HumanLayer, pinned to the exact spot in the doc

		send those comments to your agent with cmd+K > "Send all comments to agent and resolve"

		here's how we use HumanLayer on our own team, docs and comments and all: https://www.youtube.com/watch?v=eKWCx9nKe4I

		- dex
	`

	const designCommentDefaultHtml = dedent`
		<p>the highest leverage moment in humanlayer is when you share a design doc, a teammate reads it, and their "wait, what about..." lands right in your workflow - before any code exists, when changing course is (almost) free</p>
		<p>open one of your design docs, hit "Copy Cloud Link", and send it to whoever would've reviewed your PR anyway - their comments come back to you in HumanLayer, pinned to the exact spot in the doc</p>
		<p style="text-align:center;"><img src="${onboardingAssetBase}/copy-cloud-link-v1.png" alt="Artifact toolbar menu with 'Copy Cloud Link' highlighted" width="400" style="display:block;width:100%;max-width:400px;height:auto;margin:0 auto;border-radius:6px;" /></p>
		<p>send those comments to your agent with cmd+K &gt; "Send all comments to agent and resolve"</p>
		<p>here's how we use HumanLayer on our own team, docs and comments and all:</p>
		<p style="text-align:center;"><a href="https://www.youtube.com/watch?v=eKWCx9nKe4I"><img src="${onboardingAssetBase}/yt-team-workflow-v1.jpg" alt="Watch: how the HumanLayer team uses docs and comments (YouTube)" width="500" style="display:block;width:100%;max-width:500px;height:auto;margin:0 auto;border-radius:6px;" /></a></p>
		<p>- dex</p>
	`

	const designCommentDefault = new resend.Template(
		'onboarding-v1-design-comment-default',
		{
			name: 'onboarding-v1-design-comment-default',
			alias: 'onboarding-v1-design-comment-default',
			from,
			replyTo,
			subject: 'getting comments on your design docs',
			text: `${designCommentDefaultText}\n\n${unsubscribeFooterText}`,
			html: `${designCommentDefaultHtml}\n${unsubscribeFooterHtml}`,
			variables: [{ key: 'firstName', type: 'string', fallbackValue: 'there' }],
		},
		{ provider: opts.provider },
	)

	const designCommentUnresolvedText = dedent`
		okay, so someone left a comment on your design doc - time to act on it.

		from the session prompt box, you can send the comment straight to the agent so it folds the feedback into the work, then mark the thread resolved

		Don't let it sit. A design-phase comment is the cheapest, highest-leverage change you'll ever make - the code doesn't exist yet, so adjusting course costs a sentence, not an afternoon.

		- dex
	`

	const designCommentUnresolvedHtml = dedent`
		<p>okay, so someone left a comment on your design doc - time to act on it.</p>
		<p>from the session prompt box, you can send the comment straight to the agent so it folds the feedback into the work, then mark the thread resolved</p>
		<p style="text-align:center;"><img src="${onboardingAssetBase}/send-comments-to-agent-v1.png" alt="Session controls menu: 'Send Comments to Agent' and 'Send Comments to Agent & Resolve'" width="600" style="display:block;width:100%;max-width:600px;height:auto;margin:0 auto;border-radius:6px;" /></p>
		<p>Don't let it sit. A design-phase comment is the cheapest, highest-leverage change you'll ever make - the code doesn't exist yet, so adjusting course costs a sentence, not an afternoon.</p>
		<p>- dex</p>
	`

	const designCommentUnresolvedVariant = new resend.Template(
		'onboarding-v1-design-comment-unresolved',
		{
			name: 'onboarding-v1-design-comment-unresolved',
			alias: 'onboarding-v1-design-comment-unresolved',
			from,
			replyTo,
			subject: "you've got a comment - here's what to do with it",
			text: `${designCommentUnresolvedText}\n\n${unsubscribeFooterText}`,
			html: `${designCommentUnresolvedHtml}\n${unsubscribeFooterHtml}`,
			variables: [{ key: 'firstName', type: 'string', fallbackValue: 'there' }],
		},
		{ provider: opts.provider },
	)

	// --- Email 4 (day-7 slot): your first structure outline ---
	// Milestone: a structure-outline artifact exists. Default copy: not yet created.
	// Already-done variant: created. No images in this email (PR Milestone 5 ships no
	// new imagery; the appendix screenshot placeholder is intentionally omitted).
	const structureOutlineDefaultText = dedent`
		once the design is settled, HumanLayer turns it into a structure outline - the phased shape of the implementation: what gets built first, what depends on what, and where the natural checkpoints are

		this is your second chance to catch problems cheaply. skim the phases. if phase 2 looks wrong, fixing the outline costs a sentence; fixing the code could cost an afternoon

		one habit worth picking up: optimize your outline for vertical slices. a horizontal plan ("phase 1: all the db models, phase 2: all the APIs, phase 3: all the UI") means nothing works until everything works. a vertical plan ("phase 1: one thin end-to-end path, phase 2: the next slice") means every phase ends with something you can run, test, and ship. if a phase has nothing meaningful to test on its own, ask for a re-slice

		take one of your tasks through the outline phase and see how it reads

		- dex
	`

	const structureOutlineDefaultHtml = dedent`
		<p>once the design is settled, HumanLayer turns it into a structure outline - the phased shape of the implementation: what gets built first, what depends on what, and where the natural checkpoints are</p>
		<p>this is your second chance to catch problems cheaply. skim the phases. if phase 2 looks wrong, fixing the outline costs a sentence; fixing the code could cost an afternoon</p>
		<p>one habit worth picking up: optimize your outline for vertical slices. a horizontal plan ("phase 1: all the db models, phase 2: all the APIs, phase 3: all the UI") means nothing works until everything works. a vertical plan ("phase 1: one thin end-to-end path, phase 2: the next slice") means every phase ends with something you can run, test, and ship. if a phase has nothing meaningful to test on its own, ask for a re-slice</p>
		<p>take one of your tasks through the outline phase and see how it reads</p>
		<p>- dex</p>
	`

	const structureOutlineDefault = new resend.Template(
		'onboarding-v1-structure-outline-default',
		{
			name: 'onboarding-v1-structure-outline-default',
			alias: 'onboarding-v1-structure-outline-default',
			from,
			replyTo,
			subject: 'from design to outline',
			text: `${structureOutlineDefaultText}\n\n${unsubscribeFooterText}`,
			html: `${structureOutlineDefaultHtml}\n${unsubscribeFooterHtml}`,
			variables: [{ key: 'firstName', type: 'string', fallbackValue: 'there' }],
		},
		{ provider: opts.provider },
	)

	const structureOutlineDoneText = dedent`
		you've seen a structure outline now - if you want to keep these sharp: before you approve one, ask of each phase

		"if we stopped here, would there be something meaningful for me to test?"

		if the answer is no, ask for a re-slice

		that one question is what keeps your phases vertical - each slice ends with something runnable, instead of a half-built layer that only works once everything else lands

		- dex
	`

	const structureOutlineDoneHtml = dedent`
		<p>you've seen a structure outline now - if you want to keep these sharp: before you approve one, ask of each phase</p>
		<p>"if we stopped here, would there be something meaningful for me to test?"</p>
		<p>if the answer is no, ask for a re-slice</p>
		<p>that one question is what keeps your phases vertical - each slice ends with something runnable, instead of a half-built layer that only works once everything else lands</p>
		<p>- dex</p>
	`

	const structureOutlineDoneVariant = new resend.Template(
		'onboarding-v1-structure-outline-done',
		{
			name: 'onboarding-v1-structure-outline-done',
			alias: 'onboarding-v1-structure-outline-done',
			from,
			replyTo,
			subject: 'vertical slices ship',
			text: `${structureOutlineDoneText}\n\n${unsubscribeFooterText}`,
			html: `${structureOutlineDoneHtml}\n${unsubscribeFooterHtml}`,
			variables: [{ key: 'firstName', type: 'string', fallbackValue: 'there' }],
		},
		{ provider: opts.provider },
	)

	// --- Email 5 (day-10 slot): running implementation ---
	// Two milestones gate this slot: implementation started (>=1 rpi:implementation
	// session) and complete (pr-description exists). Three states: not started ->
	// default; started not complete -> started variant; complete -> complete variant.
	// Carries Discord. No images (PR Milestone 5 ships no new imagery).
	const implementationDefaultText = dedent`
		design done, structure done - time to let the implementation run

		HumanLayer works through the outline phase by phase and finishes with a PR description

		pick a task with an approved outline and run the implementation with \`/rpi:implement-outline\`

		your job during this phase is light: check in on the checkpoints, answer questions when the agent asks

		stuck mid-run, or curious how others supervise implementations? ask in Discord: https://hlyr.dev/discord

		- dex
	`

	const implementationDefaultHtml = dedent`
		<p>design done, structure done - time to let the implementation run</p>
		<p>HumanLayer works through the outline phase by phase and finishes with a PR description</p>
		<p>pick a task with an approved outline and run the implementation with <code>/rpi:implement-outline</code></p>
		<p>your job during this phase is light: check in on the checkpoints, answer questions when the agent asks</p>
		<p>stuck mid-run, or curious how others supervise implementations? ask in Discord: <a href="https://hlyr.dev/discord">hlyr.dev/discord</a></p>
		<p>- dex</p>
	`

	const implementationDefault = new resend.Template(
		'onboarding-v1-implementation-default',
		{
			name: 'onboarding-v1-implementation-default',
			alias: 'onboarding-v1-implementation-default',
			from,
			replyTo,
			subject: 'take a task all the way to a PR',
			text: `${implementationDefaultText}\n\n${unsubscribeFooterText}`,
			html: `${implementationDefaultHtml}\n${unsubscribeFooterHtml}`,
			variables: [{ key: 'firstName', type: 'string', fallbackValue: 'there' }],
		},
		{ provider: opts.provider },
	)

	const implementationStartedText = dedent`
		you've kicked off an implementation - nice. your job now is light but not zero: check in at the checkpoints, and when the agent asks a question or heads the wrong way, steer it

		from the session prompt box you can send guidance mid-run, answer questions, and keep it moving toward the PR

		the goal is a finished PR description - that's the signal the task is ready for review. keep nudging it there

		get stuck? you can always launch a new session with \`/rpi:iterate-implementation\` to quickly onboard a fresh session into your task context and what's been done so far

		stuck, or curious how others supervise a run? ask in Discord: https://hlyr.dev/discord

		- dex
	`

	const implementationStartedHtml = dedent`
		<p>you've kicked off an implementation - nice. your job now is light but not zero: check in at the checkpoints, and when the agent asks a question or heads the wrong way, steer it</p>
		<p>from the session prompt box you can send guidance mid-run, answer questions, and keep it moving toward the PR</p>
		<p>the goal is a finished PR description - that's the signal the task is ready for review. keep nudging it there</p>
		<p>get stuck? you can always launch a new session with <code>/rpi:iterate-implementation</code> to quickly onboard a fresh session into your task context and what's been done so far</p>
		<p>stuck, or curious how others supervise a run? ask in Discord: <a href="https://hlyr.dev/discord">hlyr.dev/discord</a></p>
		<p>- dex</p>
	`

	const implementationStartedVariant = new resend.Template(
		'onboarding-v1-implementation-started',
		{
			name: 'onboarding-v1-implementation-started',
			alias: 'onboarding-v1-implementation-started',
			from,
			replyTo,
			subject: "you're mid-implementation - here's how to steer",
			text: `${implementationStartedText}\n\n${unsubscribeFooterText}`,
			html: `${implementationStartedHtml}\n${unsubscribeFooterHtml}`,
			variables: [{ key: 'firstName', type: 'string', fallbackValue: 'there' }],
		},
		{ provider: opts.provider },
	)

	const implementationCompleteText = dedent`
		you've taken a task all the way to a PR - congrats. but the first pass is rarely the last - you may want to make further updates

		the \`/rpi:iterate-implementation\` command picks up an existing implementation with full context - review feedback, failing CI, a change of mind

		describe what needs to be different and it will re-onboard into the task context before making changes

		you can also use it to kick off a new session mid-implementation, to polish a previous phase or continue to the next

		see how other teams run their iteration loops in Discord: https://hlyr.dev/discord

		- dex
	`

	const implementationCompleteHtml = dedent`
		<p>you've taken a task all the way to a PR - congrats. but the first pass is rarely the last - you may want to make further updates</p>
		<p>the <code>/rpi:iterate-implementation</code> command picks up an existing implementation with full context - review feedback, failing CI, a change of mind</p>
		<p>describe what needs to be different and it will re-onboard into the task context before making changes</p>
		<p>you can also use it to kick off a new session mid-implementation, to polish a previous phase or continue to the next</p>
		<p>see how other teams run their iteration loops in Discord: <a href="https://hlyr.dev/discord">hlyr.dev/discord</a></p>
		<p>- dex</p>
	`

	const implementationCompleteVariant = new resend.Template(
		'onboarding-v1-implementation-complete',
		{
			name: 'onboarding-v1-implementation-complete',
			alias: 'onboarding-v1-implementation-complete',
			from,
			replyTo,
			subject: 'congrats on your first implementation',
			text: `${implementationCompleteText}\n\n${unsubscribeFooterText}`,
			html: `${implementationCompleteHtml}\n${unsubscribeFooterHtml}`,
			variables: [{ key: 'firstName', type: 'string', fallbackValue: 'there' }],
		},
		{ provider: opts.provider },
	)

	// --- Email 6 (day-13 slot): see your team's work ---
	// Milestone: commented on someone else's doc. No already-done variant -> skip if
	// achieved. Carries Discord + ace-fca link. No images (PR Milestone 5 ships none).
	const teamWorkDefaultText = dedent`
		you can see every task your teammates are running - what's in design, what's mid-implementation, what's waiting on review

		open a teammate's design doc and leave a comment. design-phase feedback is the cheapest, highest-leverage review you'll ever give: the code doesn't exist yet, so changing direction costs nothing

		going deeper on how to make agents work well with shared context: https://hlyr.dev/ace-fca

		and if your team's not on HumanLayer yet, our Discord works as a stand-in: https://hlyr.dev/discord

		- dex
	`

	const teamWorkDefaultHtml = dedent`
		<p>you can see every task your teammates are running - what's in design, what's mid-implementation, what's waiting on review</p>
		<p style="text-align:center;"><img src="${onboardingAssetBase}/team-kanban-v1.png" alt="Kanban board of tasks across Research & Design, Planning, Implementation, and In Review columns" width="600" style="display:block;width:100%;max-width:600px;height:auto;margin:0 auto;border-radius:6px;" /></p>
		<p>open a teammate's design doc and leave a comment. design-phase feedback is the cheapest, highest-leverage review you'll ever give: the code doesn't exist yet, so changing direction costs nothing</p>
		<p>going deeper on how to make agents work well with shared context: <a href="https://hlyr.dev/ace-fca">hlyr.dev/ace-fca</a></p>
		<p>and if your team's not on HumanLayer yet, our Discord works as a stand-in: <a href="https://hlyr.dev/discord">hlyr.dev/discord</a></p>
		<p>- dex</p>
	`

	const teamWorkDefault = new resend.Template(
		'onboarding-v1-team-work-default',
		{
			name: 'onboarding-v1-team-work-default',
			alias: 'onboarding-v1-team-work-default',
			from,
			replyTo,
			subject: 'real-time collaboration on every task in your org',
			text: `${teamWorkDefaultText}\n\n${unsubscribeFooterText}`,
			html: `${teamWorkDefaultHtml}\n${unsubscribeFooterHtml}`,
			variables: [{ key: 'firstName', type: 'string', fallbackValue: 'there' }],
		},
		{ provider: opts.provider },
	)

	return {
		welcome,
		rpiTaskDefault,
		rpiTaskTrackerVariant,
		designDocDefault,
		designDocDoneNonAdmin,
		designDocDoneAdmin,
		designCommentDefault,
		designCommentUnresolvedVariant,
		structureOutlineDefault,
		structureOutlineDoneVariant,
		implementationDefault,
		implementationStartedVariant,
		implementationCompleteVariant,
		teamWorkDefault,
	}
}

export type OnboardingTemplates = ReturnType<typeof createOnboardingTemplates>
