# Pull the latest bess-calc app code (developed in Google AI Studio) into
# bess/bess-calc/ via git subtree, then drop the duplicated docs/readme/
# gitignore that bess-calc still carries but bess keeps only at the repo root.
$ErrorActionPreference = "Stop"

$repoRoot = git rev-parse --show-toplevel
Set-Location $repoRoot

$remoteExists = git remote get-url bess-calc 2>$null
if (-not $remoteExists) {
    Write-Host "Adding bess-calc remote..."
    git remote add bess-calc git@github.com:rajatksud/bess-calc.git
}

git fetch bess-calc
git subtree pull --prefix=bess-calc bess-calc main --squash -m "Sync bess-calc from AI Studio"

$dupes = @("bess-calc/docs", "bess-calc/readme.md", "bess-calc/.gitignore")
$toRemove = $dupes | Where-Object { Test-Path $_ }

if ($toRemove.Count -gt 0) {
    git rm -rq @toRemove
    git commit -m "Remove duplicated docs from bess-calc sync"
} else {
    Write-Host "No duplicated docs/readme/gitignore to remove."
}

Write-Host "Sync complete. Review with: git log --oneline -5"
