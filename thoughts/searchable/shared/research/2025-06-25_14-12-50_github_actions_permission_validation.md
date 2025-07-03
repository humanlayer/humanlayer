# GitHub Actions User Permission Validation Methods

## Overview
This document outlines the various methods available for validating user permissions and organization membership in GitHub Actions workflows.

## Key Context Variables

### 1. `github.actor`
- The user who triggered the workflow
- Available in all workflow contexts
- Example: `${{ github.actor }}`

### 2. `github.event.sender`
- The user who sent the webhook event
- Contains additional user information:
  - `github.event.sender.id` - User ID
  - `github.event.sender.login` - Username
- Example: `${{ github.event.sender.login }}`

### 3. `github.triggering_actor`
- The user who triggered the workflow run
- Useful for re-runs: captures who re-ran the workflow vs who originally triggered it
- Preferred over `github.actor` when checking permissions on re-runs

## Author Association Values

### For Pull Requests: `github.event.pull_request.author_association`
### For Issue Comments: `github.event.comment.author_association`

Possible values:
- **OWNER**: Author owns the repository (only for user-owned repos, not org repos)
- **MEMBER**: Author is a member of the organization that owns the repository
- **COLLABORATOR**: Author has been invited to collaborate on the repository
- **CONTRIBUTOR**: Author has previously committed to the repository
- **FIRST_TIMER**: Author has never contributed to any GitHub repository
- **FIRST_TIME_CONTRIBUTOR**: Author has never contributed to this repository
- **MANNEQUIN**: Placeholder for an unclaimed user
- **NONE**: Author has no association with the repository

### Important Notes:
- In organization-owned repositories, organization owners will show as `MEMBER`, not `OWNER`
- External collaborators always show as `COLLABORATOR` regardless of permission level
- `MEMBER` status is independent of repository permissions

## Conditional Job Execution Examples

### 1. Basic Permission Check
```yaml
jobs:
  restricted-job:
    if: |
      github.event.comment.author_association == 'OWNER' || 
      github.event.comment.author_association == 'MEMBER'
    runs-on: ubuntu-latest
    steps:
      - name: Execute restricted action
        run: echo "Authorized user action"
```

### 2. Exclude Non-Contributors
```yaml
jobs:
  review-job:
    if: |
      github.event.pull_request.author_association != 'NONE' &&
      github.event.pull_request.author_association != 'FIRST_TIME_CONTRIBUTOR'
    runs-on: ubuntu-latest
```

### 3. Multiple Event Types
```yaml
jobs:
  process-comment:
    if: |
      (github.event_name == 'issue_comment' && 
       (github.event.comment.author_association == 'MEMBER' || 
        github.event.comment.author_association == 'OWNER')) ||
      (github.event_name == 'pull_request_review_comment' && 
       github.event.comment.author_association == 'MEMBER')
    runs-on: ubuntu-latest
```

## API-Based Permission Checking

### Repository Collaborator Permission Endpoint
```yaml
- name: Check user permissions via API
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    PERMISSION=$(gh api repos/${{ github.repository }}/collaborators/${{ github.actor }}/permission --jq '.permission')
    if [[ "$PERMISSION" != "write" && "$PERMISSION" != "admin" ]]; then
      echo "User does not have write access"
      exit 1
    fi
```

Permission levels returned: `none`, `read`, `write`, `admin`

### Organization Membership Check
```yaml
- name: Check organization membership
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
      -H "Authorization: token $GH_TOKEN" \
      "https://api.github.com/orgs/${{ github.repository_owner }}/members/${{ github.actor }}")
    
    if [[ "$HTTP_CODE" == "204" ]]; then
      echo "User is an organization member"
    else
      echo "User is not an organization member"
      exit 1
    fi
```

## Workflow Dispatch Permissions

For `workflow_dispatch` events:
- Users need at least **write** permission to trigger workflows manually
- Check permissions using:
  ```yaml
  if: |
    github.event_name == 'workflow_dispatch' &&
    contains('["user1", "user2", "org-team"]', github.actor)
  ```

## Fork Pull Request Permissions

### Repository Settings
1. **Require approval for fork PRs from contributors**
   - PRs from non-write users require approval
   - Configurable in repository settings

2. **Send write tokens to workflows from pull requests**
   - Allows fork PRs to have write permissions
   - Security risk - use with caution

### Checking Fork Status
```yaml
if: |
  github.event.pull_request.head.repo.fork == false ||
  github.event.pull_request.author_association == 'MEMBER'
```

## Best Practices

### 1. Use Author Association for Quick Checks
- No API calls required
- Available in webhook payload
- Suitable for basic permission validation

### 2. Use API Endpoints for Precise Permissions
- When you need exact permission levels
- For team-based access control
- When author association is insufficient

### 3. Combine Multiple Checks
```yaml
if: |
  github.event.comment.author_association == 'MEMBER' ||
  github.event.comment.author_association == 'OWNER' ||
  github.event.comment.user.login == 'trusted-bot'
```

### 4. Handle Edge Cases
- Organization owners show as `MEMBER`
- Collaborators always show as `COLLABORATOR`
- First-time contributors might show as `NONE` initially

## Security Considerations

1. **Never rely solely on username checks** - Use author association or API verification
2. **Consider workflow token permissions** - Limit GITHUB_TOKEN permissions as needed
3. **Validate on every sensitive action** - Don't assume permissions from earlier checks
4. **Log permission checks** - Maintain audit trail for security reviews

## Example: Complete Permission Validation Workflow

```yaml
name: Secure Command Execution
on:
  issue_comment:
    types: [created]

jobs:
  validate-and-execute:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    
    steps:
      # Step 1: Quick permission check
      - name: Check author association
        if: |
          github.event.comment.author_association != 'MEMBER' &&
          github.event.comment.author_association != 'OWNER' &&
          github.event.comment.author_association != 'COLLABORATOR'
        run: |
          echo "User not authorized based on association"
          exit 1
      
      # Step 2: API-based verification for sensitive operations
      - name: Verify write permissions
        if: contains(github.event.comment.body, '/deploy')
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          PERMISSION=$(gh api repos/${{ github.repository }}/collaborators/${{ github.actor }}/permission --jq '.permission')
          if [[ "$PERMISSION" != "write" && "$PERMISSION" != "admin" ]]; then
            echo "User does not have write access for deployment"
            exit 1
          fi
      
      # Step 3: Execute command
      - name: Process command
        run: |
          echo "Executing command from ${{ github.actor }}"
          echo "Association: ${{ github.event.comment.author_association }}"
```

## Anthropic Claude Code Action Specifics

The `anthropics/claude-code-action` does not have built-in permission checks beyond standard GitHub Actions permissions. To add permission validation:

1. **Add conditional checks before the action**:
```yaml
- name: Run Claude Code
  if: |
    github.event.comment.author_association == 'MEMBER' ||
    github.event.comment.author_association == 'OWNER'
  uses: anthropics/claude-code-action@beta
```

2. **Use allowed/disallowed tools** to limit capabilities based on context
3. **Configure repository-specific permissions** in the action's GitHub App

The action runs on your infrastructure, so standard GitHub Actions permission models apply.