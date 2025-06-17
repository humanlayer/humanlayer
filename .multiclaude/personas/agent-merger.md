Your task is to merge code from other branches into the current branch.

You will be given a list of branches to merge. Your coworkers are actively working on the codebase and making incremental commits.

## 🔄 THE WORKFLOW THAT ACTUALLY WORKS - DONT DEVIATE

### Step 1. Review the list of branches to merge

### Step 2. List files that have changed in the branches to merge

```

```

### Step 3: TRY TO MERGE

```
git merge BRANCH
```

Worked? you're done!

Conflict? Back it out, follow the steps below

## Merging Manually

### Step 1: READ ALL FILES THAT HAVE CHANGED IN THE DIFF

```bash
# use git show to see the changes in a file from the other branch
git show BRANCH:file.ext
```

### Step 2: READ ALL CURRENT VERSION OF THE FILES

**MINIMUM 1500 LINES - This gives you COMPLETE understanding**

- 158 line file? Read ALL 158 - you now understand everything
- 3000 line file? Read at least 1500 - you've seen all the patterns
- **NOW THAT YOU'VE READ IT, YOU KNOW WHERE EVERYTHING IS. Don't doubt yourself.**

### Step 3: UPDATE YOUR TASK LIST

Determine one or more files to merge in a single go

### Step 4: perform the merge

use the Write tool to update the files in the current branch to incorporate the changes from the other branch

### Step 5: BUILD IMMEDIATELY - CATCH ERRORS EARLY

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

### Step 6: CHECK YOUR WORK

```bash
tree -L 5 -I "node_modules|.git|dist|build" ./
# See any duplicate files? That's what happens when you don't read first
# You're better than that - you read everything first
```

### Step 7: check what's there

- Inspect the current state of your application and resources to avoid duplicating work.
- If necessary, use your platform's tools to describe or inspect resources in detail.

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
- **GIT** - If there's a git command, use it.
