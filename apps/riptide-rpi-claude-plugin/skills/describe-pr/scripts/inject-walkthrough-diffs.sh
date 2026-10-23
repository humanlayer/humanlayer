#!/usr/bin/env bash
#
# inject-walkthrough-diffs.sh — fill a PR walkthrough's #diffs stash deterministically.
#
# The model writes the walkthrough HTML with `diffFile: "<path>"` on each file node
# and an EMPTY stash:
#
#     <div id="diffs" hidden>
#     </div>
#
# This script then reads every `diffFile:` path out of the NODES, pulls each file's
# raw hunk from `git diff` (or `gh pr diff`), and rewrites the stash so each path
# gets a `<script type="text/plain" data-diff="<path>">…</script>` block — flush-left,
# with any literal `</script>` rewritten as `<\/script>` so the renderer restores it.
#
# Why a script: the diff never has to pass through the model's context just to land
# in a file. The model decides WHICH files to inline (via diffFile); the bytes are
# injected here.
#
# Idempotent: it replaces the entire contents of <div id="diffs" hidden>…</div> each
# run, so re-running after editing nodes just refreshes the stash.
#
# Usage:
#   inject-walkthrough-diffs.sh <target.html> [base-dir] [options]
#
#   <target.html>     the walkthrough file to rewrite (edited in place)
#   [base-dir]        directory to run git/gh in — use this when the walkthrough
#                     lives in dir1 but the diff comes from ../dir2 (default: .)
#
# Options:
#   --base-dir DIR    same as the positional base-dir
#   --pr NUMBER       source the diff from `gh pr diff NUMBER` instead of git
#   --range REV       git revision range (default: main...HEAD)
#   --max-lines N     truncate any single file's hunk to N lines + an elision note
#                     (default: 0 = unlimited; use for lockfile-style files)
#   -h, --help        show this help
#
# Examples:
#   inject-walkthrough-diffs.sh pr-walkthrough.html --range main...HEAD
#   inject-walkthrough-diffs.sh pr-1527-walkthrough.html /tmp/pr1527 --pr 1527
#   inject-walkthrough-diffs.sh ../task/pr-walkthrough.html ../../humanlayer --range upstream/main...HEAD
set -euo pipefail

usage() { sed -n '2,46p' "$0" | sed 's/^# \{0,1\}//'; }

TARGET=""
BASE_DIR="."
PR=""
RANGE=""
MAX_LINES=0

while [ $# -gt 0 ]; do
  case "$1" in
    --base-dir) BASE_DIR="$2"; shift 2 ;;
    --pr)       PR="$2";       shift 2 ;;
    --range)    RANGE="$2";    shift 2 ;;
    --max-lines) MAX_LINES="$2"; shift 2 ;;
    -h|--help)  usage; exit 0 ;;
    --*)        echo "inject-walkthrough-diffs: unknown option $1" >&2; exit 2 ;;
    *)
      if [ -z "$TARGET" ]; then TARGET="$1"
      elif [ "$BASE_DIR" = "." ]; then BASE_DIR="$1"
      else echo "inject-walkthrough-diffs: unexpected argument $1" >&2; exit 2; fi
      shift ;;
  esac
done

