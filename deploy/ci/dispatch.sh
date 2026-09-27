#!/usr/bin/env bash
# Validated arguments intentionally expand locally before the remote shell runs.
# shellcheck disable=SC2029
set -Eeuo pipefail
umask 077

mode=${1:?Expected deploy or rollback}
[[ $mode == deploy || $mode == rollback ]] || exit 2
: "${DEPLOY_HOST:?Missing Production DEPLOY_HOST secret}"
: "${DEPLOY_USER:?Missing Production DEPLOY_USER secret}"
: "${DEPLOY_SSH_KEY:?Missing Production DEPLOY_SSH_KEY secret}"
: "${DEPLOY_KNOWN_HOSTS:?Missing verified Production DEPLOY_KNOWN_HOSTS secret}"
[[ $DEPLOY_HOST =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || exit 2
[[ $DEPLOY_USER =~ ^[a-z_][a-z0-9_-]*$ ]] || exit 2

if [[ $mode == deploy ]]; then
  : "${GHCR_TOKEN:?Missing registry token}"
  [[ ${GHCR_USER:-} =~ ^[a-zA-Z0-9_-]+$ ]] || exit 2
  [[ ${DEPLOY_SHA:-} =~ ^[a-f0-9]{40}$ ]] || exit 2
  [[ ${WEB_IMAGE:-} =~ ^ghcr.io/yingxuanhu/applyoverflow-web@sha256:[a-f0-9]{64}$ ]] || exit 2
  [[ ${MIGRATION_IMAGE:-} =~ ^ghcr.io/yingxuanhu/applyoverflow-migrations@sha256:[a-f0-9]{64}$ ]] || exit 2
fi

temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
printf '%s\n' "$DEPLOY_SSH_KEY" > "$temporary/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$temporary/known_hosts"
unset DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS
connection=( -i "$temporary/key" -o IdentitiesOnly=yes -o BatchMode=yes
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$temporary/known_hosts"
  -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 )
target="$DEPLOY_USER@$DEPLOY_HOST"
# A fixed, validated path avoids remote shell interpolation of user-supplied values.
remote="/tmp/applyoverflow-ci-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}.sh"
[[ $GITHUB_RUN_ID =~ ^[0-9]+$ && $GITHUB_RUN_ATTEMPT =~ ^[0-9]+$ ]] || exit 2
scp "${connection[@]}" deploy/ci/remote-release.sh "$target:$remote"
if [[ $mode == deploy ]]; then
  printf '%s\n' "$GHCR_TOKEN" | ssh "${connection[@]}" "$target" \
    "bash '$remote' deploy '$DEPLOY_SHA' '$WEB_IMAGE' '$MIGRATION_IMAGE' '$GHCR_USER'; result=\$?; rm -f '$remote'; exit \$result"
else
  ssh "${connection[@]}" "$target" \
    "bash '$remote' rollback; result=\$?; rm -f '$remote'; exit \$result"
fi
