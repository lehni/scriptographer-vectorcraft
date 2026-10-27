"""Resolves conflicts in the .tsv translation tables: both sides' rows."""
import re, subprocess

conflicted = subprocess.run(["git", "diff", "--name-only", "--diff-filter=U"], capture_output=True, text=True).stdout.split()
for path in conflicted:
    if not path.endswith(".tsv"):
        continue
    text = open(path).read()
    text = re.sub(r"<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n", lambda m: m.group(1) + m.group(2), text, flags=re.S)
    open(path, "w").write(text)
    subprocess.run(["git", "add", path])
