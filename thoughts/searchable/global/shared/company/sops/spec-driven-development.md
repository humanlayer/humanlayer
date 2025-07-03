---
summary: Planning process to maximize velocity through detailed specification before coding
last_updated: 2025-06-26
last_updated_by: dex
last_update: Added summary field to frontmatter
---

# Spec-Driven Development Process

## Overview

We write detailed specs before coding: **Idea → Spec → Review → Implement → PR**

- **Leadership**: Write specs and review plans
- **Engineers**: Implement approved specs with minimal planning overhead
- **Result**: Faster velocity, fewer surprises, predictable PRs

> "If properly planned, the implementation is easy and expected." - Allison

## Workflow Phases

### 1. Idea → 2. Spec
- Research problem and document solution approach
- Include: problem statement, technical approach, edge cases, open questions
- Push to `/NAME/` directories, promote to `shared/` via PR

### 3. Review → 4. Implementation
- Team reviews specs (this is where cognitive effort happens)
- Engineers implement approved specs
- PR review should be quick with no surprises

## Ticketing

- **Research tickets**: "Research and create a plan for X" → outputs spec
- **Implementation tickets**: "Implement approved spec for X" → links to spec

## Linear Workflow Categories

### Triage
- Initial state for new issues
- See [triage.md](./triage.md) for detailed SOP

### Unstarted
- **To Do**: Tasks ready to be worked on
- **Spec Needed**: Tasks requiring specification before development

### In Progress
The in-progress category now includes multiple phases to track work more granularly:

1. **Spec in Progress**: Actively writing the specification
2. **Spec in Review**: Specification complete and under team review
3. **Ready for Development**: Spec approved, waiting for implementation
4. **In Dev**: Active development (renamed from "In Progress" for clarity)
5. **In Review**: Code review phase for PRs
6. **Ready for Deploy**: PR merged but not yet released
   - Particularly relevant for open source packages
   - Also applies to SaaS with manual release steps

### Done
- Released and deployed to production

## Roles

- **Leadership**: Write specs, review plans, set direction
- **Engineers**: Implement specs, flag divergences, review each other's work

## Benefits

- Heavy thinking happens once during planning
- PR reviews are fast (code matches spec)
- Better parallelization and async work
- Higher quality through upfront planning

## Key Principles

1. **Implementation should be boring** - All interesting decisions happen in specs
2. **No PR surprises** - If there are, the spec was incomplete
3. **Keep engineers coding** - Give them well-planned work