"""Re-applies a commit's hunks of a file to upstream's sources, where upstream may have moved the
code (split a file into modules, moved inline tests into a file): each hunk goes to the one file
under <search dir> that holds its old lines exactly once.

Usage: hunkmove.py <commit | edited diff file> <file> <search dir>
Exits 1, changing nothing, when a hunk matches no place or more than one."""
import os, re, subprocess, sys

source, path, folder = sys.argv[1:4]
if os.path.isfile(source):
    diff = open(source).read()
else:
    diff = subprocess.run(["git", "show", "--format=", "-U3", source, "--", path], capture_output=True, text=True, check=True).stdout

hunks = []
for line in diff.splitlines():
    if line.startswith("@@"):
        hunks.append([])
    elif hunks and line[:1] in (" ", "-", "+"):
        hunks[-1].append(line)

files = {os.path.join(r, f): open(os.path.join(r, f)).read() for r, _, fs in os.walk(folder) for f in sorted(fs) if f.endswith(".rs")}
root = next((p for p in (os.path.join(folder, "lib.rs"), os.path.join(folder, "main.rs")) if p in files), None)
TESTS = "#[cfg(test)]\nmod tests;\n"

def place(before, after, lead, trail):
    """The file and old/new text of the least trimmed context that matches exactly once. A pure
    insertion keeps at least one line of context."""
    pairs = sorted(((a, b) for a in range(lead + 1) for b in range(trail + 1)), key=lambda p: (p[0] + p[1], p))
    for a, b in pairs:
        old = before[a:len(before) - b]
        if not any(l.strip() for l in old):
            continue
        old_text = "\n".join(old) + "\n"
        hits = [(p, t.count(old_text)) for p, t in files.items() if old_text in t]
        if len(hits) == 1 and hits[0][1] == 1:
            return hits[0][0], old_text, "\n".join(after[a:len(after) - b]) + "\n"
    return None

changed = set()
edits = []
for h in hunks:
    added = [l[1:].strip() for l in h if l[0] in "+-"]
    # Registering a tests_* module: upstream keeps tests in tests/, so it goes next to `mod tests;`.
    if added and all(l[0] != "-" for l in h) and all(re.fullmatch(r"#\[cfg\(test\)\]|mod tests_\w+;|", l) for l in added):
        for name in (m.group(1) for m in map(lambda l: re.fullmatch(r"mod (tests_\w+);", l), added) if m):
            if not root or TESTS not in files[root]:
                sys.exit(f"no `mod tests;` to register {name} next to")
            if f"mod {name};" not in files[root]:
                files[root] = files[root].replace(TESTS, TESTS + f"#[cfg(test)]\nmod {name};\n", 1)
                changed.add(root)
        continue
    before = [l[1:] for l in h if l[0] in " -"]
    after = [l[1:] for l in h if l[0] in " +"]
    lead = next((i for i, l in enumerate(h) if l[0] != " "), len(h))
    trail = next((i for i, l in enumerate(reversed(h)) if l[0] != " "), len(h))
    found = place(before, after, lead, trail)
    if not found:
        # Inline `mod tests { … }` moved into a file of its own: one indent level less.
        dedent = lambda ls: [l[4:] if l.startswith("    ") else l for l in ls]
        found = place(dedent(before), dedent(after), lead, trail)
    if not found:
        sys.exit("no place for hunk:\n" + "\n".join(h))
    edits.append(found)

for p, old, new in edits:
    files[p] = files[p].replace(old, new, 1)
    changed.add(p)
for p in sorted(changed):
    open(p, "w").write(files[p])
    print("changed", p)
