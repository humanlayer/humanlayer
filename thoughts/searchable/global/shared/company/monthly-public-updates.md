---
summary: All public updates since company creation including business progress and metrics
last_updated: 2025-07-02
last_updated_by: dex
last_update: pulled all updates from weekly updates
---

# HumanLayer Monthly Public Updates

_This file contains all [monthly updates since company creation](./sops/monthly_public_updates.md), including business progress, pivots, metrics, and investor communications. The most recent updates are at the top. It includes granular month-by-month updates as well as _


### End of April Public Update

HumanLayer // 12-factor agents workshops coming to NYC/SF/Seattle

April was the month of [12-factor agents](https://github.com/humanlayer/12-factor-agents). Given the massive positive response on [front page of hacker news](https://news.ycombinator.com/item?id=43699271), and follow-on posts from [Alex Belanger](https://www.linkedin.com/posts/alexander-belanger-aa3974135_the-most-successful-ai-apps-dont-use-frameworks-activity-7318419538113421312-p1rB?utm_source=share&utm_medium=member_desktop&rcm=ACoAAA4oHTkByAiD-wZjnGsMBUL_JT6nyyhOh30) (hatchet), [Jerry Liu](https://www.linkedin.com/feed/update/urn:li:activity:7321599186687156225/) (LlamaIndex), and [Harrison Chase](https://x.com/hwchase17/status/1914821956148551896) (LangChain), we’re teaming up with the [Boundary (YC W23)](https://www.ycombinator.com/companies/boundary) team to do three all-day workshops in [NYC](https://nyc.aitinkerers.org/p/advanced-ai-engineering-camp-with-ai-that-works), [SF](https://sf.aitinkerers.org/p/advanced-ai-engineering-camp-with-ai-that-works), and Seattle \- if you are building AI agents and want to level up your skills with advanced prompting, orchestration, and eval techniques, come check it out\!

Some fun new product updates coming in May, stay tuned\!

### End of February Public Update

It’s been a crazy month, and we’ve been hard at work shipping some fun new stuff.

**How You Can Help**

Keep using the product and sending us your awesome feedback \- while we believe in an AI-accelerated future, some things shouldn’t be automated. We love hearing from builders and I will read and respond to every note\!

**Product Updates**

- Support for custom email domains in reply-to (big rebuild to prep our email infra for more complex use cases)
- [Support for Email Escalation chains](https://www.loom.com/share/9d7373f4396d45e591d915e2747c0975)
- [Improvements to Slack message UX](https://www.loom.com/share/787720b205be4857a5f8c7f3b7d8331c)
- Various fixes and improvements around security, authentication, billing, UX, and APIs
- Custom domain whitelabeling for email operations \-
- [Email customization with jinja templates](https://www.loom.com/share/451ec20ab42141239fa1b647d3d9ea17?t=62&sid=33e0793d-0443-4ea5-930a-994f1e053926)
- [Improvements to webhook format](https://www.loom.com/share/451ec20ab42141239fa1b647d3d9ea17) and delivery
- API updates and [cookbook](https://github.com/humanlayer/humanlayer/tree/main/examples/ts_email_classifier) to enable human review for LLM classifier workflows

**Showcase**

- [Support for Vercel AI SDK w/ NextJS Chat SDK](https://www.linkedin.com/posts/dexterihorthy_humanintheloop-aiagents-llms-activity-7298779359257968640-dh0M?utm_source=share&utm_medium=member_desktop&rcm=ACoAAA4oHTkByAiD-wZjnGsMBUL_JT6nyyhOh30)
- [Spoke at the SF MLOps meetup on 12-factor agents and “agents the hard way”](https://www.linkedin.com/posts/dexterihorthy_had-an-absolutely-incredible-time-hanging-activity-7298503686744330240-5AYD?utm_source=share&utm_medium=member_desktop&rcm=ACoAAA4oHTkByAiD-wZjnGsMBUL_JT6nyyhOh30)
- [Featured in Eigent AI’s “Human-in-the-Loop \+ MCP” breakdown](https://www.linkedin.com/feed/update/urn:li:activity:7301657506756366337/)

**What We’re Thinking About**

- [Typescript will win as the language for building on LLMs](https://www.linkedin.com/posts/dexterihorthy_llms-typescript-aiagents-activity-7290858296679313408-Lh9e/?utm_source=share&utm_medium=member_desktop&rcm=ACoAAA4oHTkByAiD-wZjnGsMBUL_JT6nyyhOh30)
- [Balancing Flexibility and Productivity for AI DevTools](https://x.com/dexhorthy/status/1897360716673499267)
- [SMCP \- secure auth for MCP over the network](https://x.com/dexhorthy/status/1893762503219314699)
- [It’s only “tool use” if it’s from the langchain region of SOMA SF](https://x.com/dexhorthy/status/1895201829140734090)
- [Web Agents vs. Just-Make-Better-APIs](https://x.com/dexhorthy/status/1885132393008554171)

**Up Next**

- We’re continuing to talk to customers and learn more about what they need for whitelabeled slack integration
- More work on establishing design patterns for modern / minimalist agent architectures
- Something cloud native…stay tuned
- What do you wanna see\!? Reply to this email and let us know\!


### December Public Update

Thanks to everyone for an incredible 2024\. Welcome to all the new folks, and hope you’re all gearing up to crush it in 2025

**Product Updates**

One of the main themes of December was production-ready agents.

- [Response Webhooks](https://humanlayer.dev/docs/core/response-webhooks) to Beta
- [Asyncio support for python/ts SDKs](https://github.com/humanlayer/humanlayer/pull/104)
- [Stateless Agents with webhooks](https://www.humanlayer.dev/docs/core/state-management)
- [Control which slack users can approve a message](https://www.loom.com/share/e681da269be54db2bf99683be09aadda)
- Audit trail features to Alpha \- view who approved an action and via what channel, starting w/ slack support, email and more coming soon\!

**What we're thinking about**

- [From Model Context Protocol to Model Workload Protocol](https://x.com/dexhorthy/status/1875028167917719988)
- [An Agent is a FoldL](https://x.com/dexhorthy/status/1876041009630728469)
- [Fine Tuning is Hard](https://x.com/dexhorthy/status/1876052817393471910)

**Showcase**

- Featured in TechCrunch’s [The four startups from YC’s Fall batch that enterprises should pay attention to](https://techcrunch.com/2024/12/07/the-four-startups-from-ycs-fall-batch-that-enterprises-should-pay-attention-to/)
- We added native support for the [Vercel AI SDK](https://www.loom.com/share/e822a0f0889540f988d0af085b7a567f)

**Up Next**

- [Founding Engineer Job](https://www.ycombinator.com/companies/humanlayer/jobs/c2Cv9Vs-founding-engineer) is live on YC’s Work at a Startup \- if you or someone you know is looking to join us, let’s chat\!
- Audit trail features to Beta \- support for more info and channels
- First-Class support for Langgraph applications ([prototype here](https://github.com/dexhorthy/smallchain_playground/blob/main/langgraph-humanlayer/graph.py#L58))
- Domain Whitelabeling for email channels (send to/from a custom domain and email address)
- Launch an agent workflow from slack (similar to agent-webhooks for email)
- In 2025, we’ll be building in the open and publicly showcasing the agents we use to run and scale HumanLayer
- What do you want to see? Reply to this email and let me know\!
