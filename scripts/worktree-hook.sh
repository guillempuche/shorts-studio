#!/bin/sh
# What Claude Code and Codex run by themselves around a session, so an agent never has to
# remember it (docs/worktrees.md):
#
#   worktree-hook.sh session-start [--json] [--codex]
#       A session opens, resumes, clears or compacts. In a linked worktree it installs the
#       packages when they're missing or older than pnpm-lock.yaml; in any checkout it gives
#       Claude Code's shell the project's Node 26, pnpm, ffmpeg and openspec (through
#       $CLAUDE_ENV_FILE) when Nix has them and the shell's Node isn't 26. It prints a few lines
#       for the agent, the first saying whether it works on real posts or in the sandbox.
#       Always exits 0, so a session never fails to open.
#   worktree-hook.sh mcp-guard
#       Before each shorts-studio MCP tool call. In a worktree session those tools would run the
#       main checkout's code on the user's real posts, so it answers with a deny.
#
# --json reads the hook's JSON on standard input: `cwd`, `source` and `session_id`. Codex's
# setup script passes no JSON and may leave standard input open, so without --json nothing is
# read and the current folder is the session's. --codex words the lines for Codex, where nothing
# refuses the MCP tools.

set -u

mode=${1:-}
[ $# -gt 0 ] && shift
json=0
codex=0
for flag in "$@"; do
	case "$flag" in
	--json) json=1 ;;
	--codex) codex=1 ;;
	esac
done
input=''
if [ "$json" = 1 ] || [ "$mode" = mcp-guard ]; then input=$(cat 2>/dev/null || true); fi

# A string field of the hook's JSON, through jq, else Node; empty when missing or unreadable.
field() {
	[ -n "$input" ] || return 0
	if command -v jq >/dev/null 2>&1; then
		printf '%s' "$input" | jq -r --arg f "$1" '.[$f] // empty | strings' 2>/dev/null
	elif command -v node >/dev/null 2>&1; then
		printf '%s' "$input" | node -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>{try{const v=JSON.parse(t)[process.argv[1]];if(typeof v==="string")process.stdout.write(v)}catch{}})' "$1" 2>/dev/null
	fi
	return 0
}

# git in folder $1, ignoring the GIT_DIR and the like that git exports to its own hooks.
git_in() {
	git_in_folder=$1
	shift
	env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_COMMON_DIR git -C "$git_in_folder" "$@"
}

# Sets root, own (this checkout's git folder) and shared (the one every checkout shares) for the
# checkout holding folder $1. Fails outside git.
find_checkout() {
	root=$(git_in "$1" rev-parse --show-toplevel 2>/dev/null) || return 1
	own=$(git_in "$root" rev-parse --absolute-git-dir 2>/dev/null) || return 1
	shared=$(git_in "$root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
}

# A session id becomes a file name, so only plain ids count.
plain_id() {
	case "$1" in '' | *[!A-Za-z0-9_-]*) return 1 ;; esac
}

case "$mode" in
session-start) ;;
mcp-guard)
	cwd=$(field cwd)
	session=$(field session_id)
	in_worktree=0
	if [ -n "$cwd" ] && find_checkout "$cwd"; then
		[ "$own" != "$shared" ] && in_worktree=1
	# A worktree session that moved outside git is still one: session-start recorded it in the
	# shared git folder, found from the project the hooks run in. Only outside git: a session
	# back in the main checkout works on the main checkout's code, so its calls run.
	elif plain_id "$session" && find_checkout "${CLAUDE_PROJECT_DIR:-$PWD}" &&
		[ -f "$shared/shorts-sessions/$session" ]; then
		in_worktree=1
	fi
	if [ "$in_worktree" = 1 ]; then
		printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"This session works in a git worktree, where the shorts-studio MCP tools would run the main checkout'"'"'s code on your real posts. Run this worktree'"'"'s bin/shorts-studio instead, which uses a sandbox, or start bin/shorts-studio mcp serve there, as the verify skill does (docs/worktrees.md)."}}'
	fi
	exit 0
	;;
*)
	echo "Usage: worktree-hook.sh session-start [--json] [--codex] | mcp-guard" >&2
	exit 2
	;;
esac

# --- session-start ---

cwd=$(field cwd)
cwd=${cwd:-$PWD}
source=$(field source)
session=$(field session_id)
find_checkout "$cwd" || exit 0
worktree=0
[ "$own" != "$shared" ] && worktree=1

