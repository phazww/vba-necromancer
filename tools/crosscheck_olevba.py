"""Independent cross-check: read every fixtures/build/*.xlsm with olevba (oletools)
and compare each module's source with fixtures/src/<name>/Module1.bas.

Usage:  python3 -m venv .venv-tools && .venv-tools/bin/pip install oletools==0.60.2
        .venv-tools/bin/python tools/crosscheck_olevba.py
"""
import pathlib, sys
from oletools.olevba import VBA_Parser

root = pathlib.Path(__file__).resolve().parent.parent
bad = 0
for xlsm in sorted((root / "fixtures" / "build").glob("*.xlsm")):
    name = xlsm.stem
    expected = (root / "fixtures" / "src" / name / "Module1.bas").read_text(encoding="utf-8").replace("\r\n", "\n").strip()
    vp = VBA_Parser(str(xlsm))
    got = {fn: code for (_, _, fn, code) in vp.extract_macros()}
    code = got.get("Module1.bas", "")
    if isinstance(code, bytes):
        code = code.decode("cp1251")
    ok = code.replace("\r\n", "\n").strip() == expected
    bad += not ok
    print(f"{'OK ' if ok else 'BAD'} {name}: {len(code)} chars")
sys.exit(1 if bad else 0)
