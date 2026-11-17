# Installation

Ghostpad runs as your normal Linux desktop user. Installation does not grant input access, edit the firewall, or enable a service. Those are separate, explicit choices.

## Build from source

Requirements: Rust 1.85 or later, a C linker, OpenSSL development libraries, Make, Python 3.9 or later, and Git. Check `rustc --version`; if your distribution ships an older Rust, use a current toolchain from [rustup](https://rustup.rs/).

Install prerequisites for your distribution:

```sh
# Debian / Ubuntu (install Rust 1.85+ separately)
sudo apt install build-essential libssl-dev python3 git qrencode iproute2 xdg-utils acl

# Arch Linux / Omarchy
sudo pacman -S --needed rust base-devel openssl python git qrencode iproute2 xdg-utils acl

# Fedora
sudo dnf install rust cargo gcc openssl-devel make python3 git qrencode iproute xdg-utils acl
```

`qrencode` supplies the pairing QR. Without it you can still copy the complete pairing link. `xdg-open` opens the desktop pairing page; terminal mode works without it. Bash and the usual Linux module/udev tools are needed for input setup. Persistent access needs a desktop with systemd-logind/udev's `uaccess` support; temporary ACL setup is an alternative.

```sh
git clone https://github.com/dmesgus/ghostpad.git
cd ghostpad
make install
make setup-persistent
```

Open Ghostpad in your app launcher. The launcher uses an absolute executable path, so it works even if `~/.local/bin` is absent from your terminal's PATH. The installed executable embeds every browser asset and runs independently of this source folder. It still needs your system's OpenSSL runtime libraries.

No npm installation or frontend rebuild is required for ordinary source installation. Cargo builds offline with the checked-in lockfile. Install your compiler and system libraries first; those are not bundled.

## Install a release archive

Use this path after a maintainer has published assets on [GitHub Releases](https://github.com/dmesgus/ghostpad/releases). Do not expect assets before the first release is published.

Choose your computer's architecture using `uname -m`:

| Architecture | Archive suffix | Runtime baseline from the release workflow |
| --- | --- | --- |
| `x86_64` | `x86_64-unknown-linux-gnu.tar.gz` | glibc 2.35+, OpenSSL 3 (Ubuntu 22.04 build) |
| `aarch64` / `arm64` | `aarch64-unknown-linux-gnu.tar.gz` | glibc 2.35+, OpenSSL 3 (Ubuntu 22.04 build) |

These are GNU/Linux binaries, not fully static binaries. Alpine/musl and older glibc systems need a source build. Runtime package names are usually `openssl` (Arch/Fedora) and `libssl3` or `libssl3t64` (Debian/Ubuntu). Also install Python 3.9+, `qrencode`, `iproute2` (`iproute` on Fedora), `xdg-utils`, and `acl`. Rust, Node, and development headers are unnecessary for an archive install.

Download the matching archive and its `.sha256` file from the same release. In that directory, verify the exact downloaded filename; for example:

```sh
sha256sum -c ghostpad-0.3.0-x86_64-unknown-linux-gnu.tar.gz.sha256
tar -xzf ghostpad-0.3.0-x86_64-unknown-linux-gnu.tar.gz
cd ghostpad-0.3.0-x86_64-unknown-linux-gnu
./install.sh
~/.local/bin/ghostpad-setup --persistent
```

The checksum detects damaged or mismatched downloads; it is not an independent signature. Download only from this project's release page. The release pipeline prepares drafts for maintainer review and does not promise signed binaries.

The installer uses atomic replacement, so reinstalling can replace an executable while an older process still runs. **Stop the old receiver and reopen Ghostpad to use the update.**

## Input access

For access until reboot or device recreation:

```sh
make setup
# Installed equivalent:
~/.local/bin/ghostpad-setup
```

This loads `uinput` and grants your user read/write access to `/dev/uinput` with `setfacl`.

For access across reboots:

```sh
make setup-persistent
# Installed equivalent:
~/.local/bin/ghostpad-setup --persistent
```

This installs exactly two files:

- `/etc/udev/rules.d/70-ghostpad-uinput.rules` grants the active local session access with `uaccess`.
- `/etc/modules-load.d/ghostpad-uinput.conf` loads the `uinput` module during boot.

The setup script then reloads the rule and triggers it for `uinput`. If access is still unavailable, log out and back in and run `ghostpad-doctor`. On systems without the session integration, use temporary setup. Do not make `/dev/uinput` world-writable or run the receiver as root. Input permission allows other programs running as your user to create virtual input devices too.

## Custom location

```sh
make install PREFIX="$HOME/Applications/ghostpad"
make uninstall PREFIX="$HOME/Applications/ghostpad"
```

For an archive, `./install.sh --prefix "$HOME/Applications/ghostpad"` installs without building. Its launcher is written under that prefix's `share/applications`; a nonstandard prefix must be in your desktop's application search path to appear in the launcher. The default `~/.local` works on standard Linux desktops.

## Update

Stop Ghostpad using the desktop pairing page or Ctrl+C in the receiver terminal. For a source checkout with no local edits:

```sh
git pull --ff-only
make install
```

Or install a verified archive from the new release using `./install.sh`. Reopen Ghostpad, then refresh the phone page so receiver and browser use matching assets. Pairing survives updates unless you deliberately rotate the key. Startup options apply to new processes; opening an already-running HTTP receiver returns to its current pairing page. Stop a TLS receiver before changing startup options or relaunching it.

## Remove

Stop Ghostpad first. From the source folder:

```sh
make uninstall
```

From an extracted release folder:

```sh
python3 scripts/install-desktop.py --uninstall
```

For a custom prefix, pass the same `PREFIX` or `--prefix` used at installation. Removal is scoped to Ghostpad's installed files. It keeps pairing, phone preferences, firewall rules, and the two system input configuration files.

For complete removal, after stopping the receiver and confirming those configurations are no longer wanted:

```sh
# Remove only the input configuration installed by Ghostpad:
sudo rm /etc/udev/rules.d/70-ghostpad-uinput.rules /etc/modules-load.d/ghostpad-uinput.conf
sudo udevadm control --reload-rules
```

Reboot to clear the current device's access; removing a rule does not revoke an already-applied ACL. Do not unload `uinput` while another application uses it. Review `sudo ufw status numbered` and delete only the rules marked `Ghostpad phone` or `Ghostpad private LAN` that you no longer need, using `sudo ufw delete NUMBER`; numbers change after each deletion.

Delete `pairing-key` inside `${XDG_CONFIG_HOME:-$HOME/.config}/ghostpad/` if you want to discard the saved credential, and use **Forget pairing** in each phone browser. Saved phone preferences live in that browser's site storage. Removing your saved computer key alone does not stop a running receiver; stop it first.

## Optional user service

Most users should launch Ghostpad on demand. `packaging/ghostpad.service` is an optional source template, not an installed/enabled service. Inspect its address and TLS options before copying it to your systemd user configuration. It uses `--no-pairing-output` to keep pairing credentials out of the journal and requires input access to be set up separately. It still listens on the LAN whenever running. For a custom address/port, use the same options when opening `ghostpad --desktop`.
