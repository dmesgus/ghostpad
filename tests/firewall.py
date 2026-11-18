"""Exercise firewall scoping with fake ip/sudo commands; never change host rules."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class Firewall(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        self.log = self.directory / "sudo.json"
        for name, body in {
            "ip": 'import os; print(os.environ["GHOSTPAD_TEST_IP_RESULT"])',
            "ufw": 'raise RuntimeError("Tests must never call ufw")',
            "sudo": 'import json, os, sys; open(os.environ["GHOSTPAD_TEST_SUDO_LOG"], "w").write(json.dumps(sys.argv[1:]))',
        }.items():
            path = self.directory / name
            path.write_text("#!/usr/bin/env python3\n" + body + "\n")
            path.chmod(0o755)
        self.env = {**os.environ, "PATH": f'{self.directory}:{os.environ["PATH"]}',
                    "GHOSTPAD_TEST_SUDO_LOG": str(self.log)}

    def run_helper(self, args, result):
        return subprocess.run([str(ROOT / "scripts/allow-phone.sh"), *args],
                              env={**self.env, "GHOSTPAD_TEST_IP_RESULT": json.dumps(result)},
                              capture_output=True, text=True)

    def interface(self, prefix=28):
        return [{"ifname": "wlp1s0", "addr_info": [
            {"family": "inet", "local": "172.20.10.4", "prefixlen": prefix}]}]

    def test_existing_single_phone_scope(self):
        result = self.run_helper(["172.20.10.2"], [{"dev": "wlp1s0"}])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.log.read_text()), [
            "ufw", "allow", "in", "on", "wlp1s0", "proto", "tcp", "from", "172.20.10.2",
            "to", "any", "port", "8765", "comment", "Ghostpad phone"])

    def test_lan_scope_survives_dhcp_within_the_selected_subnet(self):
        for address in ("172.20.10.4", "172.20.10.6"):
            interface = self.interface()
            interface[0]["addr_info"][0]["local"] = address
            result = self.run_helper(["--lan", address, "--port", "9876"], interface)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(self.log.read_text()), [
                "ufw", "allow", "in", "on", "wlp1s0", "proto", "tcp", "from", "172.20.10.0/28",
                "to", "172.20.10.0/28", "port", "9876", "comment", "Ghostpad private LAN"])

    def test_dry_run_never_invokes_sudo(self):
        for args, data in [(["172.20.10.2", "--dry-run"], [{"dev": "wlp1s0"}]),
                           (["--lan", "172.20.10.4", "--dry-run"], self.interface())]:
            result = self.run_helper(args, data)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("Command: sudo ufw allow", result.stdout)
            self.assertFalse(self.log.exists())

    def test_invalid_or_routed_targets_never_invoke_sudo(self):
        cases = [(["8.8.8.8"], []), (["127.0.0.1"], []), (["not-an-ip"], []),
                 (["172.20.10.2"], [{"dev": "wlp1s0", "gateway": "172.20.10.1"}]),
                 (["172.20.10.4"], [{"dev": "lo", "type": "local"}]),
                 (["172.20.10.15"], [{"dev": "wlp1s0", "type": "broadcast"}]),
                 (["--lan", "172.20.10.2"], self.interface()),
                 (["--lan", "172.20.10.4"], self.interface(0)),
                 (["--lan", "172.20.10.4"], self.interface() * 2),
                 (["--lan", "172.20.10.4"], [{"ifname": "bad;interface", "addr_info": self.interface()[0]["addr_info"]}])]
        cases += [(["172.20.10.2", "--port", port], [{"dev": "wlp1s0"}])
                  for port in ["0", "65536", "abc", "-1", "１２"]]
        for args, data in cases:
            with self.subTest(args=args, data=data):
                result = self.run_helper(args, data)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(self.log.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
