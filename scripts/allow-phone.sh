#!/usr/bin/env bash
# Allow one phone, or explicitly opt in to the receiver's private LAN subnet.
set -euo pipefail
usage() { echo "Usage: $0 PHONE_IPV4 [--port PORT] [--dry-run]
       $0 --lan COMPUTER_WIFI_IPV4 [--port PORT] [--dry-run]" >&2; exit 1; }
mode=phone
dry_run=false
port=8765
target=
while [[ $# -gt 0 ]]; do
  case $1 in
    --lan) [[ $mode == phone ]] || usage; mode=lan ;;
    --dry-run) dry_run=true ;;
    --port) [[ $# -ge 2 ]] || usage; port=$2; shift ;;
    -*) usage ;;
    *) [[ -z $target ]] || usage; target=$1 ;;
  esac
  shift
done
[[ -n $target ]] || usage
command -v ufw >/dev/null || { echo 'UFW is not installed.' >&2; exit 1; }
route_info=$(python3 - "$mode" "$target" "$port" <<'PY'
import ipaddress, json, subprocess, sys
try:
    mode, value, port = sys.argv[1:]
    if not port.isascii() or not port.isdecimal() or not 1 <= int(port) <= 65535:
        raise ValueError('Port must be a number from 1 to 65535.')
    address = ipaddress.IPv4Address(value)
    private = [ipaddress.IPv4Network(n) for n in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')]
    if not any(address in network for network in private):
        raise ValueError('Use a private Wi-Fi IPv4 address.')
    if mode == 'lan':
        interfaces = json.loads(subprocess.check_output(['ip', '-j', '-4', 'addr', 'show', 'up'], text=True))
        matches = [(entry['ifname'], info) for entry in interfaces for info in entry.get('addr_info', [])
                   if info.get('family') == 'inet' and info.get('local') == str(address)]
        if len(matches) != 1:
            raise ValueError('Use the computer’s current Wi-Fi/LAN IPv4 address, as printed by Ghostpad.')
        iface, info = matches[0]
        subnet = ipaddress.IPv4Network(f'{address}/{info["prefixlen"]}', strict=False)
        if not any(subnet.subnet_of(network) for network in private):
            raise ValueError('The entire LAN subnet must be private.')
        source, destination = str(subnet), str(address)
    else:
        routes = json.loads(subprocess.check_output(['ip', '-j', '-4', 'route', 'get', str(address)], text=True))
        route = routes[0]
        iface = route['dev']
        if route.get('gateway') or route.get('type') in ('local', 'broadcast', 'blackhole', 'unreachable', 'prohibit'):
            raise ValueError('The phone must be on a directly attached Wi-Fi/LAN network.')
        source, destination = str(address), 'any'
    if iface == 'lo':
        raise ValueError('Use a Wi-Fi/LAN interface, not loopback.')
    if not iface or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.:-' for c in iface):
        raise ValueError('Invalid network interface.')
    print(iface, source, destination, int(port))
except (ValueError, KeyError, IndexError, TypeError, OSError, subprocess.CalledProcessError) as e:
    sys.exit(str(e))
PY
)
read -r interface source destination port <<< "$route_info"
comment='Ghostpad phone'
[[ $mode != lan ]] || comment='Ghostpad private LAN'
rule=(ufw allow in on "$interface" proto tcp from "$source" to "$destination" port "$port" comment "$comment")
printf 'Allow %s on %s to Ghostpad TCP port %s (destination %s).\n' "$source" "$interface" "$port" "$destination"
printf 'Command: sudo'; printf ' %q' "${rule[@]}"; printf '\n'
if [[ $dry_run == false ]]; then
  sudo "${rule[@]}"
fi
