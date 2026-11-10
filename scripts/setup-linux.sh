#!/usr/bin/env bash
# Input access for the desktop user; never run the receiver as root.
set -euo pipefail
if [[ $# -gt 1 || ( $# -eq 1 && $1 != --persistent ) ]]; then
  echo 'Usage: setup-linux.sh [--persistent]' >&2
  exit 1
fi
if [[ $(uname -s) != Linux ]]; then echo 'Linux is required for cursor control.' >&2; exit 1; fi
if [[ $EUID -eq 0 ]]; then echo 'Run this script as your normal desktop user, not via sudo.' >&2; exit 1; fi
if ! command -v setfacl >/dev/null; then echo 'Install the acl package first (provides setfacl).' >&2; exit 1; fi
if [[ ${1:-} == --persistent ]]; then
  source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../packaging" && pwd)"
  sudo install -Dm644 "$source_dir/70-ghostpad-uinput.rules" /etc/udev/rules.d/70-ghostpad-uinput.rules
  sudo install -Dm644 "$source_dir/ghostpad-uinput.conf" /etc/modules-load.d/ghostpad-uinput.conf
  sudo modprobe uinput
  sudo udevadm control --reload-rules
  sudo udevadm trigger --action=change --subsystem-match=misc --sysname-match=uinput
  sudo udevadm settle
  printf 'Persistent uinput access installed for the active local desktop session.\nRun Ghostpad as your normal desktop user.\n'
  exit 0
fi
sudo modprobe uinput
sudo setfacl -m "u:$(id -un):rw" /dev/uinput
printf 'Ghostpad can now use /dev/uinput. Access lasts until reboot/device recreation.\nRun: cargo run --release\n'
if command -v ufw >/dev/null && [[ -r /etc/ufw/ufw.conf ]] && grep -q '^ENABLED=yes' /etc/ufw/ufw.conf; then
  printf '\nUFW is enabled. Allow your phone before scanning the QR:\n  ./scripts/allow-phone.sh PHONE_WIFI_IPV4\nFind that address in the phone’s Wi-Fi settings. Only that phone is allowed.\n'
fi
