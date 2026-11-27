# Decides whether this run of shorts-studio uses the sandbox, and sets it up when it does.
# Source it, don't run it, with `checkout` set to the checkout's folder:
#
#   checkout=/path/to/shorts-studio . scripts/dev-sandbox.sh || exit 2
#
# The sandbox keeps branch code away from the user's posts, keys and money: posts and data go to
# a scratch folder, every paid provider to a port that refuses connections, every key is fake,
# and Keychain lookups ask for an account that doesn't exist. It's on in a linked worktree and
# off in the main checkout; SHORTS_SANDBOX=1 or 0 says otherwise. bin/shorts-studio and the
# verify skill source it. It prints nothing on standard output, so --json and MCP stay clean;
# a mistake goes to standard error and returns 2.
# shellcheck disable=SC2154 # `checkout` comes from the file that sources this one.

if [ -z "${checkout:-}" ]; then
	echo "dev-sandbox.sh: set checkout to the checkout's folder before sourcing it." >&2
	return 2
fi

# True when $checkout is a linked worktree: it has a git folder of its own, besides the one every
# checkout shares. Git exports GIT_DIR and the like to its hooks, which would make it describe
# another checkout, so they're left out here.
shorts_sandbox_in_worktree() {
	shorts_sandbox_own=$(env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_COMMON_DIR \
		git -C "$checkout" rev-parse --absolute-git-dir 2>/dev/null) || return 1
	shorts_sandbox_shared=$(env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_COMMON_DIR \
		git -C "$checkout" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
	[ "$shorts_sandbox_own" != "$shorts_sandbox_shared" ]
}

# Prints each match of a grep pattern in the providers' source files, tests left out. A provider
# declares itself on one line (`const FAL: PaidService = { id: "fal", …`), as Biome formats it;
# scripts/dev-sandbox.test.ts fails if a declaration ever stops matching.
shorts_sandbox_declared() {
	for shorts_sandbox_file in "$checkout"/packages/providers/src/*.ts; do
		case "$shorts_sandbox_file" in *.test.ts) continue ;; esac
		[ -f "$shorts_sandbox_file" ] && grep -ho "$1" "$shorts_sandbox_file"
	done
	return 0
}

case "${SHORTS_SANDBOX:-}" in
1) shorts_sandbox_on=1 ;;
0) shorts_sandbox_on=0 ;;
'')
	if shorts_sandbox_in_worktree; then shorts_sandbox_on=1; else shorts_sandbox_on=0; fi
	;;
*)
	echo "shorts-studio: SHORTS_SANDBOX is \"$SHORTS_SANDBOX\"; set it to 1 (sandbox on) or 0 (off), or unset it." >&2
	return 2
	;;
esac

if [ "$shorts_sandbox_on" = 1 ]; then
	shorts_sandbox_dir=${SHORTS_SANDBOX_DIR:-$checkout/.sandbox}
	case "$shorts_sandbox_dir" in
	/*) ;;
	*)
		echo "shorts-studio: SHORTS_SANDBOX_DIR is \"$shorts_sandbox_dir\"; give an absolute path." >&2
		return 2
		;;
	esac

	export SHORTS_DATA_DIR="$shorts_sandbox_dir/data" SHORTS_POSTS_DIR="$shorts_sandbox_dir/posts"
	mkdir -p "$SHORTS_DATA_DIR" "$SHORTS_POSTS_DIR" || return 2

	# Node's fetch refuses port 9 before sending anything, so no paid request leaves the machine.
	for shorts_sandbox_id in $(shorts_sandbox_declared 'PaidService = { id: "[a-z0-9-]*"' | grep -o '"[a-z0-9-]*"' | tr -d '"'); do
		export "SHORTS_$(printf '%s' "$shorts_sandbox_id" | tr 'a-z-' 'A-Z_')_URL=http://127.0.0.1:9"
	done
	# A key that is set, even to a fake value, is never looked up in the Keychain.
	for shorts_sandbox_key in $(shorts_sandbox_declared 'KeySpec = { env: "[A-Z0-9_]*"' | grep -o '"[A-Z0-9_]*"' | tr -d '"'); do
		export "$shorts_sandbox_key=fake-sandbox-key"
	done
	# Keychain lookups name $USER as the account (packages/providers/src/node.ts), so a key the
	# loop above missed still finds nothing.
	export USER=shorts-sandbox
fi

unset shorts_sandbox_own shorts_sandbox_shared shorts_sandbox_file shorts_sandbox_on \
	shorts_sandbox_dir shorts_sandbox_id shorts_sandbox_key
unset -f shorts_sandbox_in_worktree shorts_sandbox_declared
