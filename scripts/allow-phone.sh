#!/usr/bin/env bash
# Allow one phone on its directly attached IPv4 network; never disable the firewall.
set -euo pipefail
if [[ $# -lt 1 || $# -gt 2 || (${2:-} != '' && ${2:-} != --dry-run) ]]; then
  echo "Usage: $0 PHONE_IPV4 [--dry-run]" >&2
  exit 1
fi
command -v ufw >/dev/null || { echo 'UFW is not installed.' >&2; exit 1; }
route_info=$(python3 - "$1" <<'PY'
import ipaddress, json, subprocess, sys
try:
    phone = ipaddress.IPv4Address(sys.argv[1])
    if not any(phone in ipaddress.IPv4Network(n) for n in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')):
        raise ValueError('Use the phone’s private Wi-Fi IPv4 address.')
    routes = json.loads(subprocess.check_output(['ip', '-j', '-4', 'route', 'get', str(phone)], text=True))
    route = routes[0]
    iface = route['dev']
    if route.get('gateway') or route.get('type') in ('local', 'blackhole', 'unreachable') or iface == 'lo':
        raise ValueError('The phone must be on a directly attached Wi-Fi/LAN network.')
    if not iface or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.:-' for c in iface):
        raise ValueError('Invalid network interface.')
    print(iface, phone)
except (ValueError, KeyError, IndexError, subprocess.CalledProcessError) as e:
    sys.exit(str(e))
PY
)
read -r interface phone <<< "$route_info"
rule=(ufw allow in on "$interface" proto tcp from "$phone" to any port 8765 comment 'Ghostpad phone')
printf 'Allow only phone %s on %s to Ghostpad TCP port 8765.\n' "$phone" "$interface"
printf 'Command: sudo'; printf ' %q' "${rule[@]}"; printf '\n'
if [[ ${2:-} != --dry-run ]]; then
  sudo "${rule[@]}"
fi
