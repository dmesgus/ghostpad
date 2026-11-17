#!/usr/bin/env python3
"""Install a real release archive into a disposable prefix and check preview HTTP."""

import argparse
import http.client
import os
from pathlib import Path
import socket
import subprocess
import tarfile
import tempfile
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="ghostpad-release-smoke-") as temporary:
        directory = Path(temporary)
        with tarfile.open(args.archive) as bundle:
            for member in bundle:
                if not member.isfile() or Path(member.name).is_absolute() or ".." in Path(member.name).parts:
                    raise ValueError("Release contains an unsafe archive member")
                destination = directory / "bundle" / member.name
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(bundle.extractfile(member).read())
                destination.chmod(member.mode)
        release = next((directory / "bundle").iterdir())
        prefix = directory / "prefix with spaces"
        env = {**os.environ, "HOME": str(directory), "XDG_CONFIG_HOME": str(directory / "config")}
        subprocess.run([str(release / "install.sh"), "--prefix", str(prefix)], env=env, check=True,
                       stdout=subprocess.DEVNULL)
        binary = prefix / "bin/ghostpad"
        version = subprocess.check_output([str(binary), "--version"], env=env, text=True).strip()
        with socket.socket() as reserved:
            reserved.bind(("127.0.0.1", 0))
            port = reserved.getsockname()[1]
        process = subprocess.Popen([str(binary), "--preview", "--no-pairing-output",
                                    "--address", "127.0.0.1", "--port", str(port)],
                                   env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            for _ in range(100):
                try:
                    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=1)
                    connection.request("GET", "/health")
                    response = connection.getresponse()
                    assert response.status == 200 and response.read() == b"ghostpad/1"
                    connection.close()
                    break
                except OSError:
                    if process.poll() is not None:
                        raise RuntimeError("Release preview receiver exited during startup")
                    time.sleep(0.03)
            else:
                raise RuntimeError("Release preview receiver never became ready")
            key = (directory / "config/ghostpad/pairing-key").read_text()
            for path in ("/", "/desktop", "/icon.png", "/desktop.js"):
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
                connection.request("GET", path)
                response = connection.getresponse()
                assert response.status == 200, path
                assert key.encode() not in response.read(), "Credential exposed in public asset"
                connection.close()
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
            connection.request("GET", "/api/desktop/status", headers={"Authorization": f"Bearer {key}"})
            response = connection.getresponse()
            assert response.status == 200 and b'"preview":true' in response.read()
            connection.close()
        finally:
            process.terminate()
            stdout, stderr = process.communicate(timeout=5)
        assert key.encode() not in stdout + stderr, "Pairing output was not suppressed"
        subprocess.run(["python3", str(release / "scripts/install-desktop.py"), "--prefix", str(prefix),
                        "--uninstall"], env=env, check=True, stdout=subprocess.DEVNULL)
        assert not binary.exists()
        print(f"{version}: archive install, preview HTTP/auth/assets, private output, and removal passed.")


if __name__ == "__main__":
    main()
