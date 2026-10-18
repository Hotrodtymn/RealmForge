#!/bin/zsh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
PROJECT_ROOT_FILE="$SCRIPT_DIR/../../RealmForgeProjectRoot"
if [[ -f "$PROJECT_ROOT_FILE" ]]; then
	IFS= read -r PROJECT_ROOT < "$PROJECT_ROOT_FILE"
else
	PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
fi
if [[ -z "$PROJECT_ROOT" ]]; then
	print -u2 "RealmForge project root is empty. Rebuild the application from the project directory."
	exit 1
fi
node_is_compatible() {
	local candidate="$1"
	local version major minor
	[[ -x "$candidate" ]] || return 1
	version="$("$candidate" --version 2>/dev/null)" || return 1
	[[ "$version" =~ ^v([0-9]+)[.]([0-9]+)[.][0-9]+ ]] || return 1
	major="$match[1]"
	minor="$match[2]"
	# Vite in this project requires ^20.19.0 || >=22.12.0.
	(( major == 20 && minor >= 19 )) || (( major >= 22 && (major > 22 || minor >= 12) ))
}

best_nvm_node() {
	local nvm_root="$1"
	local alias_file target alias_target candidate version best_candidate=""
	local -a alias_candidates alias_files
	local major minor patch best_major=0 best_minor=0 best_patch=0
	[[ -d "$nvm_root/versions/node" ]] || return 1

	# Resolve the configured NVM default alias without loading shell startup files.
	alias_file="$nvm_root/alias/default"
	if [[ -r "$alias_file" ]]; then
		IFS= read -r target < "$alias_file" || true
		if [[ "$target" == lts/* ]]; then
			if [[ "$target" == "lts/*" ]]; then
				alias_files=("$nvm_root"/alias/lts/*(N))
			else
				alias_files=("$nvm_root/alias/$target")
			fi
			for alias_file in "${alias_files[@]}"; do
				[[ -f "$alias_file" ]] || continue
				IFS= read -r alias_target < "$alias_file" || continue
				[[ "$alias_target" =~ ^v?[0-9]+([.][0-9]+){0,2}$ ]] || continue
				alias_target="${alias_target#v}"
				for candidate in "$nvm_root"/versions/node/v${alias_target}/bin/node(N); do
					alias_candidates+=("$candidate")
				 done
			done
		elif [[ "$target" =~ ^v?[0-9]+([.][0-9]+){0,2}$ ]]; then
			target="${target#v}"
			for candidate in "$nvm_root"/versions/node/v${target}*/bin/node(N); do
				alias_candidates+=("$candidate")
			done
		fi
	fi

	# Try default-alias targets before the general compatible-version fallback.
	for candidate in "${alias_candidates[@]}"; do
		if node_is_compatible "$candidate"; then
			version="$("$candidate" --version 2>/dev/null)"
			[[ "$version" =~ ^v([0-9]+)[.]([0-9]+)[.]([0-9]+) ]] || continue
			major="$match[1]"; minor="$match[2]"; patch="$match[3]"
			if (( major > best_major || (major == best_major && minor > best_minor) || (major == best_major && minor == best_minor && patch > best_patch) )); then
				best_candidate="$candidate"; best_major="$major"; best_minor="$minor"; best_patch="$patch"
			fi
		fi
	done
	[[ -n "$best_candidate" ]] && { print -r -- "$best_candidate"; return 0; }

	# Fall back to the highest compatible version installed under NVM.
	for candidate in "$nvm_root"/versions/node/v<->.<->.<->/bin/node(N); do
		if node_is_compatible "$candidate"; then
			version="$("$candidate" --version 2>/dev/null)"
			[[ "$version" =~ ^v([0-9]+)[.]([0-9]+)[.]([0-9]+) ]] || continue
			major="$match[1]"; minor="$match[2]"; patch="$match[3]"
			if (( major > best_major || (major == best_major && minor > best_minor) || (major == best_major && minor == best_minor && patch > best_patch) )); then
				best_candidate="$candidate"; best_major="$major"; best_minor="$minor"; best_patch="$patch"
			fi
		fi
	done
	[[ -n "$best_candidate" ]] || return 1
	print -r -- "$best_candidate"
}

NODE_BIN=""
if [[ -n "${REALMFORGE_NODE:-}" ]] && node_is_compatible "$REALMFORGE_NODE"; then
	NODE_BIN="$REALMFORGE_NODE"
fi
if [[ -z "$NODE_BIN" ]]; then
	PATH_NODE="$(command -v node 2>/dev/null || true)"
	if [[ -n "$PATH_NODE" ]] && node_is_compatible "$PATH_NODE"; then NODE_BIN="$PATH_NODE"; fi
fi
if [[ -z "$NODE_BIN" ]]; then
	for candidate in /opt/homebrew/bin/node /usr/local/bin/node /opt/local/bin/node; do
		if node_is_compatible "$candidate"; then NODE_BIN="$candidate"; break; fi
	done
fi
if [[ -z "$NODE_BIN" ]]; then
	NVM_ROOT="${NVM_DIR:-$HOME/.nvm}"
	NODE_BIN="$(best_nvm_node "$NVM_ROOT" 2>/dev/null || true)"
fi
if [[ -z "$NODE_BIN" ]]; then
	print -u2 "A compatible Node.js installation was not found. RealmForge requires Node.js 20.19+ or 22.12+. Install a compatible version, then try again."
	exit 1
fi

NODE_DIR="$(cd "$(dirname "$NODE_BIN")" && pwd -P)"
export PATH="$NODE_DIR:$PATH"
export REALMFORGE_SELECTED_NODE="$NODE_BIN"
NPM_BIN="$NODE_DIR/npm"
if [[ ! -x "$NPM_BIN" ]]; then NPM_BIN="$(command -v npm 2>/dev/null || true)"; fi
if [[ -z "$NPM_BIN" || ! -x "$NPM_BIN" ]] || ! "$NPM_BIN" --version >/dev/null 2>&1; then
	print -u2 "Node.js $("$NODE_BIN" --version) was found at $NODE_BIN, but a working npm executable was not found. Install npm with Node.js."
	exit 1
fi
export REALMFORGE_SELECTED_NPM="$NPM_BIN"
exec "$NODE_BIN" "$SCRIPT_DIR/realmforge.cjs" "${1:-help}" "$PROJECT_ROOT"
