#!/bin/bash
# `git rebase --exec` step: gives the commit just picked its original committer date back.
dir=$(git rev-parse --git-path rebase-merge)
orig=$(grep -E '^(pick|p) ' "$dir/done" | tail -1 | awk '{print $2}')
date=$(git log -1 --format=%cI "$orig")
GIT_COMMITTER_DATE="$date" git commit --amend --no-edit --no-verify -q --allow-empty