[ -n "$TARGET" ] || { echo "inject-walkthrough-diffs: missing <target.html>" >&2; usage; exit 2; }
[ -f "$TARGET" ] || { echo "inject-walkthrough-diffs: no such file: $TARGET" >&2; exit 2; }
[ -d "$BASE_DIR" ] || { echo "inject-walkthrough-diffs: no such base-dir: $BASE_DIR" >&2; exit 2; }
grep -q '<div id="diffs"' "$TARGET" || {
  echo "inject-walkthrough-diffs: target has no <div id=\"diffs\" …> stash to fill" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
WANTED="$TMP/wanted"
RAWDIFF="$TMP/diff"
STASH="$TMP/stash"
OUT="$TMP/out.html"

# 1. Collect the file paths the model asked to inline (diffFile: "…" in the NODES).
grep -oE 'diffFile:[[:space:]]*"[^"]+"' "$TARGET" \
  | sed -E 's/^diffFile:[[:space:]]*"([^"]+)".*/\1/' \
  | sort -u > "$WANTED"
if [ ! -s "$WANTED" ]; then
  echo "inject-walkthrough-diffs: no diffFile: entries found in $TARGET — nothing to inject" >&2
  exit 0
fi

# 2. Pull the unified diff once, in the base dir.
if [ -n "$PR" ]; then
  ( cd "$BASE_DIR" && gh pr diff "$PR" ) > "$RAWDIFF"
else
  ( cd "$BASE_DIR" && git diff "${RANGE:-main...HEAD}" ) > "$RAWDIFF"
fi

# 3. Split the diff per file; emit a stash <script> block for each wanted path.
#    - key on the new-side path (`b/…`) from the `diff --git` header
#    - paste lines verbatim (flush-left); only escape a literal </script>
#    - optionally truncate to MAX_LINES with an elision note
awk -v wantedfile="$WANTED" -v maxlines="$MAX_LINES" '
  function flush(   i, n, out) {
    if (path == "" || !(path in want)) return
    seen[path] = 1
    printf "<script type=\"text/plain\" data-diff=\"%s\">\n", path
    n = nbuf
    if (maxlines > 0 && n > maxlines) n = maxlines
    for (i = 1; i <= n; i++) {
      out = buf[i]
      gsub(/<\/script>/, "<\\/script>", out)
      print out
    }
    if (maxlines > 0 && nbuf > maxlines)
      printf "@@ … %d more lines elided — see the full file in the PR ↗ @@\n", nbuf - maxlines
    print "</script>"
  }
  BEGIN { while ((getline ln < wantedfile) > 0) if (ln != "") want[ln] = 1 }
  /^diff --git / {
    flush()
    path = ""; nbuf = 0
    bi = index($0, " b/")
    if (bi > 0) path = substr($0, bi + 3)
    next
  }
  { if (path != "") buf[++nbuf] = $0 }
  END {
    flush()
    for (p in want) if (!(p in seen)) print "MISSING\t" p > "/dev/stderr"
  }
' "$RAWDIFF" > "$STASH" 2> "$TMP/missing"

# 4. Rewrite the target: replace the stash inside <div id="diffs" …> … </div>
#    with the freshly generated blocks. The injected region is wrapped in sentinel
#    comments so re-runs are idempotent even when a diff itself contains a
#    `</div>` line (common in TSX/HTML hunks) — we skip to OUR end marker, not the
#    first `</div>` we see. On a first run (no markers yet) the stash is empty, so
#    the first standalone `</div>` after the opening tag IS the real close.
HAS_MARKERS=0
grep -q 'inject-walkthrough-diffs:start' "$TARGET" && HAS_MARKERS=1
awk -v stashfile="$STASH" -v hasmarkers="$HAS_MARKERS" '
  BEGIN {
    STARTM = "<!-- inject-walkthrough-diffs:start (auto-generated — re-run the script to refresh) -->"
    ENDM   = "<!-- inject-walkthrough-diffs:end -->"
  }
  state == 0 && /<div id="diffs"/ {
    print
    print STARTM
    while ((getline ln < stashfile) > 0) print ln
    print ENDM
    state = 1; awaitclose = 0
    next
  }
  state == 1 {
    if (hasmarkers == "1") {
      if (index($0, "inject-walkthrough-diffs:end") > 0) { awaitclose = 1; next }
      if (awaitclose == 1 && $0 ~ /^[[:space:]]*<\/div>[[:space:]]*$/) { print; state = 0 }
      next
    }
    if ($0 ~ /^[[:space:]]*<\/div>[[:space:]]*$/) { print; state = 0 }
    next
  }
  { print }
' "$TARGET" > "$OUT"

cp "$OUT" "$TARGET"

# 5. Report.
INJECTED="$(grep -c 'data-diff=' "$STASH" || true)"
WANT_N="$(wc -l < "$WANTED" | tr -d ' ')"
echo "inject-walkthrough-diffs: injected $INJECTED/$WANT_N file diffs into $TARGET"
if [ -s "$TMP/missing" ]; then
  echo "  warning: no diff found for these diffFile paths (typo, or unchanged in range):" >&2
  sed 's/^MISSING\t/    - /' "$TMP/missing" >&2
fi
