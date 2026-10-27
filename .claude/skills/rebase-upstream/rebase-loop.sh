#!/bin/bash
# Continues a rebase while every conflict is one of the routine ones (see SKILL.md); prints
# `STOP: …` and exits on anything else. Usage: rebase-loop.sh <log file>
here=$(cd "$(dirname "$0")" && pwd)
export CARGO_TARGET_DIR=${CARGO_TARGET_DIR:-$(git worktree list --porcelain | sed -n '1s/^worktree //p')/target}
crate_src() { echo "$1" | sed -E 's#^((crates|apps)/[^/]+/src)/.*#\1#'; }
while [ -d "$(git rev-parse --git-path rebase-merge)" ]; do
  python3 -I "$here/docstatus.py"
  conflicts=$(git diff --name-only --diff-filter=U)
  # Rust files: upstream's version of every conflicted one first (so staging a crate stages no
  # markers), then the commit's own hunks wherever upstream has their old lines now.
  rs=$(echo "$conflicts" | grep '\.rs$')
  for f in $rs; do git checkout --ours "$f" || { echo "STOP: $f"; exit 1; }; done
  for f in $rs; do
    python3 -I "$here/hunkmove.py" REBASE_HEAD "$f" "$(crate_src "$f")" || { echo "STOP: hunk of $f"; exit 1; }
  done
  for f in $rs; do git add "$(crate_src "$f")"; done
  conflicts=$(git diff --name-only --diff-filter=U)
  other=$(echo "$conflicts" | grep -v '^Cargo.lock$' | grep -v '\.tsv$')
  if [ -n "$other" ]; then
    echo "STOP: $conflicts"; exit 1
  fi
  python3 -I "$here/tsvunion.py"
  if echo "$conflicts" | grep -q '^Cargo.lock$'; then
    git checkout --ours Cargo.lock
    cargo update --workspace --offline </dev/null >/dev/null 2>&1 || cargo update --workspace </dev/null >/dev/null 2>&1 || { echo "STOP: Cargo.lock"; exit 1; }
    git add Cargo.lock
  fi
  if git diff --cached --name-only | xargs -I{} grep -l '^<<<<<<< \|^>>>>>>> ' {} 2>/dev/null | grep -q .; then
    echo "STOP: conflict markers staged"; exit 1
  fi
  GIT_EDITOR=true git -c rerere.enabled=false rebase --continue >>"$1" 2>&1 || true
done
echo DONE
