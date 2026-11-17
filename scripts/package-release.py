#!/usr/bin/env python3
"""Package an explicit allowlist of runtime files; never archive a working directory."""

import argparse
import gzip
import hashlib
import io
import os
from pathlib import Path
import platform
import re
import struct
import tarfile


ROOT = Path(__file__).resolve().parents[1]
FILES = (
    "README.md", "LICENSE", "SECURITY.md", "CHANGELOG.md", "CONTRIBUTING.md", "PROTOCOL.md", "UI.md",
    "docs/installation.md", "docs/usage.md", "docs/troubleshooting.md",
    "docs/architecture.md", "docs/releasing.md", "docs/images/phone.png", "docs/images/thumb-zones.svg",
    "scripts/install-desktop.py", "scripts/setup-linux.sh",
    "scripts/allow-phone.sh", "scripts/doctor.py",
    "packaging/ghostpad.desktop", "packaging/70-ghostpad-uinput.rules",
    "packaging/ghostpad-uinput.conf", "web/icon.svg", "web/icon.png",
)
TARGETS = {"x86_64-unknown-linux-gnu": 62, "aarch64-unknown-linux-gnu": 183}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    machine = {"x86_64": "x86_64", "aarch64": "aarch64", "arm64": "aarch64"}.get(platform.machine())
    parser.add_argument("--target", choices=TARGETS, default=f"{machine}-unknown-linux-gnu")
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    if args.target not in TARGETS:
        parser.error("Specify a supported --target for this release binary.")
    binary = args.binary.read_bytes()
    if (len(binary) < 64 or binary[:6] != b"\x7fELF\x02\x01"
            or struct.unpack_from("<H", binary, 18)[0] != TARGETS[args.target]):
        parser.error("Binary must be a 64-bit little-endian Linux ELF matching --target.")
    version = re.search(r'^version\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+)"',
                        (ROOT / "Cargo.toml").read_text(), re.MULTILINE).group(1)
    name = f"ghostpad-{version}-{args.target}"
    entries = [("ghostpad", binary, 0o755)]
    entries.append(("install.sh", b'#!/bin/sh\nset -eu\nrelease_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec python3 "$release_dir/scripts/install-desktop.py" --binary "$release_dir/ghostpad" "$@"\n', 0o755))
    for relative in FILES:
        source = ROOT / relative
        if source.is_symlink() or not source.is_file():
            parser.error(f"Release input must be a regular file: {relative}")
        entries.append((relative, source.read_bytes(), 0o644))
    epoch = int(os.environ.get("SOURCE_DATE_EPOCH", "0"))
    args.output.mkdir(parents=True, exist_ok=True)
    archive = args.output / f"{name}.tar.gz"
    # Normalize metadata and gzip headers. Identical inputs produce identical bytes.
    with archive.open("wb") as output:
        with gzip.GzipFile(fileobj=output, mode="wb", filename="", mtime=epoch) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as bundle:
                for relative, data, mode in sorted(entries):
                    info = tarfile.TarInfo(f"{name}/{relative}")
                    info.size, info.mode, info.mtime = len(data), mode, epoch
                    bundle.addfile(info, io.BytesIO(data))
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix(archive.suffix + ".sha256").write_text(f"{digest}  {archive.name}\n")
    print(f"Created {archive} ({archive.stat().st_size:,} bytes)")
    print(f"SHA-256: {digest}")


if __name__ == "__main__":
    main()
