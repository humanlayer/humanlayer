# HOW TO ITERATE ON GITHUB ACTIONS

1. **Select a branch** to work on
2. **Add branch to workflow trigger**:
   ```yaml
   on:
     push:
       branches:
         - main
         - your-debug-branch  # Add this
   ```
3. **Make one targeted change** (e.g., cache one thing like Go dependencies)
4. **Commit and push** to the branch ON UPSTREAM `git push -u upstream your-debug-branch`
5. **Check logs** with `gh`:
   ```bash
   gh run list --workflow=main.yml
   gh run view <run-id>
   gh run watch <run-id>
   ```
6. **Repeat** until working as expected

Focus on one optimization at a time. Remove branch from triggers before merging.
