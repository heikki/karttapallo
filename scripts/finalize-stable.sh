#!/usr/bin/env bash
#
# Finalize the signed --env=stable bundle so Photos automation actually works.
#
# Under the hardened runtime an Apple Event send is auto-denied with
# errAEEventNotPermitted (-1743) — and macOS shows NO consent prompt — unless
# the app's Info.plist carries NSAppleEventsUsageDescription. Electrobun's CLI
# has an entitlement->usage-description map, but it does NOT include
# apple-events, and the CLI ships as a prebuilt binary (the `electrobun` npm bin
# downloads and runs it), so the map can't be patched from source. So we inject
# the key post-build.
#
# The catch: an --env=stable build is a SELF-EXTRACTOR. The real app bundle
# lives compressed in Contents/Resources/<hash>.tar.zst and is unpacked over the
# bundle on first launch. Patching only the outer Contents/Info.plist is
# useless — extraction overwrites it with the stale payload copy (this is
# exactly the bug that made the prompt never appear). So we patch the payload's
# Info.plist too, re-sign that inner bundle, and repack the tarball. The tarball
# is created by Electrobun with a plain `tar -cf` of `Karttapallo.app`, so we
# repack the same way.
#
# Idempotent: safe to re-run.
set -euo pipefail

APP="build/stable-macos-arm64/Karttapallo.app"
ENT="build/stable-macos-arm64/entitlements.plist"
IDENTITY="${ELECTROBUN_DEVELOPER_ID:-Karttapallo Signing}"
# A single space, not a sentence: macOS's own prompt text already says what
# granting Automation means, and anything here is appended in the app's language
# regardless of the system's — an English line under a Finnish prompt. The value
# must stay non-empty though; the key going missing is what makes macOS
# auto-deny with no prompt at all (see the header above).
USAGE=" "

if [[ ! -d "$APP" ]]; then
  echo "finalize-stable: $APP not found — run build:app:stable first" >&2
  exit 1
fi
if [[ ! -f "$ENT" ]]; then
  echo "finalize-stable: $ENT not found — expected Electrobun's entitlements" >&2
  exit 1
fi

TAR=$(ls "$APP"/Contents/Resources/*.tar.zst 2>/dev/null | head -1)
if [[ -z "$TAR" ]]; then
  echo "finalize-stable: self-extractor payload (*.tar.zst) not found in $APP" >&2
  exit 1
fi

# Set (add-or-overwrite) NSAppleEventsUsageDescription on a bundle's Info.plist.
# plutil rather than PlistBuddy: PlistBuddy takes the value from its -c command
# string and splits on whitespace, so a whitespace-only USAGE collapses to
# nothing. plutil takes the value as its own argument and preserves it. It also
# add-or-overwrites in one call, so no Set-then-Add fallback is needed.
set_usage_key() {
  local plist="$1"
  /usr/bin/plutil -replace NSAppleEventsUsageDescription -string "$USAGE" "$plist"
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1. Unpack the payload, patch the INNER bundle's Info.plist, and re-sign that
#    bundle so its own seal (Contents/_CodeSignature) covers the new plist.
zstd -dc "$TAR" | tar -xf - -C "$WORK"
set_usage_key "$WORK/Karttapallo.app/Contents/Info.plist"
codesign --force --sign "$IDENTITY" --entitlements "$ENT" --options runtime \
  "$WORK/Karttapallo.app"

# 2. Repack exactly as Electrobun does (`tar -cf` of Karttapallo.app), recompress
#    to the same filename so metadata.json's hash reference still resolves.
tar -cf "$WORK/payload.tar" -C "$WORK" Karttapallo.app
zstd -q -f -o "$TAR" "$WORK/payload.tar"

# 3. Patch the OUTER (self-extractor stub) Info.plist too, then re-seal the outer
#    bundle — we just changed a sealed resource (the tarball).
set_usage_key "$APP/Contents/Info.plist"
codesign --force --sign "$IDENTITY" --entitlements "$ENT" --options runtime "$APP"

# 4. Verify both copies carry the key and the entitlement survived.
zstd -dc "$TAR" | tar -xOf - Karttapallo.app/Contents/Info.plist \
  | grep -q NSAppleEventsUsageDescription
/usr/libexec/PlistBuddy -c "Print :NSAppleEventsUsageDescription" "$APP/Contents/Info.plist" >/dev/null
codesign -d --entitlements - "$APP" 2>/dev/null | grep -q apple-events

echo "finalize-stable: usage key injected into payload + outer bundle, both re-signed"
