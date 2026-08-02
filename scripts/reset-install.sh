#!/usr/bin/env bash
#
# Return the Mac to the state it was in before Karttapallo was ever installed,
# so the next `bun run install:app` exercises a genuine first launch.
#
# Usage:
#   bun run reset:install               # the real thing; needs sudo, see below
#   bun run reset:install --keep-fda    # everything except Full Disk Access, for
#                                       # iterating without re-granting by hand
#
# Two of the things it removes are not findable from the source: the WebKit data
# store, which WKWebView creates on its own, and the TCC grants, which are not
# files at all. A third is easy to miss because its name is the bundle id rather
# than the app's: Electrobun's self-extraction staging area, holding the ~78 MB
# payload tarball that the --env=stable self-extractor unpacks on first launch.
#
# Three TCC grants go, and they do not come back the same way. Two re-prompt on
# their own, so the app asks for them again exactly as it would on a stranger's
# Mac:
#
#   AppleEvents           Only prompts when an Apple Event is actually sent,
#                         which is the write path. Launching and browsing never
#                         sends one — save an edit to see "Karttapallo wants to
#                         control Photos".
#   SystemPolicyAppData   Prompts on launch ("...wants to access data from other
#                         apps"). See docs/gotchas.md on why an ad-hoc-signed
#                         build re-prompts every single launch.
#
# The third, Full Disk Access, does NOT re-prompt. The app has to be re-added by
# hand under System Settings ▸ Privacy & Security ▸ Full Disk Access, and until
# it is, it cannot read a Library at all — that manual step is the whole cost of
# running this, and --keep-fda is how you skip it. FDA also needs sudo, because
# unlike the other two it lives in the root-owned system TCC database rather
# than the user's. That same database is why FDA otherwise survives a reinstall
# untouched: TCC keys it on bundle id plus signing identity, not on the file, so
# rebuilding with the same identity inherits the grant — which is exactly why a
# reinstall alone never tests what a first install does.
#
# What this never touches is <library>/karttapallo/ — the bundle store (ADR-0015)
# is inside the Library and holds work the user authored: saved view, routes,
# tracks, notes. A true first install has none of it, so delete a library's store
# by hand if that is the state you want to test.
#
set -euo pipefail

APP_ID="com.karttapallo.app"
APP="/Applications/Karttapallo.app"

RESET_FDA=1
for a in "$@"; do
  case "$a" in
    --keep-fda) RESET_FDA=0 ;;
    *)
      echo "unknown option: $a" >&2
      exit 2
      ;;
  esac
done

if pgrep -qf "$APP"; then
  echo "reset-install: Karttapallo is running — quit it first" >&2
  exit 1
fi

# Before the bundle goes: tccutil resolves a bundle id through LaunchServices,
# which stops resolving it once the bundle is gone (-10814). LaunchServices can
# hold a stale record for a while, so removing the app first fails only
# sometimes — the worst kind of ordering bug, and the reason for this one. It
# also means a cancelled sudo prompt aborts before anything has been deleted.
tccutil reset AppleEvents "$APP_ID"
tccutil reset SystemPolicyAppData "$APP_ID"
if ((RESET_FDA)); then
  sudo tccutil reset SystemPolicyAllFiles "$APP_ID"
fi

# Every path the app leaves outside a Library. All of it is derived: rebuilt on
# the next launch from the Library plus the app bundle.
PATHS=(
  "$APP"
  "$HOME/Library/Application Support/Karttapallo"    # window state
  "$HOME/Library/Application Support/$APP_ID"        # Electrobun self-extraction
  "$HOME/Library/Caches/Karttapallo"                 # items.json, owner.json, thumbnails
  "$HOME/Library/WebKit/$APP_ID"                     # WKWebView data store
)

for p in "${PATHS[@]}"; do
  if [[ -e "$p" ]]; then
    printf 'removing %s (%s)\n' "${p/#$HOME/\~}" "$(du -sh "$p" | cut -f1 | tr -d ' ')"
    rm -rf "$p"
  fi
done
