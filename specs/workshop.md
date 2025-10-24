# Workshop: Advanced Context Engineering for coding agents

This is a workshop to learn how to use some advanced context engineering techniques with Claude Code.

Watch the video: https://hlyr.dev/ace ([or read the post](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/ace-fca.md))

More links and info: https://github.com/ai-that-works/ai-that-works/tree/main/2025-08-05-advanced-context-engineering-for-coding-agents


Want to discuss these techniques? Join us in https://humanlayer.dev/discord

## Pre-Requisites

- Claude Code acount and logged in on your workstation
- A way to view/edit markdown files (Cursor, VSCode, vim, go-grip, etc)
- A chosen issue to work on, ideally on an OSS repo that you have some familiarity with / understanding of

COST NOTE - we recommend using Opus for this workshop as its the best at reliably understanding and working in large codebases.

## Objectives / Outcomes

- familiarity with managing claude code subagents and commands


## Outline

## Step-by-step guide

### 1. Choose an issue to work on

You should pick an issue to work on. It should be somewhat small just ot help you focus on learning the system.

You can use these techniques in your own private repos, but if you want help/etc I recommend using an open source repo that you have some familiarity with / understanding of.

A good bar to set, is to pick the OSS repo for a tool you use often enough that if you read a bug ticket, you can understand and reproduce the issue yourself.

### 2. Clone the repository

WHatever issue you choose to work on , you will need to clone the repository to your workstation. This will be your "working repository"

### 3. clone the humanlayer repo

To get the example prompts and agents, you will need to clone the humanlayer repo.

This should be cloned at the same level as your working repository (i.e. DO NOT clone it inside your working repository)

```
git clone https://github.com/humanlayer/humanlayer.git
```

### 4. Borrow the prompts

Copy the prompts and agents from humanlayer to your repo diectory.

```
mkdir -p .claude/commands
mkdir -p .claude/agents
```

It is okay if these directories are non empty, but since we're copying over files, you should make sure you won't overwrite any existing files that you wanted to keep:

```
ls .claude/commands
ls .claude/agents
```

```
# Use the non-thoughts (nt) variants for cleaner workshop experience
cp ../humanlayer/.claude/commands/research_codebase_nt.md .claude/commands/research_codebase.md
cp ../humanlayer/.claude/commands/create_plan_nt.md .claude/commands/create_plan.md
cp ../humanlayer/.claude/commands/implement_plan.md .claude/commands/
```

```
cp ../humanlayer/.claude/agents/codebase-analyzer.md .claude/agents/
cp ../humanlayer/.claude/agents/codebase-locator.md .claude/agents/
cp ../humanlayer/.claude/agents/codebase-pattern-finder.md .claude/agents/
cp ../humanlayer/.claude/agents/web-search-researcher.md .claude/agents/
```


NOTE: We're using the "_nt" (non-thoughts) variants of the research_codebase and create_plan commands which are cleaner for general workshop use. These versions don't reference the HumanLayer-specific "thoughts" system. All specs/plans will be saved to a thoughts/ folder in your working repo for the workshop.


NOTE if you don't want to put the prompts in your home directory, you can instead put them in `.claude/` your working repository.

### 4b. Option 2 Borrow the prompts in your home dir

ALTERNATIVELY - you can put them in your home dir

```
mkdir -p ~/.claude/commands
mkdir -p ~/.claude/agents
```

It is okay if these directories are non empty, but since we're copying over files, you should make sure you won't overwrite any existing files that you wanted to keep:

```
ls ~/.claude/commands
ls ~/.claude/agents
```

```
# Use the non-thoughts (nt) variants for cleaner workshop experience
cp humanlayer/.claude/commands/research_codebase_nt.md ~/.claude/commands/research_codebase.md
cp humanlayer/.claude/commands/create_plan_nt.md ~/.claude/commands/create_plan.md
cp humanlayer/.claude/commands/implement_plan.md ~/.claude/commands/
```

```
cp humanlayer/.claude/agents/codebase-analyzer.md ~/.claude/agents/
cp humanlayer/.claude/agents/codebase-locator.md ~/.claude/agents/
cp humanlayer/.claude/agents/codebase-pattern-finder.md ~/.claude/agents/
cp humanlayer/.claude/agents/web-search-researcher.md ~/.claude/agents/
```


NOTE: We're using the "_nt" (non-thoughts) variants of the research_codebase and create_plan commands which are cleaner for general workshop use. These versions don't reference the HumanLayer-specific "thoughts" system. All specs/plans will be saved to a thoughts/ folder in your working repo for the workshop.


NOTE if you don't want to put the prompts in your home directory, you can instead put them in `.claude/` your working repository.



### 5. read the prompts and agents

You should at least skim the prompts and agents to understand what they do.

You don't have to be an expert, but it will be valuable to orient yourself a bit as to how they will be used.


### 6. get the issue locally

Take the issue you want to solve and get it into a .txt or .md file in your working repository. You can copy the text from github, you can use the `gh` cli, you can prompt claude to use an MCP, whatever you want.

### 7. research the codebase

Open a claude session and research the codebase.

```
/research_codebase - we are working on the issue in the issue.txt file, please read the issue and research the codebase to understand how the system works and what files+line numbers are relevant to the issue. Do not make an implementation plan or explain how to fix.
```

### 8. create a plan

```
/create_plan - we are working on the issue in the issue.txt file, we've done the following research: PATH_TO_RESEARCH_OUTPUT.md

create a plan to fix the issue. YOUR ADDITIONAL INSTRUCTIONS HERE
```

### 9. implement the plan

```
/implement_plan - we are working on the issue in the issue.txt file, we've done the following research: PATH_TO_RESEARCH_OUTPUT.md

we've created a plan to fix the issue. PATH_TO_PLAN.md

please implement the plan. YOUR ADDITIONAL INSTRUCTIONS HERE
```

### 10. commit and pr

From here its up to you - you can use the `/commit` command to generate a commit message, you can push to a fork, and you can use `/describe_pr` to generate a pr description. (You might need to tweak the describe pr or go get a template if not present yet - ignore any error about "thoughts setup incomplete")