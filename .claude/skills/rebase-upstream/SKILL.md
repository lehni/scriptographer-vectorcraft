---
name: rebase-upstream
description: Rebase a long-lived branch (e.g. feature/scriptographer) onto storytold's main, keeping every commit's dates, resolving the routine conflicts automatically and moving hunks into files upstream split out. Use when asked to rebase onto upstream main.
---

# Rebase onto upstream main

For a branch with hundreds of commits on top of `upstream/main` (storytold/vectorcraft). The
scripts here resolve the conflicts that repeat in every rebase and stop on everything else.

## Rules

- Rebase in a fresh worktree, never in the main checkout, and move the checkout only at the end.
- Keep each commit's author and committer date.
- Never resolve a whole file with `checkout --ours`/`--theirs` by hand: the other side's changes to
  the rest of it are lost. (`rebase-loop.sh` takes upstream's version only to re-apply the commit's
  own hunks to it, see below.)
- Use one target dir (`CARGO_TARGET_DIR`, default the main checkout's `target`), wait until no
  other cargo runs before tests, and never run `cargo xtask ci` locally (it fills the disk).
- Pushing is the user's: they force-push themselves, with a lease on the remote's current tip.

## Steps

1. **Prepare.** `git fetch upstream`. Save the commits' dates for the check in step 5:
   `git log --format='%ad|%cd|%s' --date=iso-strict upstream/main..HEAD > old-dates.txt`.
   Count upstream's new commits from the previous base, not from the last rebase.
2. **Rebase in a worktree.**
   ```sh
   git worktree add .claude/worktrees/rebase -b rebase/branch HEAD
   cd .claude/worktrees/rebase
   SKILL=../../skills/rebase-upstream   # or the absolute path
   git -c rerere.enabled=false rebase --exec "$SKILL/keepdate.sh" upstream/main > rebase.log 2>&1
   bash "$SKILL/rebase-loop.sh" rebase.log
   ```
   `rebase-loop.sh` continues while every conflict is one it resolves:
   - **`Cargo.lock`:** upstream's, completed by `cargo update --workspace --offline`.
   - **`.tsv` translation tables:** both sides' rows (`tsvunion.py`).
   - **Docs' status lines and revision rows:** upstream's line with the commit's own item added
     (`docstatus.py`).
   - **Rust files:** upstream's version of every conflicted file, then the commit's own hunks of each
     re-applied where upstream now has their old lines, in any file of that crate (`hunkmove.py`).
     This is what carries a commit across upstream splitting a big file into modules. Test modules
     (`mod tests_x;`) are registered next to the crate's `mod tests;`.

   It prints `STOP: …` on anything else. Resolve that hunk by hand, `git add`, run the loop again.
   When a hunk's context changed upstream (say `fn x` became `pub(crate) fn x`), edit the commit's
   diff (`git show --format= -U3 REBASE_HEAD -- <file> > edited.diff`) and pass the file instead
   of the commit: `python3 "$SKILL/hunkmove.py" edited.diff <file> crates/<crate>/src`.
3. **Make it compile.** `cargo check --workspace --all-targets`, then `cargo xtask wasm`, since
   wasm-only items don't show natively. A split usually needs re-exports or wider visibility
   (`pub use`, `pub(crate)`) that upstream's version didn't. Fix them at the tip and run `cargo fmt`.
4. **Fold each fix into the commit that needed it,** so every commit stays whole:
   - Record the fixed tree: `git add -A && git write-tree`, then `git reset --hard HEAD`.
   - Write a tree-filter script whose rules each apply only once their cause is in the commit (the
     function exists, the call is there). Run
     `git filter-branch --tree-filter "python3 -I fix.py" upstream/main..HEAD`, which keeps dates.
   - `HEAD^{tree}` must equal the recorded tree.
5. **Check.**
   - Dates: `git log --format='%ad|%cd|%s' --date=iso-strict upstream/main..HEAD | diff - old-dates.txt` is empty.
   - No markers: `git log -G'^(<<<<<<<|>>>>>>>) ' upstream/main..HEAD` lists nothing.
   - `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, the tests of
     the crates the moved code is in, and `cargo xtask wasm`. Read the whole output.
   - Run the release app and try what upstream changed (docking, input). Ask before posting real
     mouse or keyboard events: the user is using the computer.
6. **Hand over.** Move the main checkout with `git reset --keep <new tip>` (save any uncommitted
   change as a patch first; never `git stash`), remove the worktree and its branch, look up the
   lease (`git ls-remote origin <branch>`), and give the user the push command:
   `git push --force-with-lease=<branch>:<old remote tip> origin <branch>`.

## Notes

- `keepdate.sh` restores the committer date of the commit just picked. After a `drop` line in the
  todo list it reads the wrong commit: check dates (step 5) when commits were dropped.
- `rerere` stays off for the rebase: a recorded resolution would apply without the loop seeing
  the conflict.
- The shared target dir grows large. `target/debug/incremental` is a cache that's safe to delete
  while no cargo runs.
