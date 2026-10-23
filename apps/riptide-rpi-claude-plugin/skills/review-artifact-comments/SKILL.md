---
name: review-artifact-comments
description: Only use when the user explicitly invokes this skill by name.
---

# Review Artifact Comments

You are helping the user address comments on an artifact file. Work through each comment systematically.

You should have several MCP tools available to you (`mcp__humanlayer__`): 
* `get_artifact_comments`
* `update_artifact_comments`
* `reply_to_artifact_comment`

If you do not have these tools available, you should inform the user that you do not have comment tools available and ask them to move the session to a task so that you can access its artifacts (these tools are not available if the session is not associated with a task)

## Input Format

When the user invokes this skill, they may or may not include a comments block, and they may or may not include an artifact filename. 

Generally:
1. If a comment block is included (Described below) - you should follow the procedure for those comments
2. If a comment block is NOT included, but an artifact filename is included or is apparent from the conversation so far: use the humanlayer MCP `get_artifact_comments` tool to fetch the comments for the artifact and proceed. 
3. if neither a comment block nor an artifact filepath are included, you should ask the user which artifact they would like you to get the comments for, wait for their answer, and then proceed

### Note: comment block format:
1. a `<comments>...</comments>` XML block which includes an attribute with the name of the artifact that it is for
2. Then: one or more `<comment>` blocks which include the text that hte comment applies to, the comment id, and user responses.

## Workflow

1. **Read the artifact file** using the path from the first line (it will be in the task artifact directory) _if you have not read it already_
2. **Read the comment blocks** (if they are available, or after fetching them) to understand what feedback exists
3. **Ask the user how to proceed**: if the user has not given you instructions (such as "read and apply all comments" or "resolve all comments"), once you have read the artifact and the comments, you should ask the user how they would like you to proceed. You may offer contextually relevant, CONCISE recommendations - for example: 

````
I can see 4 comments on this design discussion. Would you like me to...
1. update the design discussion based on the feedback of each comment
2. update the design discussion _and_ mark the comments as resolved
3. research and investigate the issues flagged in the comments and reply to them with my findings
4. something else? 
````

## Example

Given input:
```
<comments for="design-discussion.md">
<comment id="1">
> | ## Database Schema
Alice: Should we add an index on created_at?
</comment>

<comment id="2">
> | function processData() {
Bob: This needs error handling
  Alice: Agreed, let's add try-catch
</comment>
```

You would:
1. Read `design-discussion.md` from your task's artifact directory (e.g. `.humanlayer/tasks/<task-slug>/design-discussion.md`) if you have not already
2. Fetch the artifact comments with `get_artifact_comments` if the user did not provide them (provided for this example as above, the tool will return an XML block like you see)
3. Ask the user how to proceed unless the user provided instructions already.
4. Follow the user's instructions. Offer to leave replies to comments or to resolve them based on the context. Remember that you can resolve OR delete artifacts with the `update_artifact_comments` tool, but you should not do so unless instructed to (e.g. if the user says 'resolve all the comments'). 
    - if you accidentally resolve or delete comments, and the user gets mad about it, you should un-resolve or un-delete them using the same tool. It works both ways, deletion is 'tombstoning' not permanent deletion'

## Important Notes
- You may offer to resolve, reply to or delete comments for the user, but you should only do so if they confirm or if they give you instructions to do so.
- Unless the user gives you a course of action, you MUST ask the user for clarification about how you should proceed after reading the comments. 
- Work through comments one at a time for clarity
