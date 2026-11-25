# Source this, don't run it: `. .agents/skills/verify/scripts/sandbox.sh`
#
# Points shorts-studio at scratch folders, fake keys and a dead port, so a verify run spends
# nothing and touches none of the user's posts, data or Keychain keys. The provider list comes
# from the code (each `PaidService` id and each `KeySpec` env name), so a new provider is covered
# without editing this file.

repo="$(git rev-parse --show-toplevel)" || return 1
providers="$repo/packages/providers/src"

SANDBOX="${SANDBOX:-$(mktemp -d "${TMPDIR:-/tmp}/shorts-verify.XXXXXX")}" || return 1
export SANDBOX
export SHORTS_DATA_DIR="$SANDBOX/data" SHORTS_POSTS_DIR="$SANDBOX/posts"
mkdir -p "$SHORTS_DATA_DIR" "$SHORTS_POSTS_DIR" "$SANDBOX/media"

# Node's fetch refuses port 9 before sending anything, so a provider call fails on this machine.
for id in $(grep -ho 'PaidService = { id: "[a-z0-9-]*"' $(ls "$providers"/*.ts | grep -v "\.test\.ts$") | grep -o '"[a-z0-9-]*"' | tr -d '"'); do
	variable="SHORTS_$(printf '%s' "$id" | tr 'a-z-' 'A-Z_')_URL"
	export "$variable=http://127.0.0.1:9"
	echo "verify sandbox: $variable=http://127.0.0.1:9"
done

# A fake value for every key, so nothing falls back to the user's Keychain.
for key in $(grep -ho 'KeySpec = { env: "[A-Z0-9_]*"' $(ls "$providers"/*.ts | grep -v "\.test\.ts$") | grep -o '"[A-Z0-9_]*"' | tr -d '"'); do
	export "$key=fake-verify-key"
	echo "verify sandbox: $key set to a fake value"
done

echo "verify sandbox: posts and data under $SANDBOX"
