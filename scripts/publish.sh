#!/usr/bin/env bash

# Due to the strange behavior in npm@3 of running prepublish scripts during npm install,
# this script is designed as a replacement for `npm publish` for correctly preparing,
# building, publishing, and verifying this package.

usage() {
    echo "usage: $0 [branch-name]"
    echo
    echo "Builds, publishes, and verifies a release from the given branch name"
    echo
    echo "If branch-name is not given, HEAD is used as the release branch"
    exit 0
}

error() {
    echo "error: $1"
    exit "${2:-1}"
}

confirm()  {
    echo -n "$1 [yN]: "
    read -r confirm
    [[ "$confirm" != "y" ]] && [[ "$confirm" != "Y" ]] && error "user aborted"
}

package_json() {
    node -e "console.log(require('./package.json').$1)"
}

# check preconditions
# make sure we can read the package.json
[[ -f package.json ]] || error "could not locate package.json in directory $(pwd). Publish must be run from the package root."
git rev-parse --abbrev-ref "${1:-HEAD}" >/dev/null 2>&1 || error "branch $1 does not exist"
PACKAGE_NAME="$(package_json 'name')"
PACKAGE_VERSION="$(package_json 'version')"
BRANCH_NAME="$(git rev-parse --abbrev-ref "${1:-HEAD}")"

# warn if release is not rel/something
[[ "$BRANCH_NAME" == "rel/*" ]] || \
confirm "Branch $BRANCH_NAME does not look like a release branch. Are you sure you want to publish this branch?"

# make sure the working directory is clean
[[ -z "$(git status --porcelain)" ]] || error "working directory not clean"

# install
npm install

# build
npm run build
echo "executing dry run publish of $PACKAGE_NAME@$PACKAGE_VERSION from branch $BRANCH_NAME..."
npm publish --dry-run
confirm "Does everything look ok?"

echo
echo "publishing package with the following details to npm:"
echo "package: $PACKAGE_NAME"
echo "version: $PACKAGE_VERSION"
echo "branch: $BRANCH_NAME"
echo "commit: $(git rev-parse HEAD)"
echo "date: $(date)"
echo
confirm "confirm publish"

echo -n "enter OTP: "
read -r otp
npm publish --otp="$otp"

# verify package
echo "verifying correct publish of $PACKAGE_NAME@$PACKAGE_VERSION"
cd "$(mktemp -d)" || error "cd to temp directory failed. Verify package manually."
npm init -y >/dev/null 2>&1 || error "npm init failed. Verify package manually."
npm install "$PACKAGE_NAME@$PACKAGE_VERSION" >/dev/null 2>&1 || error "npm install failed! May need to unpublish!!!"
node -e "require('${PACKAGE_NAME}')" || error "node require failed! unpublish!!!"
cd "$OLDPWD" || error "cd to old pwd failed. Publish is probably alright, but verify package manually"
echo "correct publish of $PACKAGE_NAME@$PACKAGE_VERSION has been verified!"
