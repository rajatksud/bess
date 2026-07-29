#!/usr/bin/env bash
# Pull the latest bess-calc app code (developed in Google AI Studio) into
# bess/bess-calc/ via git subtree, then drop the duplicated docs/readme/
# gitignore that bess-calc still carries but bess keeps only at the repo root.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if ! git remote get-url bess-calc >/dev/null 2>&1; then
  echo "Adding bess-calc remote..."
  git remote add bess-calc git@github.com:rajatksud/bess-calc.git
fi

git fetch bess-calc
git subtree pull --prefix=bess-calc bess-calc main --squash -m "Sync bess-calc from AI Studio"

dupes=(bess-calc/docs bess-calc/readme.md bess-calc/.gitignore)
to_remove=()
for path in "${dupes[@]}"; do
  if [ -e "$path" ]; then
    to_remove+=("$path")
  fi
done

if [ "${#to_remove[@]}" -gt 0 ]; then
  git rm -rq "${to_remove[@]}"
  git commit -m "Remove duplicated docs from bess-calc sync"
else
  echo "No duplicated docs/readme/gitignore to remove."
fi

echo "Sync complete. Review with: git log --oneline -5"
