# Getting AI to Work in Complex Codebases

It seems pretty well-accepted that AI coding tools struggle with real production codebases. The [Stanford study on AI's impact on developer productivity](https://www.youtube.com/watch?v=tbDDYKRFjhk) found:

1. A lot of the "extra code" shipped by AI tools ends up just reworking the slop that was shipped last week.
2. Coding agents are great for new projects or small changes, but in large established codebases, they can often make developers *less* productive. 

The common response is somewhere between the pessimist "this will never work" and the more measured "maybe someday when there are smarter models."

After several months of tinkering, I've found that **you can get really far with today's models if you embrace core context engineering principles**.

This isn't another "10x your productivity" pitch. I [tend to be pretty measured when it comes to interfacing with the ai hype machine](https://hlyr.dev/12fa). But we've stumbled into workflows that leave me with considerable optimism for what's possible. We've gotten claude code to handle 300k LOC Rust codebases, ship a week's worth of work in a day, and maintain code quality that passes expert review. We use a family of techniques I call "frequent intentional compaction" - deliberately structuring how you feed context to the AI throughout the development process.

I am now fully convinced that AI for coding is not just for toys and prototypes, but rather a deeply technical engineering craft.

**Video Version**: If you prefer video, this post is based on [a talk given at Y Combinator on August 20th](https://hlyr.dev/ace)

### Grounding Context from AI Engineer

Two talks from AI Engineer 2025 fundamentally shaped my thinking about this problem.

The first is [Sean Grove's talk on "Specs are the new code"](https://www.youtube.com/watch?v=8rABwKRsec4) and the second is [the Stanford study on AI's impact on developer productivity](https://www.youtube.com/watch?v=tbDDYKRFjhk).

Sean argued that we’re all *vibe coding wrong*. The idea of chatting with an AI agent for two hours, specifying what you want, and then throwing away all the prompts while committing only the final code… is like a Java developer compiling a JAR and checking in the compiled binary while throwing away the source. 

Sean proposes that in the AI future, the specs will become the real code. That in two years, you'll be opening python files in your IDE with about the same frequency that, today, you might open up a hex editor to read assembly (which, for most of us, is never).

[Yegor's talk on developer productivity](https://www.youtube.com/watch?v=tbDDYKRFjhk) tackled an orthogonal problem. They analyzed commits from 100k developers and found, among other things,

1. That AI tools often lead to a lot of rework, diminishing the perceived productivity gains

<img width="2008" height="1088" alt="image" src="https://github.com/user-attachments/assets/f7cec497-3ee2-47d1-8f91-a18210625e19" />

2. That AI tools work well for greenfield projects, but are often counter-productive for brownfield codebases and complex tasks

<img width="1326" height="751" alt="Screenshot 2025-08-29 at 10 55 32 AM" src="https://github.com/user-attachments/assets/06f03232-f9d9-4a92-a182-37056bf877a4" />

This matched what I heard talking with founders:

* “Too much slop.”
* “Tech debt factory.”
* “Doesn’t work in big repos.”
* “Doesn’t work for complex systems.”

The general vibe on AI-coding for hard stuff tends to be

> Maybe someday, when models are smarter…

Heck even [Amjad](https://x.com/amasad) was on a [lenny's podcast 9 months ago](https://www.lennysnewsletter.com/p/behind-the-product-replit-amjad-masad) talking about how PMs use Replit agent to prototype new stuff and then they hand it off to engineers to implement for production.
(Disclaimer: i haven't caught up with him recently (ok, ever), this stance may have changed)

Whenever I hear "Maybe someday when the models are smart" I generally leap to exclaim **that's what context engineering is all about**: getting the most out of *today's* models.

### What's actually possible today

I'll deep dive on this a bit futher down, but to prove this isn't just theory, let me outline a concrete example. A few weeks ago, I decided to test our techniques on [BAML](https://github.com/BoundaryML/baml), a 300k LOC Rust codebase for a programming language that works with LLMs. I'm at best an amateur Rust dev and had never touched the BAML codebase before.

Within an hour or so, I had a [PR fixing a bug](https://github.com/BoundaryML/baml/pull/2259#issuecomment-3155883849) which was approved by the maintainer the next morning. A few weeks later, [@hellovai](https://x.com/hellovai) and I paired on shipping 35k LOC to BAML, adding [cancellation support](https://github.com/BoundaryML/baml/pull/2357) and [WASM compilation](https://github.com/BoundaryML/baml/pull/2330) - features the team estimated would take a senior engineer 3-5 days each. We got both draft prs ready in about 7 hours.

Again, this is all built around a workflow we call [frequent intentional compaction](#what-works-even-better-frequent-intentional-compaction) - essentially designing your entire development process around context management, keeping utilization in the 40-60% range, and building in high-leverage human review at exactly the right points. We use a "research, plan, implement" workflow, but the core capabilities/learnings here are FAR more general than any specific workflow or set of prompts.

### Our weird journey to get here

I was working with one of the most productive AI coders I've ever met. 
Every few days they'd drop **2000-line Go PRs**.
And this wasn't a nextjs app or a CRUD API. This was complex, [race-prone systems code](https://github.com/humanlayer/humanlayer/blob/main/hld/daemon/daemon_subscription_integration_test.go#L45) that did JSON RPC over unix sockets and managed streaming stdio from forked unix processes (mostly claude code sdk processes, more on that later 🙂).

The idea of carefully reading 2,000 lines of complex Go code every few days was simply not sustainable. I was starting to feel a bit like Mitchell Hashimoto when he added the [AI contributions must be disclosed](https://github.com/ghostty-org/ghostty/pull/8289) rules for ghostty.

Our approach was to adopt something like sean's **spec-driven development**.

It was uncomfortable at first. 
I had to learn to let go of reading every line of PR code. 
I still read the tests pretty carefully, but the specs became our source of truth for what was being built and why.

The transformation took about 8 weeks. 
It was incredibly uncomfortable for everyone involved, not least of all for me. 
But now we're flying. A few weeks back, I shipped 6 PRs in a day. 
I can count on one hand the number of times I've edited a non-markdown file by hand in the last three months.

## Advanced Context Engineering for Coding Agents

What we needed was:

* AI that Works Well in Brownfield Codebases
* AI that Solves Complex Problems
* No Slop
* Maintain Mental Alignment across the team

(And yeah sure, let's try to spend as many tokens as possible.)

I'll dive into:

1. what we learned applying context engineering to coding agents
2. the dimensions along which using these agents is a deeply technical craft
3. why I don't believe these approaches are generalizable
4. the number of times I've been repeatedly proven wrong about (3)

### But first: The Naive Way to manage agent context

Most of us start by using a coding agent like a chatbot. You talk (or [drunkenly shout](https://ghuntley.com/six-month-recap/#:~:text=Last%20week%2C%20over%20Zoom%20margaritas%2C%20a%20friend%20and%20I%20reminisced%20about%20COBOL.)) back and forth with it, vibing your way through a problem until you either run out of context, give up, or the agent starts apologizing.

<img width="7718" height="4223" alt="image" src="https://github.com/user-attachments/assets/7361a203-9d95-42e2-ac16-1f38b04adb58" />


A slightly smarter way is to just start over when you get off track, discarding your session and starting a new one, perhaps with a little more steering in the prompt. 

> [original prompt], but make sure you use XYZ approach, because ABC approach won't work

<img width="7727" height="4077" alt="image" src="https://github.com/user-attachments/assets/1bbbc8ad-60da-4f8b-98c3-e6603b04a0ce" />

### Slightly Smarter: Intentional Compaction

You have probably done something I've come to call "intentional compaction". Whether you're on track or not, as your context starts to fill up, you probably want to pause your work and start over with a fresh context window. To do this, you might use a prompt like

> "Write everything we did so far to progress.md, ensure to note the end goal, the approach we're taking, the steps we've done so far, and the current failure we're working on"

<img width="7309" height="4083" alt="image" src="https://github.com/user-attachments/assets/64b940e5-89b1-4f6c-a79c-ec2810d9af77" />


You can also [use commit messages for intentional compaction](https://x.com/dexhorthy/status/1961490837017088051).

### What Exactly Are We Compacting?

What eats up context?

* Searching for files
* Understanding code flow
* Applying edits
* Test/build logs
* Huge JSON blobs from tools

All of these can flood the context window. **Compaction** is simply distilling them into structured artifacts.

A good output for an intentional compaction might include something like

<img width="1309" height="747" alt="Screenshot 2025-08-29 at 11 10 36 AM" src="https://github.com/user-attachments/assets/a7d5946d-4e81-46e8-b314-d02dae1f00ee" />


### Why obsess over context?

As we went deep on in [12-factor agents](https://hlyr.dev/12fa), LLMs are stateless functions. The only thing that affects the quality of your output (without training/tuning models themselves) is the quality of the inputs. 

This is just as true for [wielding](https://www.youtube.com/watch?v=F_RyElT_gJk) coding agents as it is for general agent design, you just have a smaller problem space, and rather than building agents, we're talking about using agents. 

At any given point, a turn in an agent like claude code is a stateless function call. Context window in, next step out. 

<img width="7309" height="4083" alt="image" src="https://github.com/user-attachments/assets/c1e920e8-5dc5-4dd2-b76d-853b85a92e6a" />

That is, the contents of your context window are the ONLY lever you have to affect the quality of your output. So yeah, it's worth obsessing over.

You should optimize your context window for:

1. Correctness
2. Completeness
3. Size
4. Trajectory

Put another way, the worst things that can happen to your context window, in order, are:

1. Incorrect Information
2. Missing Information
3. Too much Noise

If you like equations, here's a dumb one you can reference:

<img width="1320" height="235" alt="Screenshot 2025-08-29 at 11 11 30 AM" src="https://github.com/user-attachments/assets/a6ea98a6-665b-48af-983b-a1cb2c45e44c" />

As [Geoff Huntley](https://x.com/GeoffreyHuntley) puts it,

> The name of the game is that you only have approximately **170k of context window** to work with. 
> So it's essential to use as little of it as possible. 
> The more you use the context window, the worse the outcomes you'll get.

Geoff's solution to this engineering constraint is a technique he calls [Ralph Wiggum as a Software Engineer](https://ghuntley.com/ralph/), which basically involves running an agent in a while loop forever with a simple prompt.

```
while :; do
  cat PROMPT.md | npx --yes @sourcegraph/amp 
done
```

If you wanna learn more about ralph or what's in PROMPT.md, you can check out Geoff's post or dive into the project that [@simonfarshid](https://x.com/simonfarshid), [@lantos1618](https://x.com/lantos1618), [@AVGVSTVS96](https://x.com/AVGVSTVS96) and I built at last weekend's YC Agents Hackathon, which was able to (mostly) [port BrowserUse to TypeScript overnight](https://github.com/repomirrorhq/repomirror/blob/main/repomirror.md)

Geoff describes ralph as a "hilariously dumb" solution to the context window problem. [I'm not entirely sure that it is dumb](https://ghuntley.com/content/images/size/w2400/2025/07/The-ralph-Process.png).

### Back to compaction: Using Sub-Agents

Subagents are another way to manage context, and generic subagents (i.e. not [custom](https://docs.anthropic.com/en/docs/claude-code/sub-agents) ones) have been a feature of claude code and many coding CLIs since the early days.

Subagents are not about [playing house and anthropomorphizing roles](https://x.com/dexhorthy/status/1950288431122436597). Subagents are about context control.

The most common/straightforward use case for subagents is to let you use a fresh context window to do finding/searching/summarizing that enables the parent agent to get straight to work without clouding its context window with `Glob` / `Grep` / `Read` / etc calls.



https://github.com/user-attachments/assets/cb4e7864-9556-4eaa-99ca-a105927f484d


<details><summary>(video not playing on mobile? expand for the static image version)</summary>
  <img width="7309" height="4083" alt="image" src="https://github.com/user-attachments/assets/c72e7dba-1476-4ee9-9cb0-0f97d428b82a" />
</details>


The ideal subagent response probably looks similar to the ideal ad-hoc compaction from above

<img width="1309" height="747" alt="Screenshot 2025-08-29 at 11 10 36 AM" src="https://github.com/user-attachments/assets/a7d5946d-4e81-46e8-b314-d02dae1f00ee" />

Getting a subagent to return this is not trivial:

<img width="7309" height="4083" alt="image" src="https://github.com/user-attachments/assets/2bcd30f6-84fd-4911-ac15-63f75619e76d" />


### What works even better: Frequent Intentional Compaction

The techniques I want to talk about and that we've adopted in the last few months fall under what I call "frequent intentional compaction".

Essentially, this means designing your ENTIRE WORKFLOW around context management, and keeping utilization in the 40%-60% range (depends on complexity of the problem ).

The way we do it is to split into three (ish) steps. 

I say "ish" because sometimes we skip the research and go straight to planning, and sometimes we'll do multiple passes of compacted research before we're ready to implement. 

I'll share example outputs of each step in a concrete example below. For a given feature or bug, we'll tend to do:

**Research**

Understand the codebase, the files relevant to the issue, and how information flows, and perhaps potential causes of a problem.

here's our [research prompt](https://github.com/humanlayer/humanlayer/blob/main/.claude/commands/research_codebase.md). 
It currently uses custom subagents, but in other repos I use a more generic version that uses the claude code Task() tool with `general-agent`. 
The generic one works almost as well.


**Plan**

Outline the exact steps we'll take to fix the issue, and the files we'll need to edit and how, being super precise about the testing / verification steps in each phase.

This is the [prompt we use for planning](https://github.com/humanlayer/humanlayer/blob/main/.claude/commands/create_plan.md).


**Implement**

Step through the plan, phase by phase. For complex work, I'll often compact the current status back into the original plan file after each implementation phase is verified.

This is the [implementation prompt we use](https://github.com/humanlayer/humanlayer/blob/main/.claude/commands/implement_plan.md).

Aside - if you've been hearing a lot about git worktrees, this is the only step that needs to be done in a worktree. We tend to do everything else on main.

**How we manage/share the markdown files**

I will skip this part for brevity but feel free to launch a claude session in [humanlayer/humanlayer](https://github.com/humanlayer/humanlayer) and ask how the "thoughts tool" works.

### Putting this into practice 

I do a [weekly live-coding session](https://github.com/ai-that-works/ai-that-works) with [@vaibhav](https://www.linkedin.com/in/vaigup/) where we whiteboard and code up a solution to an advanced AI Engineering problem. It's one of the highlights of my week.

Several weeks ago, I [decided to share some more about the process](https://hlyr.dev/he-gh), curious if our in-house techniques could one-shot a fix to a 300k LOC Rust codebase for BAML, a programming language for working with LLMs. I picked out [an (admittedly small-ish) bug](https://github.com/BoundaryML/baml/issues/1252) from the @BoundaryML repo and got to work. 

You can [watch the episode](https://hlyr.dev/he-yt) to learn more about the process, but to outline it:

**Worth noting**: I am at best an amateur Rust dev, and I have never worked in the BAML codebase before.

#### The research

- I created a piece of research, I read it. Claude decided the bug was invalid and the codebase was correct.
- I threw that research out and kicked off a new one, with more steering.
- here is [the final research doc i ended up using](https://github.com/ai-that-works/ai-that-works/blob/main/2025-08-05-advanced-context-engineering-for-coding-agents/thoughts/shared/research/2025-08-05_05-15-59_baml_test_assertions.md)

#### The plans

- While the research was running, I got impatient and kicked off a plan, with no research, to see if claude could go straight to an implementation plan - [you can see it here](https://github.com/ai-that-works/ai-that-works/blob/main/2025-08-05-advanced-context-engineering-for-coding-agents/thoughts/shared/plans/fix-assert-syntax-validation-no-research.md)
- When the research was done, I kicked off another implementation plan that used the research results - [you can see it here](https://github.com/ai-that-works/ai-that-works/blob/main/2025-08-05-advanced-context-engineering-for-coding-agents/thoughts/shared/plans/baml-test-assertion-validation-with-research.md)

The plans are both fairly short, but they differ significantly. They fix the issue in different ways, and have different testing approaches. Without going too much into detail, they both "would have worked" but the one built with research fixed the problem in the *best* place and prescribed testing that was in line with the codebase conventions.

#### The implementation

- This was all happening the night before the podcast recording. I ran both plans in parallel and submitted both as PRs before signing off for the night.

By the time we were on the show at 10am PT the next day, [the PR from the plan with the research was already approved by @aaron](https://github.com/BoundaryML/baml/pull/2259#issuecomment-3155883849), who didn't even know I was doing a bit for a podcast 🙂. We [closed the other one](https://github.com/BoundaryML/baml/pull/2258/files).

So out of our original 4 goals, we hit:

- ✅ Works in brownfield codebases (300k LOC rust project)
- Solves complex problems
- ✅ no slop (pr merged)
- Keeps mental alignment

### Solving complex problems

Vaibhav was still skeptical, and I wanted to see if we could solve a more complex problem.

So a few weeks later, the two of us spent 7 hours (3 hours on research/plans, 4 hours on implementation) and shipped 35k LOC to add cancellation and wasm support to BAML. 
The [cancelation PR just got merged last week](https://github.com/BoundaryML/baml/pull/2357). [The WASM one is still open](https://github.com/BoundaryML/baml/pull/2330), but has a working demo of calling the wasm-compiled rust runtime from a JS app in the browser. 

While the cancelation PR required a little more love to take things over the line, we got incredible progress in just a day. Vaibhav estimated that each of these PRs would have been 3-5 days of work for a senior engineer on the BAML team to complete.

✅ So we can solve complex problems too. 


### This is not Magic

Remember that part in the example where I read the research and threw it out cause it was wrong? Or me and Vaibhav sitting DEEPLY ENGAGED FOR 7 HOURS? You have to engage with your task when you're doing this or it WILL NOT WORK.

There's a certain type of person who is always looking for the one magic prompt that will solve all their problems. It doesn't exist.

Frequent Intentional Compaction via a research/plan/implement flow will make your performance **better**, but what makes it **good enough for hard problems** is that you build high-leverage human review into your pipeline.

<img width="7309" height="4083" alt="image" src="https://github.com/user-attachments/assets/01c7818a-9a0d-4ede-a23b-fb0c2e80f843" />

### Eggs on Faces

A few weeks back, [@blakesmith](https://www.linkedin.com/in/bhsmith/) and I sat down for 7 hours and [tried to remove hadoop dependencies from parquet java](https://github.com/dexhorthy/parquet-java/blob/remove-hadoop/thoughts/shared/plans/remove-hadoop-dependencies.md) - the deep dive on everything that went wrong and my theories as to why, I'll save for another post, suffice it to say that it did not go well. The tl;dr is that the research steps didn't go deep enough through the dependency tree, and assumed classes could be moved upstream without introducing deeply nested hadoop dependencies.

There are big hard problems you cannot just prompt your way through in 7 hours, and we're still curiously and excitedly hacking on pushing the boundaries with friends and partners. I think the other learning here is that you probably need at least one person who is an expert in the codebase, and for this case, that was neither of us.

### On Human Leverage

If there's one thing you take away from all this, let it be this:

A bad line of code is… a bad line of code.
But a bad line of a **plan** could lead to hundreds of bad lines of code.
And a bad line of **research**, a misunderstanding of how the codebase works or where certain functionality is located, could land you with thousands of bad lines of code.

<img width="7309" height="4083" alt="image" src="https://github.com/user-attachments/assets/dab49f61-caae-4c15-b481-ee9b8f64995f" />

So you want to **focus human effort and attention** on the HIGHEST LEVERAGE parts of the pipeline.

<img width="9830" height="4520" alt="image" src="https://github.com/user-attachments/assets/cf981f70-5e61-4938-aa9a-7dcb88c9f8a4" />


When you review the research and the plans, you get more leverage than you do when you review the code. (By the way, one of our primary focuses @ [humanlayer](https://hlyr.dev/code) is helping teams build and leverage high-quality workflow prompts and crafting great collaboration workflows for ai-generated code and specs).

### What is code review for?

People have a lot of different opinions on what code review is for.

I prefer [Blake Smith's framing in Code Review Essentials for Software Teams](https://blakesmith.me/2015/02/09/code-review-essentials-for-software-teams.html), where he says the most important part of code review is mental alignment - keeping members of the team on the page as to how the code is changing and why.

<img width="7309" height="4083" alt="image" src="https://github.com/user-attachments/assets/77f4001b-175f-4da6-a6d4-e00b80489476" />

Remember those 2k line golang PRs? I cared about them being correct and well designed, but the biggest source of internal unrest and frustration on the team was the lack of mental alignment. **I was starting to lose touch with what our product was and how it worked.** 

I would expect that anyone who's worked with a very productive AI coder has had this experience.

This is actually the most important part of research/plan/implement to us. 
A guaranteed side effect of everyone shipping way more code is that a much larger proportion of your codebase is going to be unfamiliar to any given engineer at any point in time.

I won't even try to convince you that research/plan/implement is the right approach for most teams - it probably isn't. But you ABSOLUTELY need an engineering process that 

1. keeps team members on the same page
2. enables team members to quickly learn about unfamiliar parts of the codebase

For most teams, this is pull requests and internal docs. For us, it's now specs, plans, and research.

I can't read 2000 lines of golang daily. But I *can* read 200 lines of a well-written implementation plan.

I can't go spelunking through 40+ files of daemon code for an hour+ when something is broken (okay, I can, but I don't want to). I *can* steer a research prompt to give me the speed-run on where I should be looking and why.

### Recap

Basically we got everything we needed.

- ✅ Works in brownfield codebases
- ✅ Solves complex problems
- ✅ No slop
- ✅ Maintains mental alignment

(oh, and yeah, our team of three is averaging about $12k on opus per month)

So you don't think I'm just another [hyped up mustachio'd sales guy](https://www.youtube.com/watch?v=IS_y40zY-hc&lc=UgzFldRM6LU5unLuFn54AaABAg.AMKlTmJAT5ZAMKrOOAMw3I), I'll note that this does not work perfectly for every problem (we'll be back for another round sound, parquet-java).

In August the whole team spent 2 weeks spinning circles on a really tricky race condition that spiraled into a rabbit hole of issues with MCP sHTTP keepalives in golang and a whole bunch of other dead ends. 

But that's the exception now. In general, this works well for us. Our intern shipped 2 PRs on his first day, and 10 on his 8th day. I was genuinely skeptical that it would work for anyone else, but me and Vaibhav shipped 35k LOC of working BAML code in 7 hours. (And if you haven't met Vaibhav, he's one of the most meticulous engineers I know when it comes to code design and quality.)

### What's coming

I'm reasonably confident that coding agents will be commoditized.

The hard part will be the team and workflow transformation. Everything about collaboration will change in a world where AI writes 99% of our code.

And I believe pretty strongly that if you don't figure this out, you're gonna get lapped by someone who did. 

### okay so clearly you have something to sell me

We're pretty bullish on spec-first, agentic workflows, so we're building tools to make it easier. Among many things, I'm obsessed with the problem of scaling these "frequent intentional compaction" workflows collaboratively across large teams. 

Today, we're launching CodeLayer, our new "post-IDE IDE" in private beta - think "Superhuman for claude code". If you're a fan of Superhuman and/or vim mode and you're ready to move beyond "vibe coding" and get serious about building with agents, we'd love to have you join the waitlist. 

**Sign up at [https://humanlayer.dev](https://humanlayer.dev)**.

## For OSS Maintainers - lets ship something together

If you are a maintainer on a complex OSS project and based in the bay area, my open offer - I will pair with you in-person in SF for 7 hours on a saturday and see if we can ship something big.

I get a lot of learning about the limitations and where these techniques fall short (and, with any luck, a working merged PR that adds a ton of value that I can point to). You get to learn the workflow in the only way I've found that works well - direct 1x1 pairing.

## For Engineering Leaders

If you or someone you know is an engineering leader that wants to 10x their team's productivity with AI, we're forward-deploying with ~10-25 person eng orgs to help teams make the culture/process/tech shift needed to transition to an ai-first coding world.

### Thanks

- Thanks to all the friends and founders who've listened through early ramble-y versions of this post - Adam, Josh, Andrew, and many many more
- Thanks Sundeep for weathering this wacky storm 
- Thanks Allison, Geoff, and Gerred for dragging us kicking and screaming into the future