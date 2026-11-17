# User installation never uses sudo. Only the explicit setup targets do.
.DEFAULT_GOAL := help
PREFIX ?= $(HOME)/.local
PYTHON ?= python3
CARGO ?= cargo
NPM ?= npm
GITLEAKS ?= gitleaks
ARGS ?=

.PHONY: help build debug run preview install uninstall setup setup-persistent doctor \
        test test-integration test-browser check web icons dist audit-secrets

help:
	@printf '%s\n' \
	  'Ghostpad — a phone trackpad for Linux' \
	  '' \
	  '  make install          Build and install for your user (no sudo)' \
	  '  make setup            Grant temporary input access (asks for sudo)' \
	  '  make setup-persistent Keep input access across reboots (asks for sudo)' \
	  '  make doctor           Check dependencies, input access, and networking' \
	  '  make run              Build and open browser pairing' \
	  '  make preview          Try pairing with computer input disabled' \
	  '  make uninstall        Remove installed files; keep saved pairing' \
	  '' \
	  '  make build            Build the standalone release binary, offline' \
	  '  make check            Rust formatting/lints and unit/script tests' \
	  '  make test-integration Test real TCP/TLS in isolated preview mode' \
	  '  make test-browser     Test Chromium UI and mobile browser profiles' \
	  '  make web              Rebuild checked-in UI (npm ci first)' \
	  '  make icons            Regenerate raster icons (needs rsvg-convert)' \
	  '  make dist             Build a release archive and SHA-256 checksum' \
	  '  make audit-secrets    Scan Git history and working files (gitleaks)' \
	  '' \
	  'Options: PREFIX="/path/to/prefix"  ARGS="--address 192.168.1.42"'

build:
	$(CARGO) build --release --offline --locked

debug:
	$(CARGO) build --offline --locked

run: build
	./target/release/ghostpad --desktop $(ARGS)

preview: build
	./target/release/ghostpad --preview --desktop $(ARGS)

install: build
	$(PYTHON) scripts/install-desktop.py --binary target/release/ghostpad --prefix "$(PREFIX)"

uninstall:
	$(PYTHON) scripts/install-desktop.py --uninstall --prefix "$(PREFIX)"

setup:
	./scripts/setup-linux.sh

setup-persistent:
	./scripts/setup-linux.sh --persistent

doctor:
	$(PYTHON) scripts/doctor.py

test:
	$(CARGO) test --offline --locked
	$(NPM) test
	$(PYTHON) -m unittest discover -s tests -p '*_test.py' -v
	$(PYTHON) tests/firewall.py

check:
	$(CARGO) fmt --check
	$(CARGO) clippy --offline --locked --all-targets -- -D warnings
	bash -n scripts/setup-linux.sh scripts/allow-phone.sh
	$(MAKE) test

test-integration: debug
	$(PYTHON) tests/integration.py

test-browser: debug
	$(NPM) run test:browser
	$(NPM) run test:mobile

web:
	$(NPM) run build:web

icons:
	$(NPM) run build:icons

dist: build
	$(PYTHON) scripts/package-release.py --binary target/release/ghostpad

audit-secrets:
	$(GITLEAKS) git --redact --log-opts="--all"
	$(GITLEAKS) dir --redact
