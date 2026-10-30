"""Prove a refactored skill script still does what the old one did.

Runs the OLD and the NEW version of a script on the same input, each with its
CONFIG constants overridden, and compares the files they write: images pixel
for pixel (Pillow), anything else byte for byte. Neither script is edited; each
runs from a patched copy in --work.

  python -I compare-script-versions.py \
    --old ~/.claude/plugins/cache/<mkt>/<plugin>/<ver>/skills/<s>/templates/x.py \
    --new <marketplace>/plugins/<plugin>/skills/<s>/templates/x.py \
    --set "SRC='D:/site/static/images/logo.webp'" \
    --set-old "FONTS='D:/site/static/fonts/'" --set-old "DST='{work}/old.webp'" \
    --set-new "FONT='D:/site/static/fonts/face.woff2'" --set-new "DST='{work}/new.webp'" \
    --compare "{work}/old.webp" "{work}/new.webp" --work <scratch dir>

--set applies to both copies, --set-old / --set-new to one. Each is
"NAME=<python source>" and replaces the line that assigns NAME (a tuple
target such as "BEFORE, AFTER" works). {work} expands to --work.
Ends with: old_exit= new_exit= set_missing= output_equal= diff=
"""

import argparse
import os
import re
import subprocess
import sys


def patch(src, sets, work):
    text = open(src, encoding='utf-8').read()
    missing = []
    for item in sets:
        key, _, value = item.partition('=')
        key = key.strip()
        pat = re.compile(r'^' + re.escape(key) + r'\s*=(?!=).*$', re.M)
        line = f"{key} = {value.replace('{work}', work)}"
        text, n = pat.subn(lambda _: line, text, count=1)
        if n == 0:
            missing.append(key)
    return text, missing


def run(label, src, sets, work):
    text, missing = patch(src, sets, work)
    path = os.path.join(work, f'{label}-run.py')
    open(path, 'w', encoding='utf-8').write(text)
    r = subprocess.run([sys.executable, '-I', path], capture_output=True, text=True)
    print(f'== {label}: {src}')
    print(r.stdout.rstrip() or '(no output)')
    if r.returncode:
        print(r.stderr.rstrip()[-2000:])
    return r.returncode, missing


def compare(a, b):
    if not (os.path.isfile(a) and os.path.isfile(b)):
        return False, 'missing-output'
    try:
        from PIL import Image, ImageChops
        ia, ib = Image.open(a), Image.open(b)
        if ia.size != ib.size:
            return False, f'size {ia.size} vs {ib.size}'
        box = ImageChops.difference(ia.convert('RGBA'), ib.convert('RGBA')).getbbox()
        return box is None, 'pixels-identical' if box is None else f'pixels-differ-in {box}'
    except Exception:
        same = open(a, 'rb').read() == open(b, 'rb').read()
        return same, 'bytes-identical' if same else 'bytes-differ'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--old', required=True)
    ap.add_argument('--new', required=True)
    ap.add_argument('--set', action='append', default=[])
    ap.add_argument('--set-old', action='append', default=[])
    ap.add_argument('--set-new', action='append', default=[])
    ap.add_argument('--compare', nargs=2, required=True, metavar=('OLD_OUT', 'NEW_OUT'))
    ap.add_argument('--work', required=True)
    a = ap.parse_args()
    work = os.path.abspath(os.path.expanduser(a.work)).replace('\\', '/')
    os.makedirs(work, exist_ok=True)
    old_exit, old_missing = run('old', os.path.expanduser(a.old), a.set + a.set_old, work)
    new_exit, new_missing = run('new', os.path.expanduser(a.new), a.set + a.set_new, work)
    outs = [p.replace('{work}', work) for p in a.compare]
    equal, diff = compare(*outs)
    missing = ','.join(sorted(set(f'old:{k}' for k in old_missing) | set(f'new:{k}' for k in new_missing))) or 'none'
    print(f'old_exit={old_exit} new_exit={new_exit} set_missing={missing} output_equal={equal} diff={diff}')
    sys.exit(0 if equal and not old_exit and not new_exit and missing == 'none' else 1)


if __name__ == '__main__':
    main()