# The project's own tools, as folders to put first on PATH: those of the Nix dev shell that hold
# node, pnpm, ffmpeg or openspec. The dev shell's other folders (compilers, GNU coreutils, sed,
# bash, an xcrun) stay out, so the system's keep working. Cached in the shared git folder, keyed
# by the flake's files, and worked out again when they change or a folder is gone after a
# garbage collection. Empty when the shell's Node is already 26, or without Nix.
tools=''
no_tools_reason=''
find_tools() {
	case "$(node --version 2>/dev/null)" in v26.*) return 0 ;; esac
	nix=$(command -v nix 2>/dev/null) || nix=''
	# A GUI app's hook may not get the shell's PATH, so Nix is also looked for at its default
	# profile. WORKTREE_HOOK_NIX lets the tests point that somewhere else.
	fallback=${WORKTREE_HOOK_NIX:-/nix/var/nix/profiles/default/bin/nix}
	if [ -z "$nix" ] && [ -x "$fallback" ]; then nix=$fallback; fi
	if [ -z "$nix" ]; then
		no_tools_reason="Node 26 isn't on PATH and Nix isn't installed"
		return 0
	fi

	key=$(git_in "$root" hash-object flake.nix flake.lock 2>/dev/null | tr '\n' ' ')
	cache="$shared/shorts-devshell-path"
	if [ -f "$cache" ] && [ "$(sed -n 1p "$cache")" = "$key" ]; then
		tools=$(sed -n 2p "$cache")
		all_there=1
		old_ifs=$IFS
		IFS=:
		for folder in $tools; do [ -d "$folder" ] || all_there=0; done
		IFS=$old_ifs
		[ -n "$tools" ] && [ "$all_there" = 1 ] && return 0
	fi

	dev_env=$("$nix" print-dev-env --json "$root" 2>/dev/null) || dev_env=''
	dev_path=$(input=$dev_env field_path)
	tools=''
	old_ifs=$IFS
	IFS=:
	for folder in $dev_path; do
		for program in node pnpm ffmpeg openspec; do
			if [ -x "$folder/$program" ]; then
				case ":$tools:" in *":$folder:"*) ;; *) tools=${tools:+$tools:}$folder ;; esac
				break
			fi
		done
	done
	IFS=$old_ifs
	if [ -z "$tools" ]; then
		no_tools_reason="the Nix dev shell gave no Node 26"
		return 0
	fi

	# Written aside, then renamed, so a session opening in another worktree never reads half a file.
	printf '%s\n%s\n' "$key" "$tools" >"$cache.$$" && mv "$cache.$$" "$cache"
}

# The dev shell's PATH from `nix print-dev-env --json`, read from $input.
field_path() {
	[ -n "$input" ] || return 0
	if command -v jq >/dev/null 2>&1; then
		printf '%s' "$input" | jq -r '.variables.PATH.value // empty' 2>/dev/null
	elif command -v node >/dev/null 2>&1; then
		printf '%s' "$input" | node -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>{try{process.stdout.write(JSON.parse(t).variables.PATH.value)}catch{}})' 2>/dev/null
	fi
	return 0
}

