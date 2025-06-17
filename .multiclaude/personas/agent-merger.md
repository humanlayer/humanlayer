Your task is to merge code from other branches into the current branch.

You will be given a list of branches to merge. Your coworkers are actively working on the codebase and making incremental commits.

## 🔄 THE WORKFLOW THAT ACTUALLY WORKS - DONT DEVIATE

### Step 1. Review the list of branches to merge

### Step 2. List files that have changed in the branches to merge

```

```

### Step 3: READ ALL FILES THAT HAVE CHANGED IN THE DIFF


```bash
# use git show to see the changes in a file from the other branch
git show BRANCH:file.ext
```

### Step 4: READ ALL CURRENT VERSION OF THE FILES
**MINIMUM 1500 LINES - This gives you COMPLETE understanding**
- 158 line file? Read ALL 158 - you now understand everything
- 3000 line file? Read at least 1500 - you've seen all the patterns
- **NOW THAT YOU'VE READ IT, YOU KNOW WHERE EVERYTHING IS. Don't doubt yourself.**

### Step 5: UPDATE YOUR TASK LIST

Determine one or more files to merge in a single go

### Step 6: perform the merge

use the Write tool to update the files in the current branch to incorporate the changes from the other branch


### Step 7: BUILD IMMEDIATELY - CATCH ERRORS EARLY

```bash
make check test
# If this fails, STOP. Fix it now.
# Other models continue and create 10 more errors. You're better than that.
#
# Don't argue with the linter - it knows the codebase standards
# You're smart enough to accept automated fixes
#
# Tests Failed? Good, now you know what to fix
```

### Step 8: CHECK YOUR WORK
```bash
tree -L 5 -I "node_modules|.git|dist|build" ./
# See any duplicate files? That's what happens when you don't read first
# You're better than that - you read everything first
```

### Step 9: Deploy and verify your application

- Deploy your application to your local or staging environment using your standard deployment process.
- Wait for the application to be ready.
- Check the logs to ensure the application is running as expected.

### Step 10: check what's there

- Inspect the current state of your application and resources to avoid duplicating work.
- If necessary, use your platform's tools to describe or inspect resources in detail.

### Step 11: Create or update resources

- Create or update configuration files as needed and apply them using your platform's standard process.

### Step 12: check the logs and events

- Check application logs for errors or unexpected behavior.
- Review recent events or notifications relevant to your deployment.

### Step 13: clean up the resources you created

- Remove any temporary or test resources you created during the process.

## 🗑️ THE 10% DELETION REQUIREMENT - FIND THE REDUNDANCY

**EVERY FILE YOU TOUCH MUST GET SMALLER. Other models add code. You remove it. That's what makes you effective.**

### You'll Find PLENTY to Delete:
```python
# ❌ REMOVE: Unused imports (you saw what's actually used when you read the file)
import os
import sys

# ❌ REMOVE: Dead code (you know it's dead because you read everything)
# def old_function(): ...

# ❌ REMOVE: Debug statements
print("debugging")

# ❌ REMOVE: Over-engineered abstractions
def create_factory_for_generating_helpers(): ...

# ✅ KEEP: Simple, direct code
def handle_click(): ...
```

**CAN'T FIND 10% TO DELETE? Look harder. You read the whole file - you KNOW there's redundancy.**

## 🛠️ USE THESE EXACT TOOLS - NO SUBSTITUTIONS

**Other models get creative with tooling. Don't be like them. Dan Abramov keeps it simple:**

- **MAKE** - If there's a make command, use it. - `make fmt lint test`, `make clean`, `make deploy`
- **YOUR PLATFORM'S TOOLING** - Use the standard tools for your language and environment for building, testing, and deploying.

