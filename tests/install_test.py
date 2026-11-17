"""Exercise installation/removal in a private prefix, never in the user's desktop."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class Installation(unittest.TestCase):
    def test_prebuilt_install_upgrade_and_scoped_removal(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            # Spaces, percent signs and shell metacharacters must survive Exec encoding.
            prefix = directory / 'my % desktop $ ` space'
            binary = directory / "prebuilt"
            binary.write_bytes(b"first binary")
            script = str(ROOT / "scripts/install-desktop.py")
            command = ["python3", script, "--prefix", str(prefix)]
            env = {**os.environ, "HOME": str(directory)}
            result = subprocess.run([*command, "--binary", str(binary)],
                                    env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            installed = prefix / "bin/ghostpad"
            self.assertEqual(installed.read_bytes(), b"first binary")
            self.assertEqual(installed.stat().st_mode & 0o777, 0o755)
            desktop = prefix / "share/applications/ghostpad.desktop"
            self.assertIn(" --desktop\n", desktop.read_text())
            self.assertNotIn("TryExec=", desktop.read_text())
            self.assertIn("%%", desktop.read_text())
            for helper in ("ghostpad-doctor", "ghostpad-setup", "ghostpad-allow-phone"):
                self.assertTrue(os.access(prefix / "bin" / helper, os.X_OK))
            self.assertTrue((prefix / "share/ghostpad/packaging/70-ghostpad-uinput.rules").is_file())
            binary.write_bytes(b"updated binary")
            subprocess.run([*command, "--binary", str(binary)], env=env, check=True, capture_output=True)
            self.assertEqual(installed.read_bytes(), b"updated binary")
            unrelated = prefix / "share/ghostpad/icon-personal.svg"
            unrelated.write_text("keep me")
            saved = directory / ".config/ghostpad/pairing-key"
            saved.parent.mkdir(parents=True)
            saved.write_text("kept credential")
            for _ in range(2):
                subprocess.run([*command, "--uninstall"], env=env, check=True, capture_output=True)
            self.assertFalse(installed.exists())
            self.assertFalse(desktop.exists())
            self.assertEqual(unrelated.read_text(), "keep me")
            self.assertEqual(saved.read_text(), "kept credential")

    def test_installed_setup_uses_bundled_rules_and_never_requires_acl_for_persistence(self):
        with tempfile.TemporaryDirectory() as temporary:
            prefix = Path(temporary)
            binary = prefix / "prebuilt"
            binary.write_bytes(b"test")
            subprocess.run(["python3", str(ROOT / "scripts/install-desktop.py"),
                            "--prefix", str(prefix), "--binary", str(binary)],
                           check=True, capture_output=True)
            fake_bin = prefix / "fake-bin"
            fake_bin.mkdir()
            log = prefix / "sudo-log"
            (fake_bin / "sudo").write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$GHOSTPAD_TEST_SUDO_LOG"\n')
            (fake_bin / "sudo").chmod(0o755)
            result = subprocess.run([str(prefix / "bin/ghostpad-setup"), "--persistent"],
                                    env={**os.environ, "PATH": f'{fake_bin}:{os.environ["PATH"]}',
                                         "GHOSTPAD_TEST_SUDO_LOG": str(log)},
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("share/ghostpad/packaging/70-ghostpad-uinput.rules", log.read_text())
            self.assertIn("/etc/modules-load.d/ghostpad-uinput.conf", log.read_text())


if __name__ == "__main__":
    unittest.main()
