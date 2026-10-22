# Manage task artifacts and files

Artifacts are the files in a task's `.humanlayer/tasks/<slug>/` folder. `storageType` is `postgres` for text and `s3` for binary files. Find task IDs with [list-tasks.md](list-tasks.md).

## List

```bash
humanlayer --dev api artifacts list --task-id <task id> > /tmp/hl-artifacts.json
jq -r '.artifacts[] | [.fileName, .storageType, .fileSizeBytes] | @tsv' /tmp/hl-artifacts.json
```

`artifacts list` returns no IDs. To delete, you need the ID from the sync metadata:

```bash
humanlayer --dev api sync artifacts-metadata --task-id <task id> > /tmp/hl-artifact-meta.json
jq -r '.rows[] | select(.is_deleted | not) | [.id, .file_name] | @tsv' /tmp/hl-artifact-meta.json
```

## Upload a file from disk

The file name can include folders, for example `uploads/notes.md`. Check the type with `file --brief --mime-type "<path>"`.

Text:

```bash
content="$(cat "<path>"; printf x)"; content="${content%x}"
humanlayer --dev api artifacts upsert --task-id <task id> --file-name "<file name>" --content "$content"
```

Binary, or text over about 1 MB, which is too long for one command-line argument:

```bash
f="<path>"
size=$(wc -c < "$f" | tr -d ' ')
hash=$(shasum -a 256 "$f" | cut -d' ' -f1)
type=$(file --brief --mime-type "$f")
humanlayer --dev api artifacts create-upload --task-id <task id> --file-name "<file name>" \
  --content-type "$type" --content-hash "$hash" --file-size-bytes "$size" > /tmp/hl-upload.json
curl -sS -f -X PUT -H "Content-Type: $type" --data-binary @"$f" "$(jq -r .uploadUrl /tmp/hl-upload.json)"
```

- The `printf x` keeps trailing newlines, which `$(...)` would drop.
- `upsert` replaces an artifact with the same name and keeps the old one as a version. Its output says `"created": false` when it replaced one.
- The `Content-Type` header must match `--content-type`.

## Copy to another task

Text: read the content, then upsert it into the other task.

```bash
humanlayer --dev api artifacts get --task-id <from task id> --file-name "<file name>" > /tmp/hl-artifact.json
content="$(jq -j .content /tmp/hl-artifact.json; printf x)"; content="${content%x}"
humanlayer --dev api artifacts upsert --task-id <to task id> --file-name "<file name>" --content "$content"
```

Binary: `get` returns a `downloadUrl` instead of `content`. Download the file, then upload it as a binary file above.

```bash
humanlayer --dev api artifacts get --task-id <from task id> --file-name "<file name>" > /tmp/hl-artifact.json
curl -sS -f -o /tmp/hl-artifact-file "$(jq -r .downloadUrl /tmp/hl-artifact.json)"
```

## Move to another task

Copy it, check the hashes match, then delete the original:

```bash
humanlayer --dev api artifacts update-deletion-status --artifact-id <artifact id> --is-deleted true
```

Deleting also removes the file from the task's folder on every host. To undo, run the same command with `--is-deleted false`.

## Check

```bash
humanlayer --dev api artifacts get --task-id <task id> --file-name "<file name>" | jq -r '.storageType, .contentHash'
```

A copy's `contentHash` matches the source's. For a binary upload, it equals the SHA-256 `$hash`.
