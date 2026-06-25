#!/usr/bin/env bash
# Minimal deterministic fake ghq for integration tests.
set -euo pipefail
case "${1:-}" in
  --version)
    echo "ghq fake 1.0.0"
    ;;
  root)
    echo "${GHQ_ROOT:?GHQ_ROOT unset}"
    ;;
  get)
    src="${2:?missing source}"
    dest="${GHQ_ROOT}/${src}"
    if [ -d "$dest" ]; then
      exit 0
    fi
    remote="${REMOTES:-${GHQ_ROOT}/remotes}/${src//\//__}.git"
    if [ ! -d "$remote" ]; then
      echo "fake-ghq: remote not found: $remote" >&2
      exit 1
    fi
    mkdir -p "$(dirname "$dest")"
    git clone --quiet "$remote" "$dest" >&2
    ;;
  list)
    # support: list (all) | list --full-path --exact <source>
    src=""
    shift # drop "list"
    while [ $# -gt 0 ]; do
      case "$1" in
        --full-path|--exact) shift ;;
        *) src="$1"; shift ;;
      esac
    done
    if [ -z "$src" ]; then
      find "$GHQ_ROOT" -type d -name '.git' -print | while read g; do
        rel="${g#$GHQ_ROOT/}"
        echo "${rel%/.git}"
      done
    else
      dest="${GHQ_ROOT}/${src}"
      if [ -d "$dest" ]; then
        echo "$dest"
      fi
    fi
    ;;
  *)
    echo "fake-ghq: unsupported args: $*" >&2
    exit 1
    ;;
esac
