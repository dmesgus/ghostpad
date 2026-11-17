#!/usr/bin/env python3
"""Build and install the standalone receiver and its desktop launcher for this user."""

import argparse
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
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


def desktop_argument(value):
    """Quote one Exec argument through desktop-string and Exec decoding."""
    value = str(value).replace("%", "%%")
    for character in ("\\", '"', "`", "$"):
        value = value.replace(character, "\\" + character)
    return '"' + value.replace("\\", "\\\\") + '"'


def installed_files(prefix):
    """Only files owned by this installer; pairing and firewall rules are separate."""
    paths = [prefix / name for name in (
        "bin/ghostpad", "bin/ghostpad-allow-phone", "bin/ghostpad-doctor",
        "bin/ghostpad-setup", "share/applications/ghostpad.desktop",
        "share/icons/hicolor/scalable/apps/ghostpad.svg",
        "share/icons/hicolor/256x256/apps/ghostpad.png",
        "share/ghostpad/packaging/70-ghostpad-uinput.rules",
        "share/ghostpad/packaging/ghostpad-uinput.conf",
    )]
    # Previous versions use content-versioned launcher icons.
    paths.extend(path for path in (prefix / "share/ghostpad").glob("icon-*.svg")
                 if re.fullmatch(r"icon-[a-f0-9]{12}\.svg", path.name))
    return paths


def refresh_desktop(prefix):
    updater = shutil.which("update-desktop-database")
    applications = prefix / "share/applications"
    if updater and applications.is_dir():
        subprocess.run([updater, str(applications)], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prefix", type=Path, default=Path.home() / ".local")
    operation = parser.add_mutually_exclusive_group()
    operation.add_argument("--binary", type=Path, help="Install a prebuilt binary without Cargo")
    operation.add_argument("--uninstall", action="store_true", help="Remove installed files, keeping saved pairing")
    args = parser.parse_args()
    if sys.platform != "linux":
        parser.error("Ghostpad requires Linux.")
    if os.geteuid() == 0:
        parser.error("Run as your normal desktop user, without sudo.")
    root = Path(__file__).resolve().parents[1]
    prefix = args.prefix.expanduser().resolve()
    if any(character in str(prefix) for character in "\r\n\0"):
        parser.error("Installation prefix must not contain control characters.")
    if args.uninstall:
        for path in installed_files(prefix):
            if path.is_file() or path.is_symlink():
                path.unlink()
                print(f"Removed: {path}")
        refresh_desktop(prefix)
        print("Saved pairing, system input setup, and firewall rules were kept.")
        print("Stop any running receiver separately. See docs/installation.md for complete removal.")
        return
    binary = prefix / "bin/ghostpad"
    icon_svg = (root / "web/icon.svg").read_bytes()
    icon_version = hashlib.sha256(icon_svg).hexdigest()[:12]
    launcher_icon = prefix / f"share/ghostpad/icon-{icon_version}.svg"
    source_binary = args.binary.expanduser().resolve() if args.binary else root / "target/release/ghostpad"
    if not args.binary:
        if not shutil.which("cargo"):
            parser.error("Source installation needs Rust/Cargo 1.85+. Install Rust or use a release archive's install.sh.")
        subprocess.run(["cargo", "build", "--release", "--offline", "--locked"], cwd=root, check=True)
    if not source_binary.is_file():
        parser.error(f"Binary not found: {source_binary}")
    desktop = (root / "packaging/ghostpad.desktop").read_text()
    executable = desktop_argument(binary)
    desktop = desktop.replace("Exec=ghostpad --desktop\n", f"Exec={executable} --desktop\n", 1)
    # Exec is absolute, so launchers need no PATH lookup or TryExec check.
    desktop = desktop.replace("TryExec=ghostpad\n", "")
    # A content-versioned absolute path avoids stale launcher/theme icon caches.
    icon_value = str(launcher_icon).replace("\\", "\\\\")
    desktop = desktop.replace("Icon=ghostpad\n", f"Icon={icon_value}\n", 1)
    validator = shutil.which("desktop-file-validate")
    if validator:
        with tempfile.TemporaryDirectory() as directory:
            candidate = Path(directory) / "ghostpad.desktop"
            candidate.write_text(desktop)
            subprocess.run([validator, str(candidate)], check=True)
    install(source_binary.read_bytes(), binary, 0o755)
    install((root / "scripts/allow-phone.sh").read_bytes(), prefix / "bin/ghostpad-allow-phone", 0o755)
    install((root / "scripts/doctor.py").read_bytes(), prefix / "bin/ghostpad-doctor", 0o755)
    install((root / "scripts/setup-linux.sh").read_bytes(), prefix / "bin/ghostpad-setup", 0o755)
    for name in ("70-ghostpad-uinput.rules", "ghostpad-uinput.conf"):
        install((root / "packaging" / name).read_bytes(), prefix / "share/ghostpad/packaging" / name, 0o644)
    install(icon_svg, launcher_icon, 0o644)
    install(icon_svg,
            prefix / "share/icons/hicolor/scalable/apps/ghostpad.svg", 0o644)
    install((root / "web/icon.png").read_bytes(),
            prefix / "share/icons/hicolor/256x256/apps/ghostpad.png", 0o644)
    install(desktop.encode(), prefix / "share/applications/ghostpad.desktop", 0o644)
    refresh_desktop(prefix)
    print(f"Installed executable: {binary}")
    print(f"Firewall helper: {prefix / 'bin/ghostpad-allow-phone'}")
    print(f"Diagnostics: {prefix / 'bin/ghostpad-doctor'}")
    print(f"Input setup: {prefix / 'bin/ghostpad-setup'} --persistent (asks for sudo)")
    print("Open Ghostpad from your app launcher to pair in your browser. No terminal needed.")
    if str(prefix / "bin") not in os.environ.get("PATH", "").split(os.pathsep):
        print(f"The launcher works immediately. For terminal commands, add {prefix / 'bin'} to PATH or use its full path.")


if __name__ == "__main__":
    main()
