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
#             run) and exit: 0 when Ogden Agents can start. Opens nothing and
#             never touches the network.
#   --github  Install and update from this project's GitHub Releases instead
#             of npm (same as OGDEN_AGENTS_SOURCE=github). Needs
#             ogden-install.mjs in the same folder as this script; it
#             downloads the release's tarball, checks it against
#             SHA256SUMS.txt, installs it in your own user folder (never
#             globally, no administrator rights) and starts it.
#   --check and --github come first; any other arguments go to Ogden Agents
#   itself (for example --no-open, --port 5000).
#
# Environment: OGDEN_AGENTS_DATA_DIR (where Ogden Agents keeps its data) is
# passed through. OGDEN_AGENTS_PACKAGE overrides the package npx runs
# (default ogden-agents@latest; for example ogden-agents@next).
# OGDEN_AGENTS_SOURCE is npm (the default) or github; with github,
# OGDEN_AGENTS_REPO, OGDEN_AGENTS_CHANNEL (stable or next) and
# OGDEN_AGENTS_GITHUB_TOKEN (private repositories) are read by the installer,
# see RELEASING.md. OGDEN_START_NO_PAUSE=1 never waits for a key (for
# automation).

# The minimum Node.js major version: package.json "engines" (a test keeps them equal).
MIN_NODE_MAJOR=24
NODE_DOWNLOAD_URL="https://nodejs.org/en/download"
PACKAGE="${OGDEN_AGENTS_PACKAGE:-ogden-agents@latest}"

# Where this script sits, for the GitHub installer next to it (found before
# the cd below; a bare "sh start-ogden.sh" means the current folder).
case "$0" in
  */*) SCRIPT_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)" || SCRIPT_DIR="" ;;
  *) SCRIPT_DIR="$(pwd)" ;;
esac
INSTALLER="${OGDEN_AGENTS_INSTALLER:-$SCRIPT_DIR/ogden-install.mjs}"

# Run from the home folder, as macOS does for a .command file: npx then reads
# no project config (.npmrc) or packages from the folder the script sits in.
cd "${HOME:-/}" 2>/dev/null || cd /

CHECK=0
SOURCE="${OGDEN_AGENTS_SOURCE:-npm}"
while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK=1; shift ;;
    --github) SOURCE=github; shift ;;
    *) break ;;
  esac
done
case "$SOURCE" in
  npm | github) ;;
  *)
    echo "OGDEN_AGENTS_SOURCE must be npm or github, not \"$SOURCE\"."
    exit 2
    ;;
esac

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

# npx runs the npm package; the GitHub installer runs npm itself.
if [ "$SOURCE" = npm ] && ! command -v npx >/dev/null 2>&1; then
  need_node "Node.js $NODE_VERSION is installed, but its npx command is missing. Reinstalling Node.js brings it back."
fi

# The GitHub source needs the installer file next to this script. The script
# never downloads it: download it yourself, from the same release as this script.
if [ "$SOURCE" = github ] && [ ! -f "$INSTALLER" ]; then
  echo
  echo "Ogden Agents can't start from GitHub yet: ogden-install.mjs is not next to this script."
  echo
  echo "Download ogden-install.mjs from the same GitHub Release as this script, put it in the"
  echo "same folder, and start again. The release's SHA256SUMS.txt lists it."
  echo
  echo "Nothing was installed or changed on your computer."
  pause_on_error
  exit 1
fi

if [ "$CHECK" = 1 ]; then
  echo "Node.js: $NODE_VERSION ($(command -v node))"
  echo "npm: $(npm --version 2>/dev/null || echo 'not found')"
  if [ "$SOURCE" = github ]; then
    echo "Source: GitHub Releases (installer: $INSTALLER)"
    node "$INSTALLER" status
  else
    echo "npx: $(command -v npx)"
    echo "Package: $PACKAGE"
  fi
  echo "Data folder: ${OGDEN_AGENTS_DATA_DIR:-the default for this computer}"
  echo "Ready: Ogden Agents can start."
  exit 0
fi

if [ "$SOURCE" = github ]; then
  echo "Starting Ogden Agents from GitHub Releases with Node.js $NODE_VERSION. The first start downloads it, which can take a minute."
  node "$INSTALLER" start "$@"
else
  echo "Starting Ogden Agents with Node.js $NODE_VERSION. The first start downloads it, which can take a minute."
  npx --yes "--package=$PACKAGE" ogden "$@"
fi
STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  echo
  echo "Ogden Agents did not start (exit code $STATUS). The messages above say why."
  echo "Check your internet connection for the first start, then try again."
  pause_on_error
  exit "$STATUS"
fi
exit 0