# Installs the worktree's packages when they're missing or older than pnpm-lock.yaml, one
# session at a time. Sets `installed` to what happened: ok, failed, skipped or busy.
installed=''
log="$own/shorts-worktree-install.log"
install_packages() {
	# Holds the pnpm-lock.yaml hash of the last install that succeeded.
	marker="$own/shorts-installed-lock"
	needed() {
		lock_hash=$(git_in "$root" hash-object pnpm-lock.yaml 2>/dev/null)
		[ ! -f "$root/node_modules/.modules.yaml" ] || [ "$(cat "$marker" 2>/dev/null)" != "$lock_hash" ]
	}
	needed || return 0

	# mkdir either makes the folder or fails at once, so only one session gets the lock. A lock
	# whose process is gone, or still without a process id after 10 seconds, is taken over by
	# renaming it first: only one session's rename succeeds, so two can't both clear it and both
	# install.
	lock="$own/shorts-session.lock"
	waited_seconds=0
	until mkdir "$lock" 2>/dev/null; do
		holder=$(cat "$lock/pid" 2>/dev/null)
		if { [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; } || { [ -z "$holder" ] && [ "$waited_seconds" -ge 10 ]; }; then
			mv "$lock" "$lock.stale.$$" 2>/dev/null && rm -rf "$lock.stale.$$"
			continue
		fi
		waited_seconds=$((waited_seconds + 1))
		# Half the hook's 600-second timeout, so a session still waiting gets to say so.
		if [ "$waited_seconds" -gt 300 ]; then
			installed=busy
			return 0
		fi
		sleep 1
	done
	echo $$ >"$lock/pid"
	trap 'rm -rf "$lock"' EXIT

	# The other session may have installed while this one waited.
	if needed; then
		if [ -z "$tools" ] && [ -n "$no_tools_reason" ]; then
			installed=skipped
		elif (cd "$root" && PATH="${tools:+$tools:}$PATH" pnpm install --frozen-lockfile) >"$log" 2>&1; then
			printf '%s\n' "$lock_hash" >"$marker"
			installed=ok
		else
			installed=failed
		fi
	fi
	rm -rf "$lock"
	trap - EXIT
}

# Compaction only loses the agent's lines, so a compacted session skips straight to printing them.
if [ "$source" != compact ]; then
	find_tools
	if [ -n "$tools" ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
		line="export PATH=\"$tools:\$PATH\""
		grep -qxF "$line" "$CLAUDE_ENV_FILE" 2>/dev/null || printf '%s\n' "$line" >>"$CLAUDE_ENV_FILE"
	fi
	if [ "$worktree" = 1 ]; then
		install_packages
		# For mcp-guard, once the session has moved outside git.
		if plain_id "$session"; then
			mkdir -p "$shared/shorts-sessions" && printf '%s\n' "$root" >"$shared/shorts-sessions/$session"
			find "$shared/shorts-sessions" -type f -mtime +30 -exec rm -f {} + 2>/dev/null
		fi
	fi
fi

# --- What the agent is told ---

if [ "$worktree" = 0 ]; then
	echo "shorts-studio main checkout: commands here use your real posts and keys. Write code in a worktree (docs/worktrees.md)."
	exit 0
fi

if [ ! -f "$root/scripts/dev-sandbox.sh" ]; then
	echo "shorts-studio worktree whose branch predates the sandbox: its bin/shorts-studio uses your real posts and keys. Rebase it on main (git fetch origin && git rebase origin/main) before running it."
elif [ "$codex" = 1 ]; then
	echo "shorts-studio worktree: bin/shorts-studio runs in the sandbox in .sandbox/ (fake keys, paid providers unreachable). Nothing guards the shorts-studio MCP tools in Codex: check that bin/shorts-studio doctor shows a data folder under .sandbox/ before using them."
else
	echo "shorts-studio worktree: bin/shorts-studio runs in the sandbox in .sandbox/ (fake keys, paid providers unreachable), and the shorts-studio MCP tools are refused here: they'd run the main checkout's code on your real posts."
fi

changes="$root/openspec/changes"
branch=$(git_in "$root" symbolic-ref --quiet --short HEAD 2>/dev/null) || branch=''
if [ -z "$branch" ]; then
	echo "This worktree is on a detached HEAD: start a branch named after its OpenSpec change, git switch -c <change>."
else
	name=${branch##*/}
	# `claude --worktree <change>` names its branch worktree-<change>.
	name=${name#worktree-}
	change=''
	if [ "$name" != archive ] && [ -d "$changes/$name" ]; then
		change=$name
	else
		# The longest open change named inside the branch: claude/brand-look-x7f2 → brand-look.
		for folder in "$changes"/*/; do
			candidate=$(basename "$folder")
			[ "$candidate" = archive ] && continue
			case "$name" in *"$candidate"*) [ ${#candidate} -gt ${#change} ] && change=$candidate ;; esac
		done
	fi
	if [ -z "$change" ]; then
		echo "Branch $branch matches no open OpenSpec change."
	else
		total=$(grep -cE '^[[:space:]]*- \[[^]]*\]' "$changes/$change/tasks.md" 2>/dev/null) || total=0
		finished=$(grep -cE '^[[:space:]]*- \[[[:space:]]*[xX][[:space:]]*\]' "$changes/$change/tasks.md" 2>/dev/null) || finished=0
		builds_on=$(sed -n 's/^Builds on: *//p' "$changes/$change/proposal.md" 2>/dev/null | head -n 1)
		status_line="OpenSpec change $change: $finished/$total tasks done"
		if [ -n "$builds_on" ] && [ "$builds_on" != nothing ]; then
			listed=''
			old_ifs=$IFS
			IFS=,
			for dependency in $builds_on; do
				dependency=$(printf '%s' "$dependency" | tr -d ' ')
				if ls -d "$changes"/archive/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-"$dependency" >/dev/null 2>&1; then
					state=archived
				elif [ -d "$changes/$dependency" ]; then
					state=open
				else
					state=unknown
				fi
				listed="${listed:+$listed, }$dependency ($state)"
			done
			IFS=$old_ifs
			status_line="$status_line; builds on $listed, as of this branch"
		fi
		echo "$status_line."
	fi
fi

case "$installed" in
ok) echo "Installed the packages (pnpm install --frozen-lockfile)." ;;
failed) echo "Installing the packages failed: see $log." ;;
busy) echo "Another session is still installing this worktree's packages; run pnpm install once it's done." ;;
skipped)
	if [ -n "${nix:-}" ]; then
		echo "The packages aren't installed: $no_tools_reason. Install them with nix develop -c pnpm install."
	else
		echo "The packages aren't installed: $no_tools_reason. Install Nix (docs/getting-started.md), or put Node 26 and pnpm on PATH, then run pnpm install."
	fi
	;;
esac
exit 0
