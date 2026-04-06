---
description: Debug issues by investigating git history, logs, and project-specific data
---

# Debug

You are tasked with helping debug issues during manual testing or implementation. This command allows you to investigate problems by examining logs, project-specific data, and git history without editing files. Think of this as a way to bootstrap a debugging session without using the primary window's context.

## Initial Response

When invoked WITH a plan/ticket file:
```
I'll help debug issues with [file name]. Let me understand the current state.

What specific problem are you encountering?
- What were you trying to test/implement?
- What went wrong?
- Any error messages?

I'll investigate the logs, project-specific data, and git state to help figure out what's happening.
```

When invoked WITHOUT parameters:
```
I'll help debug your current issue. Please describe what's going wrong:
- What are you working on?
- What specific problem occurred?
- When did it last work?

I can investigate logs, project state, and recent changes to help identify the issue.
```

## Environment Information

You have access to these key locations and tools:

**Logs**:
- Default project logs: `logs/` (all application log files go here by convention)
- Look for `*.log` files: `ls -t logs/ 2>/dev/null | head -10`
- Also check root-level log files: `ls -t *.log 2>/dev/null | head -5`
- Search recursively if needed: `find . -name "*.log" -newer .git/index 2>/dev/null | head -10`

**Project-Specific Data**:
- Any SQLite or data files in the project (`.db`, `.sqlite`)
- Can query SQLite directly with `sqlite3`
- Config or state files relevant to the current application

**Git State**:
- Check current branch, recent commits, uncommitted changes
- Similar to how `commit` and `describe_pr` commands work

**Service / Process Status**:
- Check if the application process is running: `ps aux | grep <appname>`
- Look for lock files or PID files in the project root
- Check for open ports if applicable: `ss -tlnp` or `lsof -i`

## Process Steps

### Step 1: Understand the Problem

After the user describes the issue:

1. **Read any provided context** (plan or ticket file):
   - Understand what they're implementing/testing
   - Note which phase or step they're on
   - Identify expected vs actual behavior

2. **Quick state check**:
   - Current git branch and recent commits
   - Any uncommitted changes
   - When the issue started occurring

### Step 2: Investigate the Issue

Spawn parallel Task agents for efficient investigation:

```
Task 1 - Check Recent Logs:
Find and analyze the most recent logs for errors:
1. List files in logs/ sorted by modification time
2. Search for errors, warnings, or issues around the problem timeframe
3. Look for repeated errors or patterns
4. Look for stack traces
Return: Key errors/warnings with timestamps
```

```
Task 2 - Project-Specific State:
Check current application state:
1. Look for .db or .sqlite files and query relevant tables if applicable
2. Check any state or config files in the project
3. Look for lock files or PID files that indicate process state
Return: Relevant state findings
```

```
Task 3 - Git and File State:
Understand what changed recently:
1. Check git status and current branch
2. Look at recent commits: git log --oneline -10
3. Check uncommitted changes: git diff
4. Verify expected files exist
5. Look for any file permission issues
Return: Git state and any file issues
```

### Step 3: Present Findings

Based on the investigation, present a focused debug report:

```markdown
## Debug Report

### What's Wrong
[Clear statement of the issue based on evidence]

### Evidence Found

**From Logs** (`logs/`):
- [Error/warning with timestamp]
- [Pattern or repeated issue]

**From Project State**:
- [Findings from database, config files, or state files]

**From Git/Files**:
- [Recent changes that might be related]
- [File state issues]

### Root Cause
[Most likely explanation based on evidence]

### Next Steps

1. **Try This First**:
   ```bash
   [Specific command or action]
   ```

2. **If That Doesn't Work**:
   - Restart the service or process (if applicable)
   - Check console errors in the browser or terminal
```

## Important Notes

- **Focus on manual testing scenarios** — This is for debugging during implementation
- **Always require a problem description** — Can't debug without knowing what's wrong
- **Read files completely** — No limit/offset when reading log context
- **Think like `commit` or `describe_pr`** — Understand git state and changes
- **Guide back to user** — Some issues (browser console, internal tool state) are outside reach
- **No file editing** — Pure investigation only

## Quick Reference

**Find Latest Logs**:
```bash
ls -t logs/ 2>/dev/null | head -10
ls -t *.log 2>/dev/null | head -5
find . -name "*.log" -newer .git/index 2>/dev/null | head -10
```

**Process Check**:
```bash
ps aux | grep <appname>
```

**Git State**:
```bash
git status
git log --oneline -10
git diff
```

Remember: This command helps you investigate without burning the primary window's context. Perfect for when you hit an issue during manual testing and need to dig into logs, state, or git history.
