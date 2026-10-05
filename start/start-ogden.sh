#!/bin/sh
# Start Ogden Agents (macOS: "Start Ogden.command", Linux: start-ogden.sh; the
# two files are identical). Double-click it, or run it from a terminal.
#
# It checks that Node.js is installed and new enough, then runs the same
# command a terminal user types, `npx ogden-agents`, which starts Ogden Agents
# and opens it in your browser. It never installs anything itself, never asks
# for an administrator password, and never downloads and runs a script.
#
#   --check   Only report what was found (Node.js, npm, the package it would
#             run) and exit: 0 when Ogden Agents can start. Opens nothing.
#   Any other arguments go to Ogden Agents itself (for example --no-open,
#   --port 5000).
#
# Environment: OGDEN_AGENTS_DATA_DIR (where Ogden Agents keeps its data) is
# passed through. OGDEN_AGENTS_PACKAGE overrides the package npx runs
# (default ogden-agents@latest; for example ogden-agents@next).
# OGDEN_START_NO_PAUSE=1 never waits for a key (for automation).

# The minimum Node.js major version: package.json "engines" (a test keeps them equal).
MIN_NODE_MAJOR=24
NODE_DOWNLOAD_URL="https://nodejs.org/en/download"
PACKAGE="${OGDEN_AGENTS_PACKAGE:-ogden-agents@latest}"

CHECK=0
if [ "${1:-}" = "--check" ]; then
  CHECK=1
  shift
fi

# Keeps a double-clicked window open so the message can be read.
pause_on_error() {
  if [ "$CHECK" = 0 ] && [ "${OGDEN_START_NO_PAUSE:-}" != 1 ] && [ -t 0 ]; then
    echo
    printf 'Press Return to close this window. '
    read -r _ || true
  fi
}

open_node_download_page() {
  [ "$CHECK" = 1 ] && return 0
  echo "Opening the Node.js download page in your browser: $NODE_DOWNLOAD_URL"
  case "$(uname -s 2>/dev/null)" in
    Darwin) open "$NODE_DOWNLOAD_URL" >/dev/null 2>&1 || true ;;
    *)
      if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$NODE_DOWNLOAD_URL" >/dev/null 2>&1 &
      fi
      ;;
  esac
}

# $1: what is wrong, in one sentence.
need_node() {
  echo
  echo "Ogden Agents can't start yet: $1"
  echo
  echo "Ogden Agents needs Node.js $MIN_NODE_MAJOR or later. To install it:"
  echo "  1. Go to $NODE_DOWNLOAD_URL"
  echo "  2. Download and run the installer for your computer (the LTS version is fine)."
  if [ "$(uname -s 2>/dev/null)" != Darwin ]; then
    echo "     On Linux you can also use your package manager or a version manager such as nvm."
  fi
  echo "  3. Close this window, then start Ogden Agents again."
  echo
  echo "Nothing was installed or changed on your computer."
  open_node_download_page
  pause_on_error
  exit 1
}

if ! command -v node >/dev/null 2>&1; then
  need_node "Node.js is not installed, no node command was found."
fi

NODE_VERSION="$(node --version 2>/dev/null)"
NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
case "$NODE_MAJOR" in
  '' | *[!0-9]*) need_node "the installed Node.js did not report its version (\"node --version\" printed \"$NODE_VERSION\")." ;;
esac
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  need_node "the installed Node.js is $NODE_VERSION, which is too old."
fi

if ! command -v npx >/dev/null 2>&1; then
  need_node "Node.js $NODE_VERSION is installed, but its npx command is missing. Reinstalling Node.js brings it back."
fi

if [ "$CHECK" = 1 ]; then
  echo "Node.js: $NODE_VERSION ($(command -v node))"
  echo "npm: $(npm --version 2>/dev/null || echo 'not found')"
  echo "npx: $(command -v npx)"
  echo "Package: $PACKAGE"
  echo "Data folder: ${OGDEN_AGENTS_DATA_DIR:-the default for this computer}"
  echo "Ready: Ogden Agents can start."
  exit 0
fi

echo "Starting Ogden Agents with Node.js $NODE_VERSION. The first start downloads it, which can take a minute."
npx --yes "--package=$PACKAGE" ogden "$@"
STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  echo
  echo "Ogden Agents did not start (exit code $STATUS). The messages above say why."
  echo "Check your internet connection for the first start, then try again."
  pause_on_error
  exit "$STATUS"
fi
exit 0
