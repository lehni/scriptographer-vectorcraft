"""Resolves conflicts in the docs' status lines and revision rows: upstream's, with the commit's own
item or rows added. Leaves any other conflict in a doc as it is."""
import re, subprocess

def is_rows(text):
    return text and all(re.match(r"\| 20\d\d-", l) for l in text.splitlines())

def resolve(m):
    # In a rebase, the first side is upstream's and the second the commit's.
    upstream, commit = m.group(1), m.group(2)
    # Revision history rows: the commit's, then upstream's.
    if is_rows(upstream) and is_rows(commit):
        return commit + "".join(l for l in upstream.splitlines(True) if l not in commit)
    # One status line each side: upstream's, with the commit's change item first.
    if not (upstream.startswith("> **") and commit.startswith("> **") and upstream.count("\n") == 1 and commit.count("\n") == 1):
        return m.group(0)
    item = re.search(r"\*\*Change:\*\* (?:minor|major|patch) \((.*?);", commit)
    if not item:
        return m.group(0)
    if item.group(1) in upstream:
        return upstream
    return re.sub(r"(\*\*Change:\*\* (?:minor|major|patch) \()", lambda x: x.group(1) + item.group(1) + "; ", upstream, count=1)

conflicted = subprocess.run(["git", "diff", "--name-only", "--diff-filter=U"], capture_output=True, text=True).stdout.split()
for path in conflicted:
    if not path.endswith(".md"):
        continue
    text = open(path).read()
    resolved = re.sub(r"<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n", resolve, text, flags=re.S)
    if resolved != text:
        open(path, "w").write(resolved)
        if "<<<<<<<" not in resolved:
            subprocess.run(["git", "add", path])
