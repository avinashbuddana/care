#!/bin/sh
# Proves the release gate opens only when migrations succeed and none remain pending.
set -eu
repo=$(pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cat > "$work/pnpm" <<'MOCK'
#!/bin/sh
printf '%s\n' "$*" >> "$CALL_LOG"
case "$*" in
  *migration:run:prod*) exit "$RUN_EXIT" ;;
  *migration:show:prod*) printf '{"pending":%s}\n' "$PENDING" ;;
esac
MOCK
chmod +x "$work/pnpm"
export CALL_LOG="$work/calls"
release() { PATH="$work:$PATH" DATABASE_URL=postgres://unused sh "$repo/infra/deployment/release.sh" > "$work/output" 2>&1; }

if RUN_EXIT=23 PENDING=false release; then echo 'FAIL: migration failure did not fail release'; exit 1; fi
if grep -q 'ready for rollout' "$work/output"; then echo 'FAIL: rollout gate opened after failure'; exit 1; fi
if RUN_EXIT=0 PENDING=true release; then echo 'FAIL: pending migrations did not fail release'; exit 1; fi
RUN_EXIT=0 PENDING=false release || { echo 'FAIL: successful migrations blocked release'; cat "$work/output"; exit 1; }
grep -q 'ready for rollout' "$work/output" || { echo 'FAIL: gate did not open'; exit 1; }
printf '%s\n' 'PASS: failed or incomplete migrations block release; success opens the gate.'
