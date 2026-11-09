#!/usr/bin/env python3
"""Build and install the standalone receiver and its desktop launcher for this user."""

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def install(source, destination, mode):
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Replace atomically so reinstalling also works while the old binary is running.
    fd, temporary = tempfile.mkstemp(prefix=".ghostpad-", dir=destination.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(source)
        os.chmod(temporary, mode)
        os.replace(temporary, destination)
    finally:
        Path(temporary).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prefix", type=Path, default=Path.home() / ".local")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    prefix = args.prefix.expanduser().resolve()
    binary = prefix / "bin/ghostpad"
    subprocess.run(["cargo", "build", "--release", "--offline"], cwd=root, check=True)
    desktop = (root / "packaging/ghostpad.desktop").read_text()
    # Desktop Exec has its own quoting rules, independent of shell quoting.
    executable = str(binary).replace("%", "%%")
    for character in ("\\", '"', "`", "$"):
        executable = executable.replace(character, "\\" + character)
    # Desktop strings decode backslash escapes before Exec argument parsing.
    executable = executable.replace("\\", "\\\\")
    desktop = desktop.replace("Exec=ghostpad\n", f'Exec="{executable}"\n', 1)
    # Exec is absolute, so launchers need no PATH lookup or TryExec check.
    desktop = desktop.replace("TryExec=ghostpad\n", "")
    validator = shutil.which("desktop-file-validate")
    if validator:
        with tempfile.TemporaryDirectory() as directory:
            candidate = Path(directory) / "ghostpad.desktop"
            candidate.write_text(desktop)
            subprocess.run([validator, str(candidate)], check=True)
    install((root / "target/release/ghostpad").read_bytes(), binary, 0o755)
    install((root / "web/icon.svg").read_bytes(),
            prefix / "share/icons/hicolor/scalable/apps/ghostpad.svg", 0o644)
    install(desktop.encode(), prefix / "share/applications/ghostpad.desktop", 0o755)
    updater = shutil.which("update-desktop-database")
    if updater:
        subprocess.run([updater, str(prefix / "share/applications")], check=True)
    print(f"Installed executable: {binary}")
    print("Open Ghostpad from your app launcher to see the phone pairing QR.")


if __name__ == "__main__":
    main()
