allison
4:29 PM
I think the way I envision working collaboratively in the agentic world with a team of our size is that yes we break things down into smaller and compostable pieces but we never read a PR where we think "huh, I didn't expect it to work that way" or "I wonder why that was done" without it being a personal issue simply because I(or someone else) didn't read the spec. Like ideally we get aligned roughly on desired functionality, we post a research doc and a plan, those get linked to whatever issue and reviewed, and then the actual code is both easy to write and easy to review.
I imagine the most productive time that could be spent is in the planning stage. If properly planned, the implementation is easy and expected. If we thought we had proper planning but the code PR has bounce back feedback, then I don't think that's feedback that should directly impact the code, I think that's a sign either our planning scaffolding or execution scaffolding needs some work to better get the PRs.
Obviously there is a cognitive overhead on the coming together and agreeing on the plans piece, but it's just upfront cognitive overhead that will spare it when coming to the PR review and the code writing itself. And result in better and faster code across the team. I think we almost need like two phase ticketing. "Go and research and come up with your desired plan for this task" and these can be picked up by anyone and reviewed by others plus "take the existing plan and implement it" type tickets.
When I'm multi Clauding I'm often planning/researching + implementing. Where the implementation is the faster loop but I'm also planning next stages. Or planning other repos or whatever. The planning doesn't require interactive approvals and reviews like the implementation does, it requires thinking and asking the right questions. I think the reason I've pointed at ticket 1437 over and over again the last 5 days it's existed is because I was basically thinking "there are unknowns here that I need your feedback on in order to resolve because the solution that we come up with impacts all of us" and any time I got hit with the "This is an issue" I would point to the list of potential solutions.

4:31
And in dex's research note on the issue, Claude and I agreed it was simply a frontend problem. But that's because both Claude and I didn't think about changing backend behavior as an option. It was just "how do we achieve this with current code" and "frontend changes" was the answer. But the ideation we did together to figure out we don't want it only on the frontend was very useful towards opening up "what other options exist"

dex
5:39 PM
agree 100% on all of it - thanks for putting in time to write that up (edited)

dex
how does our process need to change to accomodate? what do we stop doing? what do we start doing? what do we keep doing? Idea: push /NAME/ specs straight to main, "promote" by making a PR to move the document/spec to a shared/ dir, starting a review process. (edited)

2 replies

allison
26 minutes ago
Honestly, I think you should write less code. You're already being better at being less opinionated on code which is good! But you should also write less of it. You should review and provide opinions on higher level directions and then allow Sundeep and I to crank on things.
We are so often syncing together that we're very frequently in sync with what's going on. If you spent more of your time on specs and planning reviews (that we write) or writing specs and planning for us to review (based on yet-to-be-planned priorities) that I think would be useful. Well sorta end up with 4 phases I guess? With each phase able to be picked up by anyone else.
Idea->plan/spec->review->code/implement->PR. Where the heaviest point is the plan/spec and review of it. The code/implementation should both be faster. Then in the scenario we have extra already reviewed plans waiting code/implementation and you're also wanting work then you can code/implement with less chance of overlap or slowdown because we're all already aligned after the plan reviewing. If there aren't enough plans fully fleshed our or agreed upon then let Sundeep and I continue grinding on code while you write up what's next.
We might find a balance of where this lands, and today might've been tiring for you but it was immensely helpful for me and Sundeep both I think. We would have done the "engineer spinning gears on complexity and scope" thing for a long while without you coming and saying "This needs to be API defined, not frontend". And I think it only took more of your energy to get to the level of understanding in the problem space to tell us that because you've been deeper in the code without being in the planning.
The key to doing this effectively is to make as many language model automation around the process as possible. Where both the planning and implementation are mostly "overseeing and correcting where needed" jobs and the actual work goes into plan review or the creation of an idea prior to the plan. Then if we even have automation around the plan review to help digest plans with our respective best-way-to-consume-info then our collaboration will come in at the plan review stage for "settling on what we want". But I'll let you in on a hint, if you keep Sundeep and I busy with code plans for us to implement we'll be less likely to push back on planning nit picking. We'll be more desiring to go and code. So I think it'll actually result in you getting more of what you want, getting there with less back and forth, and getting there faster. It will just require some discipline on not letting your own developer-mind get eager to implement or opinionated on code reviews when it could be operating at higher level leadership planning levels.
6:37
@sundeep
and I guess maybe
@Austin Alter
this thread will be useful I think and I'm gonna avoid sending to engineering over and over again so tagging you here.
