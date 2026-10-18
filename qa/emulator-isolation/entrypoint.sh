#!/bin/sh
set -eu
mkdir -p /tmp/.cache
cp -r /opt/emulator-cache/firebase /tmp/.cache/firebase
mkdir -p /tmp/qa-synthetic
cp -r /opt/probe/synthetic/. /tmp/qa-synthetic/
node /opt/probe/preflight.mjs
cd /tmp/qa-synthetic
set +e
firebase emulators:exec --project demo-pay0-ui-qa --only auth,firestore,functions "node /opt/probe/run.mjs"
status=$?
set -e
if [ "$status" -ne 0 ]; then
  echo "EMULATOR_STARTUP_FAILURE exit=$status"
  for log in firebase-debug.log /tmp/firebase-debug.log; do
    if [ -f "$log" ]; then
      echo "EMULATOR_DIAGNOSTIC:$log"
      tail -n 120 "$log" | sed -E 's/((token|password|api[_-]?key)=)[^[:space:]]+/\1[REDACTED]/Ig'
    fi
  done
fi
exit "$status"
