"""Insert `futureradius_check_simultaneous_use` after the first `sql` line in `authorize { }`."""
from __future__ import annotations

import sys
from pathlib import Path


def inject(site_path: Path) -> bool:
    text = site_path.read_text(encoding="utf-8")
    if "futureradius_check_simultaneous_use" in text:
        return False
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    i = 0
    inserted = False
    while i < len(lines):
        line = lines[i]
        ls = line.strip()
        if ls.startswith("authorize") and "{" in line:
            out.append(line)
            i += 1
            depth = 1
            block_inserted = False
            while i < len(lines) and depth > 0:
                inner = lines[i]
                if (
                    not block_inserted
                    and depth == 1
                    and inner.strip() == "sql"
                ):
                    out.append(inner)
                    out.append("\tfutureradius_check_simultaneous_use\n")
                    block_inserted = True
                    inserted = True
                else:
                    out.append(inner)
                depth += inner.count("{") - inner.count("}")
                i += 1
            if not block_inserted:
                print(f"[inject] warn: no `sql` line in authorize block: {site_path}", file=sys.stderr)
            continue
        out.append(line)
        i += 1
    if not inserted:
        print(f"[inject] error: authorize/sql not found in {site_path}", file=sys.stderr)
        return False
    site_path.write_text("".join(out), encoding="utf-8")
    return True


def main() -> None:
    for arg in sys.argv[1:]:
        p = Path(arg)
        if p.is_file():
            inject(p)


if __name__ == "__main__":
    main()
