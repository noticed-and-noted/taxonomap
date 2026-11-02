#!/usr/bin/env bash
# Deletes a pull request's preview deployments, on Cloudflare Pages and on GitHub, so only the
# newest commit has one (KEEP=latest, after a deploy) or none does (KEEP=none, once it closes).
#
# Environment:
#   PROJECT        Cloudflare Pages project
#   BRANCH         the preview's Cloudflare branch (pr-<number>)
#   KEEP           latest | none
#   KEEP_ID        with KEEP=latest: the Cloudflare deployment just made (else the newest is kept)
#   HEAD_REF       the pull request's head branch, which names its GitHub deployments
#   GH_REPO, GH_TOKEN, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
set -euo pipefail

# The environment wrangler-action files every Pages preview under on GitHub.
readonly GITHUB_ENVIRONMENT=preview

wrangler() {
  npx --yes wrangler@4 "$@" < /dev/null
}

# Cloudflare deployment IDs for the branch, newest first. The list holds the project's newest
# 25 deployments; pruning after every deploy keeps a pull request's older ones within it.
cloudflare_ids() {
  wrangler pages deployment list --project-name="$PROJECT" --environment=preview --json \
    | jq -r --arg branch "$BRANCH" '[.[] | select(.Branch == $branch)] | .[].Id'
}

prune_cloudflare() {
  local ids keep
  ids=$(cloudflare_ids)
  keep=""
  if [[ "$KEEP" == latest ]]; then
    keep=${KEEP_ID:-$(head -n 1 <<< "$ids")}
  fi
  for id in $ids; do
    [[ "$id" == "$keep" ]] && continue
    echo "Deleting Cloudflare deployment $id"
    # --force: the branch's alias may still point at it.
    wrangler pages deployment delete "$id" --project-name="$PROJECT" --force
  done
}

# GitHub deployment IDs for the pull request's branch, newest first (the API's order).
github_ids() {
  gh api --paginate "repos/$GH_REPO/deployments?environment=$GITHUB_ENVIRONMENT&ref=$HEAD_REF" --jq '.[].id'
}

prune_github() {
  local ids
  ids=$(github_ids)
  if [[ "$KEEP" == latest ]]; then
    ids=$(tail -n +2 <<< "$ids")
  fi
  for id in $ids; do
    echo "Deleting GitHub deployment $id"
    # Only an inactive deployment can be deleted.
    gh api --silent -X POST "repos/$GH_REPO/deployments/$id/statuses" -f state=inactive
    gh api --silent -X DELETE "repos/$GH_REPO/deployments/$id"
  done
}

case "$KEEP" in
  latest | none) ;;
  *)
    echo "KEEP must be latest or none, not '$KEEP'" >&2
    exit 1
    ;;
esac

prune_cloudflare
prune_github
