#!/usr/bin/env bash
#
# Manage the self-signed macOS code-signing certificate. See docs/gotchas.md.
#
# Usage:
#   bun run cert --create            # create (no-op if it already exists)
#   bun run cert --create --force    # delete existing, then recreate
#   bun run cert --remove            # delete it
#
# The cert name defaults to "Karttapallo Signing" (the identity hardcoded in
# electrobun.config.ts); pass an explicit name as a positional arg to override.
#
set -euo pipefail

ACTION=""
FORCE=0
ARG_NAME=""
for a in "$@"; do
  case "$a" in
    --create) ACTION="create" ;;
    --remove) ACTION="remove" ;;
    --force | --recreate) FORCE=1 ;;
    -*)
      echo "unknown option: $a" >&2
      exit 2
      ;;
    *) ARG_NAME="$a" ;;
  esac
done

if [[ -z "$ACTION" ]]; then
  echo "usage: bun run cert --create [--force] | --remove" >&2
  exit 2
fi

# Cert name: explicit arg, else the project default (matches the identity
# hardcoded in electrobun.config.ts).
NAME="${ARG_NAME:-Karttapallo Signing}"

exists() { security find-identity -p codesigning | grep -qF "$NAME"; }

remove_cert() {
  security delete-identity -c "$NAME" >/dev/null 2>&1 || true
  echo "✓ Removed code-signing identity \"$NAME\" (if it existed)."
}

if [[ "$ACTION" == "remove" ]]; then
  remove_cert
  exit 0
fi

# ACTION == create
if exists; then
  if [[ "$FORCE" == 1 ]]; then
    remove_cert
  else
    echo "✓ Code-signing identity \"$NAME\" already exists — nothing to do."
    echo "  Recreate with: bun run cert --create --force"
    exit 0
  fi
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Creating self-signed code-signing certificate \"$NAME\"…"

# 10-year self-signed cert. All three extensions matter — without
# keyUsage=digitalSignature, `codesign` won't recognize the identity and every
# sign fails with "no identity found" (the codeSigning EKU alone isn't enough).
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -subj "/CN=$NAME" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" \
  -keyout "$TMP/k.key" -out "$TMP/k.crt" 2>/dev/null

# -legacy + -macalg sha1 + a non-empty password are REQUIRED — OpenSSL 3's
# defaults produce a PKCS#12 that macOS's `security import` rejects.
# Name the p12 file after the identity (no extension): macOS labels the imported
# private key with the p12's basename, and openssl's -name only labels the cert.
# Without this the key shows in Keychain Access as "k.p12" instead of the name.
openssl pkcs12 -export -legacy -macalg sha1 -name "$NAME" \
  -inkey "$TMP/k.key" -in "$TMP/k.crt" -out "$TMP/$NAME" -passout pass:x 2>/dev/null

# -A makes the private key usable by any app without an interactive "Always
# Allow" — required so Electrobun's spawned `codesign` can use it during
# `install:app` (otherwise every binary fails with "no identity found").
security import "$TMP/$NAME" -f pkcs12 \
  -k "$HOME/Library/Keychains/login.keychain-db" \
  -P x -A -T /usr/bin/codesign >/dev/null

# Touch the key once so any first-use keychain dialog happens here, not mid-build.
cp /bin/echo "$TMP/warmup"
codesign --force --sign "$NAME" "$TMP/warmup" >/dev/null 2>&1 || true

echo "✓ Imported \"$NAME\" into the login keychain."
