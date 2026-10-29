#!/usr/bin/env bash
set -euo pipefail

repo_url='https://github.com/mishraaakash196-create/aurum-gold-command.git'
branch='main'
: "${GITHUB_TOKEN:?Set GITHUB_TOKEN in your shell first; do not paste it into chat or the command line.}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git init -b "$branch"
fi
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$repo_url"
else
  git remote add origin "$repo_url"
fi
current_branch=$(git branch --show-current || true)
if [[ "$current_branch" != "$branch" ]]; then
  git branch -M "$branch"
fi

author_name=${GIT_AUTHOR_NAME:-'AURUM Release Automation'}
author_email=${GIT_AUTHOR_EMAIL:-'aurum-release@users.noreply.github.com'}
git add -A
if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  git -c user.name="$author_name" -c user.email="$author_email" commit -m 'Production hardening and durable storage'
elif ! git diff --cached --quiet; then
  git -c user.name="$author_name" -c user.email="$author_email" commit -m 'Production hardening and durable storage'
fi

umask 077
askpass=$(mktemp)
trap 'rm -f "$askpass"' EXIT
cat > "$askpass" <<'ASKPASS'
#!/bin/sh
case "$1" in
  *Username*) printf '%s\n' 'x-access-token' ;;
  *Password*) printf '%s\n' "$GITHUB_TOKEN" ;;
  *) exit 1 ;;
esac
ASKPASS
chmod 700 "$askpass"
GIT_ASKPASS="$askpass" GIT_TERMINAL_PROMPT=0 git push -u origin "$branch"
