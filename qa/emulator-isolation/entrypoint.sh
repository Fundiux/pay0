#!/bin/sh
set -eu
mkdir -p /tmp/.cache
cp -r /opt/emulator-cache/firebase /tmp/.cache/firebase
node /opt/probe/preflight.mjs
cd /tmp
set +e
firebase emulators:exec --config /opt/probe/synthetic/firebase.json --project demo-pay0-ui-qa --only auth,firestore,functions "node /opt/probe/run.mjs"
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
