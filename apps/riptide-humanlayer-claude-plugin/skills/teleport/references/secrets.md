# Move secret files to the new host

Git does not carry `.env` files, local settings, or keys. Find the ones the task needs, ask the user once, then copy the files straight from this host to the new one.

Never print a secret value. Never send one through chat, a session prompt, `handoff.md`, a commit, a command-line argument, or `teleport.json`. Show file paths and key names only.

## 1. Find candidates

Collect paths relative to the repository root:

1. Project copy files, if the task has a workspace ID. The daemon copies these from the repository source into every new worktree:

    ```bash
    humanlayer api projects v2 get --project-id <project-id> > /tmp/hl-project.json
    jq -r '.project.repositories[] | [.repositoryIdentity, (.copyGlobs | join(" "))] | @tsv' /tmp/hl-project.json
    ```

2. Ignored files in this checkout that look like secrets or local settings:

    ```bash
    git ls-files --others --ignored --exclude-standard --directory \
      | grep -E '(^|/)\.env($|\.)|\.local\.|(^|/)\.dev\.vars$|credentials|secrets?\.|\.pem$|\.key$|\.p12$'
    ```

3. Whatever `teleport.json` lists under `secretFiles`.

Drop example and template files (`.env.example`, `.env.sample`, `.env.template`); git already carries them.

For each `.env`-style file, list its key names with this script. It prints names only and skips the lines of quoted multi-line values such as private keys. Do not use `cut -d= -f1`: it prints the body of a multi-line value.

```bash
awk '
  open != "" { if (index($0, open)) open = ""; next }
  /^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=/ {
    line = $0
    sub(/^[[:space:]]*(export[[:space:]]+)?/, "", line)
    key = line; sub(/[[:space:]]*=.*/, "", key)
    val = line; sub(/^[^=]*=[[:space:]]*/, "", val)
    q = substr(val, 1, 1)
    if ((q == "\"" || q == "\047") && index(substr(val, 2), q) == 0) open = q
    print key
  }' <file>
```

To tell which keys the code reads, compare these names against `.env.example` and a search of the code for `process.env.`, `import.meta.env.`, `Bun.env.`, `os.environ`, and `env::var`.

## 2. Ask once

Add one item to the step 1 question. For each file, show:

- the path, its key count, and whether it already exists on the new host (compare names only, or `sha256sum` on both hosts)
- keys that look tied to this machine or to production: `*_PROD*`, `LIVE`, `localhost` origins, absolute paths under the home directory. Name the key; never show the value.
- your advice: copy, skip, or ask

Recommend copying every project copy file that exists here. Recommend skipping files the task does not touch. Ask before replacing a file that exists on the new host with different contents.

If a file the task needs is not in the project's copy files, say so: new worktrees on that host will not get it. Offer to add it in the project's settings, since that change affects everyone on the project.

## 3. Copy

Copy each chosen file with the host's file-transfer tool, not by pasting its contents. Set the file mode to `600`.

```bash
# SSH or Tailscale
ssh <host> 'mkdir -p "$(dirname <remote-path>)"'
scp -p <local-path> <host>:<remote-path>
ssh <host> 'chmod 600 <remote-path>'

# Freestyle
freestyle vm scp <local-path> <vm>:<remote-path>
freestyle vm exec <vm> -- chmod 600 <remote-path>
```

Where each file goes on the new host:

- No workspace ID: the same relative path inside the clone from step 4.6.
- Workspace ID with a `filesystem` source: the same relative path inside that checkout.
- Workspace ID with a `managed_clone` source: the same relative path inside the managed clone, `~/.humanlayer/repos/<repository-identity in lowercase>/.repository/`. Read the exact path from `.status.sourcePath` in `project-workspaces get-status` once setup has run. Each new worktree gets the copy files from there.

Do not create the managed clone's `.repository` directory yourself. The daemon moves its finished clone into that path, and a directory already there makes the clone fail. If the clone does not exist yet, launch the session first. Once setup shows the worktree path, copy the files into both the managed clone and that worktree.

## 4. Check

On the new host, run the key-name script on each copied file and compare the names with this host's list. Report each file as copied, skipped, or failed, with names only.
