#!/usr/bin/env bash
# Create the GitHub repository, push, and publish the 1.1.0 release.
#
# Run by hand, once, after deciding the repository should be public. It does
# nothing that is not printed first:
#   1. creates github.com/$OWNER/juno-monad (public) and pushes main, which
#      starts CI (.github/workflows/ci.yml);
#   2. publishes release v1.1.0 with the APK, the iOS Simulator zip and
#      SHA256SUMS from $BUILDS.
#
#   OWNER=nickthelegend BUILDS=~/Desktop/juno-builds/monad-v1.1.0 bash scripts/publish-github.sh
set -euo pipefail

OWNER="${OWNER:-nickthelegend}"
REPO="$OWNER/juno-monad"
BUILDS="${BUILDS:-$HOME/Desktop/juno-builds/monad-v1.1.0}"
TAG="v1.1.0"

cd "$(dirname "$0")/.."
gh auth status >/dev/null

for file in juno-monad-1.1.0-arm64.apk juno-monad-1.1.0-ios-simulator.zip SHA256SUMS; do
  [ -f "$BUILDS/$file" ] || { echo "Missing $BUILDS/$file" >&2; exit 1; }
done
(cd "$BUILDS" && shasum -a 256 -c SHA256SUMS)

if git remote get-url origin >/dev/null 2>&1; then
  echo "origin exists: $(git remote get-url origin)"
  git push -u origin main
else
  echo "Creating $REPO (public) and pushing main"
  gh repo create "$REPO" --public --source . --remote origin --push \
    --description "Every post is a market: a creator-coin launchpad and social app on Monad"
fi

echo "Publishing $TAG"
gh release create "$TAG" \
  "$BUILDS/juno-monad-1.1.0-arm64.apk" \
  "$BUILDS/juno-monad-1.1.0-ios-simulator.zip" \
  "$BUILDS/SHA256SUMS" \
  --repo "$REPO" --target main --title "Juno on Monad 1.1.0" --notes-file docs/releases/v1.1.0.md

echo "Done: https://github.com/$REPO — CI: https://github.com/$REPO/actions"
