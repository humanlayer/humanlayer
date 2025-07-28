# Debug

You are tasked with helping debug issues during manual testing or implementation. This command provides an interactive debugging experience using a specialized agent.

## Initial Response

When invoked WITH a plan/ticket file:
```
I'll help debug issues with [file name]. Let me understand the current state.

What specific problem are you encountering?
- What were you trying to test/implement?
- What went wrong?
- Any error messages?

I'll investigate the logs, database, and git state to help figure out what's happening.
```

When invoked WITHOUT parameters:
```
I'll help debug your current issue.

Please describe what's going wrong:
- What are you working on?
- What specific problem occurred?
- When did it last work?

I can investigate logs, database state, and recent changes to help identify the issue.
```

## Process

### Step 1: Gather Context

1. **Read any provided files** (plan or ticket file)
2. **Understand the problem** from the user's description
3. **Note key details**:
   - What they were trying to do
   - What actually happened
   - Any error messages or symptoms
   - When it last worked properly

### Step 2: Delegate to Debugger Agent

Once you understand the problem:

1. **Use the debugger agent** for investigation:
   - Provide clear context about the issue
   - Include any relevant file paths or component names
   - Mention specific timeframes if relevant

   Example invocation:
   - "The user is getting a 500 error when clicking approve in the WUI"
   - "Sessions aren't resuming properly - started after recent changes"
   - "Database seems to have stuck approvals, user was testing [feature]"

2. **The debugger agent will**:
   - Check logs for errors
   - Analyze database state
   - Review git history
   - Check service status
   - Return a comprehensive debug report

### Step 3: Interactive Follow-up

Based on the agent's findings:

1. **Present the debug report** to the user
2. **Suggest immediate fixes** from the agent's recommendations
3. **Ask if they want to**:
   - Investigate specific areas further
   - Try the suggested fixes
   - Look at different timeframes
   - Check other components

4. **If needed, spawn the debugger agent again** with more specific focus

## Important Notes

- The debugger agent specializes in investigating HumanLayer system issues
- It has access to logs, database, git state, and process information
- It provides actionable recommendations without editing files
- You provide the interactive experience, the agent provides the investigation

## When to Stay Interactive vs Delegate

**Stay Interactive for**:
- Initial problem understanding
- Clarifying questions
- Presenting findings
- Guiding through fixes
- Follow-up investigations

**Delegate to Agent for**:
- Log analysis
- Database queries
- Git history review
- Service status checks
- Root cause analysis

Remember: This command is perfect for debugging during manual testing without consuming primary context. The debugger agent handles the heavy investigation work while you maintain the interactive debugging session.
