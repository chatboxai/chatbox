#!/usr/bin/env bash

set -euo pipefail

mode="${1:-repo}"
remote="${2:-origin}"
branch="${3:-$(git branch --show-current)}"

if ! git remote get-url "$remote" >/dev/null 2>&1; then
  echo "Remote '$remote' does not exist" >&2
  exit 1
fi

url="$(git remote get-url "$remote")"

case "$url" in
  git@github.com:*)
    repo="${url#git@github.com:}"
    ;;
  https://github.com/*)
    repo="${url#https://github.com/}"
    ;;
  ssh://git@github.com/*)
    repo="${url#ssh://git@github.com/}"
    ;;
  *)
    echo "Unsupported GitHub remote URL: $url" >&2
    exit 1
    ;;
esac

repo="${repo%.git}"
owner="${repo%%/*}"

case "$mode" in
  repo)
    printf '%s\n' "$repo"
    ;;
  owner)
    printf '%s\n' "$owner"
    ;;
  branch)
    printf '%s\n' "$branch"
    ;;
  head)
    printf '%s:%s\n' "$owner" "$branch"
    ;;
  ensure-default)
    gh repo set-default "$repo" >/dev/null
    printf '%s\n' "$repo"
    ;;
  *)
    echo "Usage: $0 [repo|owner|branch|head|ensure-default] [remote] [branch]" >&2
    exit 1
    ;;
esac
