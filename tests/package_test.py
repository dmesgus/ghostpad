"""Release content, architecture checks, and reproducible archives; no native input."""

import hashlib
import os
from pathlib import Path
import struct
import subprocess
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class Packaging(unittest.TestCase):
    def test_archive_is_scoped_reproducible_and_installable_without_cargo(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            binary = directory / "receiver"
            header = bytearray(64)
            header[:6] = b"\x7fELF\x02\x01"
            struct.pack_into("<H", header, 18, 62)
            binary.write_bytes(header)
            output = directory / "output"
            command = ["python3", str(ROOT / "scripts/package-release.py"), "--binary", str(binary),
                       "--target", "x86_64-unknown-linux-gnu", "--output", str(output)]
            subprocess.run(command, check=True, capture_output=True)
            archive = next(output.glob("*.tar.gz"))
            first = archive.read_bytes()
            subprocess.run(command, check=True, capture_output=True)
            self.assertEqual(archive.read_bytes(), first)
            self.assertEqual(archive.with_suffix(".gz.sha256").read_text().split()[0], hashlib.sha256(first).hexdigest())
            extracted = directory / "extracted"
            with tarfile.open(archive) as bundle:
                names = bundle.getnames()
                for name in names:
                    self.assertNotIn("..", Path(name).parts)
                    self.assertNotIn("pairing-key", name)
                    self.assertFalse(any(part in (".git", "node_modules", "target", "artifacts") for part in Path(name).parts))
                # The release packer emits files only, with normalized ownership/modes.
                for member in bundle:
                    self.assertTrue(member.isfile())
                    self.assertEqual(member.uid, 0)
                    destination = extracted / member.name
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes(bundle.extractfile(member).read())
                    destination.chmod(member.mode)
            release = next(extracted.iterdir())
            prefix = directory / "installed"
            result = subprocess.run([str(release / "install.sh"), "--prefix", str(prefix)],
                                    env={**os.environ, "HOME": str(directory)}, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn("Compiling", result.stderr)
            self.assertEqual((prefix / "bin/ghostpad").read_bytes(), header)

    def test_wrong_architecture_and_non_elf_are_rejected_before_archiving(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            binary = directory / "receiver"
            for data in (b"not an ELF", b"\x7fELF\x02\x01" + bytes(58)):
                binary.write_bytes(data)
                result = subprocess.run(["python3", str(ROOT / "scripts/package-release.py"),
                                         "--binary", str(binary), "--target", "aarch64-unknown-linux-gnu",
                                         "--output", str(directory / "output")], capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((directory / "output").exists())


if __name__ == "__main__":
    unittest.main()
