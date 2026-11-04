#!/usr/bin/env bash
# Temporary access for the current user; no global writable input device or root receiver.
set -euo pipefail
if [[ $(uname -s) != Linux ]]; then echo 'Linux is required for cursor control.' >&2; exit 1; fi
if [[ $EUID -eq 0 ]]; then echo 'Run this script as your normal desktop user, not via sudo.' >&2; exit 1; fi
if ! command -v setfacl >/dev/null; then echo 'Install the acl package first (provides setfacl).' >&2; exit 1; fi
sudo modprobe uinput
sudo setfacl -m "u:$(id -un):rw" /dev/uinput
printf 'Ghostpad can now use /dev/uinput. Access lasts until reboot/device recreation.\nRun: cargo run --release\n'
if command -v ufw >/dev/null && [[ -r /etc/ufw/ufw.conf ]] && grep -q '^ENABLED=yes' /etc/ufw/ufw.conf; then
  printf '\nUFW is enabled. Allow your phone before scanning the QR:\n  ./scripts/allow-phone.sh PHONE_WIFI_IPV4\nFind that address in the phone’s Wi-Fi settings. Only that phone is allowed.\n'
fi
