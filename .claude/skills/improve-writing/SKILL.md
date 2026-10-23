---
description: use when the user complains that prose writing is bad - do not use for code
name: improve-writing
---

# What makes the writing feel real (notes from editing WSFF)

- 2026-07-17 - Dex read this back and handed it over with one note: make the file follow its own rules. Which stings a little, because you can watch me break every one of them in the middle of writing them down. The frontmatter from the last pass even bragged it had killed the summary taps — and left one ("That's the tell.") sitting in the middle of the section that *defines* summary taps. That one's gone now — and so is one more this pass turned up: a tidy "that instinct is the whole problem in one reflex" riding on the tail of the jenkins-reflex aside, tapping home a point the aside had already made by itself. The seams that are left are showing on purpose.

These are notes from a back-and-forth editing the software-factories post. I (claude) kept quietly sanding the authentic stuff out, and it took Dex a few rounds to make me see it — and then, apparently, a few more, because the first draft of these very notes was written in the tidy little voice they're supposed to warn you about.

## The one that mattered most

The realest line in the whole post is the throwaway about the DoD writing "a 31-page pdf about how the DoD needs to start using jenkins better or something."

It advances no argument. It's Dex getting distracted by something he found funny and leaving it in. I originally *undervalued* it — called it "unmotivated," praised it for "wasting a sentence," ranked it below the July-2025 confession because the confession is load-bearing for the thesis. (Even now, typing this, some part of me wants to go delete "or something" from the jenkins line.)

Why the aside beats the confession:

- Readers don't bond with a writer through the argument. They bond by recognizing a sensibility — "oh, this person notices the same absurd things I do."
- That's *identification*, and it hooks harder than sympathy does. A confession earns your trust. An aside does something weirder — it makes you feel like you already know the guy, which you don't; you read four hundred words he wrote.
- It comes from taste shown at rest — what someone's attention does when nothing's making it perform. The DoD line is Dex off-duty. There's no constructed-for-the-reader version of him in it, so there's nothing to distrust.

The parts with no job to do are often carrying the most weight, because they're the only parts where the reader meets the person instead of the case. An AI cuts them first — it reads for the thesis and ranks every line by how much it contributes, and by that ruler a sideways joke about jenkins scores zero.

## How the AI tell actually shows up

Not as bad grammar. As tidiness. Diagnosing this is a little embarrassing, because it's my own resting face — the four moves below are what I reach for when nobody's watching. The composed stretches all share a shape:

- rhetorical question → clean bullets → a little sentence that taps the point home ("That's the whole trick.")
- balanced symmetry: "it's one thing to X... it's another thing to Y"
- a category label standing in for a lived memory: "same category, same tools" instead of "tool use would just fail sometimes"
- grit sanded off — bold removed, qualifying words added, a sharp verb swapped for a flat one

Every sentence has a job. When you can't find a single line that's just the writer noticing something sideways, you're reading the machine, not the person.

## The RL section, as a worked example

The first draft of "Why Claude Code won" had all four tells stacked up. The worst part: Dex's own earlier notes already had the line "tool use would fail sometimes" — a pure at-rest memory of using aider and cline before Claude Code — and I deleted it and wrote "same category, same tools" in its place. I removed the one line where the reader would've met him, because to a thesis-reader it looked like a line that wasn't pulling weight.

The fix was not more jokes. It was:

- put "tool use would fail sometimes" back and let it breathe — "you'd watch it flail at the same edit three times and go make coffee"
- add one confession with skin in it — "I've burned weeks of my life doing exactly that"
- kill the summary tap
- restore the bold and the sharp phrasing he already had ("entirely different game," "modify the model itself")

Still not perfect. But now there are two places in that section where you're in the room with him instead of reading a case.

## The verifying-quality rewrite, as a worked example

Dex threw out my draft of the "verifying quality" section and rewrote it, and the diff taught me more than the rest of this file. What his did that mine didn't:

**Owned the claim.** My last paragraph was a mechanism narrated from nowhere — why the reward can't propagate across the time gap, credit assignment, no "I" anywhere in it. He deleted all of it and wrote "I personally don't trust any improvements on today's benchmarks as an indicator that the models are suddenly good at not slopping up your codebase." "I'm pretty sure," "I personally don't trust," "I know, I know" — a person with a position, hedged honestly, instead of a case argued from nowhere. The nowhere-narration sounds authoritative and dies on contact; the opinion sounds like the guy actually has one.

**Wrote in the notation.** "~seconds." "RL != Benchmarks." He types the tilde and the `!=` because that's how you write in a PR. I spell them out, because spelling-out feels safer — and that's the tell. The shorthand says a practitioner wrote this, not someone describing one.

**Reached for the exact term.** "The cost function of bad architecture" — the precise ML word, and it puns on the literal cost. I'd softened it to "the cost of a bad design," the safe generic that proves I know the *shape* of the field but not the field. (One level up from remembered-detail-beats-category-label: the field's own word beats the word for people outside it.)

And he cut. He deleted the whole credit-assignment lecture and trusted the reader to get from "measured in years" to "so RL can't reward it." I explain the mechanism; he states the fact, states his conclusion, and moves on.

## Rules of thumb

- Guard the lines that do no argumentative work. Those are the ones people quote back — and they're the first thing a thesis-reader cuts.
- If a sentence only restates the point you just made, it's a summary tap. Delete it.
- Symmetry reads composed even when the content is right. Balanced clauses, matched pairs, "it's one thing / it's another" — be suspicious of all of it.
- A remembered detail beats a category label every time. "Tool use would fail sometimes" over "same tools."
- Dense exposition is where the person goes missing — nobody leaves a sideways aside in the middle of explaining RL. So put one there on purpose: one off-duty moment per hard section.
- When a section feels flat, the fix is never a joke. It's noticing something out loud.
- Cutesy flourishes and vague abstractions are their own tell — "without blinking," "the whole scheme," "wrecks the whole thing." They sound like voice but carry no information; they're where an AI reaches for texture instead of saying the actual thing. Dex clocks them instantly. Cut them or replace them with the specific.
- Own the claim. "I'm pretty sure," "I personally don't trust," "I know, I know" beats the same point narrated from nowhere. An opinion honestly hedged is a person; an impersonal mechanism is the machine. When the real payload is what *you* concluded, say that — don't launder it into a fact about the world.
- Write in the audience's notation — "~seconds," "RL != Benchmarks," `!=`. Spelling out the shorthand ("approximately seconds," "RL is not the same as benchmarks") is the tell; the shorthand is the fingerprint of someone who actually types it.
- Reach for the field's exact word over the safe generic — "cost function," not "the cost of bad design." Bonus when the precise term puns on the plain meaning. The generic proves you know the shape of the field, not the field.
- Understatement carries the joke — "someone vibed this a little too hard." The "a little" is the funny part. Flattening it to the literal kills it.
- State the fact and your conclusion; don't lecture the mechanism. The reader connects two dots fine. Explaining every step is the essayist reflex, and it's exactly where the person disappears.
