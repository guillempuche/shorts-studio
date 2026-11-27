# Source this, don't run it: `. .agents/skills/verify/scripts/sandbox.sh`
#
# Points shorts-studio at scratch folders, fake keys and a dead port, so a verify run spends
# nothing and touches none of the user's posts, data or Keychain keys. The sandbox itself is
# scripts/dev-sandbox.sh, which bin/shorts-studio uses in every worktree; this file gives it a
# scratch folder of its own and says what it set. The provider list comes from the code, so a new
# provider is covered without editing either file.

repo="$(git rev-parse --show-toplevel)" || return 1

# A folder of its own, never a worktree's .sandbox/, because the run ends by deleting it.
SANDBOX="${SANDBOX:-$(mktemp -d "${TMPDIR:-/tmp}/shorts-verify.XXXXXX")}" || return 1
export SANDBOX SHORTS_SANDBOX=1 SHORTS_SANDBOX_DIR="$SANDBOX"
checkout="$repo"
. "$repo/scripts/dev-sandbox.sh" || return 1
mkdir -p "$SANDBOX/media"

# Node's fetch refuses port 9 before sending anything, so a provider call fails on this machine.
env | grep '^SHORTS_[A-Z0-9_]*_URL=' | sed 's/^/verify sandbox: /'
env | grep '=fake-sandbox-key$' | sed 's/=.*/ set to a fake value/; s/^/verify sandbox: /'
echo "verify sandbox: Keychain lookups use the account $USER, which doesn't exist"
echo "verify sandbox: posts and data under $SANDBOX"
