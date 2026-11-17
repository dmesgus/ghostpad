#!/usr/bin/env python3
"""Read-only Ghostpad diagnostics. Never reads pairing keys or changes the system."""

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", action="store_true", help="Also check source-build tools")
    args = parser.parse_args()
    failed = False

    def report(ok, title, detail="", required=True):
        nonlocal failed
        print(f'{"OK" if ok else "FIX" if required else "INFO"}: {title}' + (f" — {detail}" if detail else ""))
        failed |= required and not ok

    report(sys.platform == "linux", "Linux receiver")
    report(os.geteuid() != 0, "Normal desktop user", "Run Ghostpad without sudo.")
    for tool, detail, required in (
        ("ip", "Network selection; install iproute2 (iproute on Fedora).", True),
        ("xdg-open", "Browser pairing; install xdg-utils, or use terminal mode.", False),
        ("qrencode", "QR codes; copying the complete pairing link works without it.", False),
        ("setfacl", "Temporary input setup; provided by the acl package.", False),
    ):
        report(bool(shutil.which(tool)), tool, detail, required)
    device = Path("/dev/uinput")
    report(device.exists() and os.access(device, os.W_OK), "Linux input access",
           "If unavailable: ghostpad-setup --persistent, or make setup-persistent from source.")
    if shutil.which("ip"):
        try:
            result = subprocess.run(["ip", "-4", "-brief", "address", "show", "up"],
                                    capture_output=True, text=True, timeout=5)
            report(result.returncode == 0, "Network interfaces", required=False)
            if result.returncode == 0:
                print(result.stdout.strip())
            else:
                print("INFO: Interface listing was unavailable; process/sandbox permissions may restrict it.")
        except (OSError, subprocess.TimeoutExpired):
            print("INFO: Could not query interfaces. Try ip -4 -brief address in a terminal.")
        print("Use your Wi-Fi/LAN IPv4 address with --address if selection is ambiguous.")
    config = Path("/etc/ufw/ufw.conf")
    try:
        enabled = any(line.strip() == "ENABLED=yes" for line in config.read_text().splitlines())
    except (OSError, UnicodeError):
        enabled = None
    if enabled:
        print("INFO: UFW enabled — allow each phone with ghostpad-allow-phone PHONE_WIFI_IPV4.")
    else:
        print("INFO: Firewall access is not verified. Check your firewall if the phone cannot connect.")
    if args.build:
        for tool in ("cargo", "rustc", "cc"):
            report(bool(shutil.which(tool)), f"Build tool: {tool}")
        print("INFO: Source builds also need OpenSSL development libraries. See docs/installation.md.")
    print("\nChecks do not test phone reachability, browser trust, or compositor gestures.")
    return int(failed)


if __name__ == "__main__":
    sys.exit(main())
