# Commit Changes

You are tasked with creating git commits for the changes made during this session.

## Process:

1. **Understand what was accomplished:**
   - Review the conversation history to understand what changes were made
   - Note the purpose and context of the changes
   - Consider if changes should be one commit or multiple logical commits

   Take a moment to think deeply about all the changes made during this session, their relationships, and how they should be logically grouped before proceeding.

2. **Delegate to the git-commit-creator agent:**
   - Use the **git-commit-creator** agent to handle the actual commit creation
   - Provide the agent with context about what was done in this session
   - The agent will analyze git status and diffs to create appropriate commits

   Example of how to invoke:
   - Tell the agent what was accomplished (e.g., "We implemented rate limiting for the API endpoints")
   - Mention any specific grouping preferences if changes should be split
   - The agent will handle all the git operations and present a plan

3. **Review the agent's plan:**
   - The agent will present which files it plans to commit and proposed messages
   - You can relay any user feedback or adjustments back to the agent
   - Once approved, the agent will execute the commits

## Important Notes:

- The git-commit-creator agent is specialized for this task
- It will never add co-author information or Claude attribution
- It knows to write commit messages as if the user wrote them
- You provide the context, the agent handles the git mechanics

## Remember:

- You have the full conversation context that the agent lacks
- Be clear about what was accomplished when invoking the agent
- The agent will handle staging files, creating commits, and showing results
