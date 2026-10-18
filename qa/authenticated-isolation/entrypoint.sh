#!/bin/sh
set -eu
mkdir -p /tmp/.cache
cp -r /opt/emulator-cache/firebase /tmp/.cache/firebase
node /opt/pay0/qa/emulator-isolation/preflight.mjs
cd /tmp
set +e
env FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-pay0-ui-qa \
  firebase emulators:exec --config /opt/pay0/qa/authenticated-isolation/firebase.json --project demo-pay0-ui-qa --only auth,firestore,functions "node /opt/pay0/qa/authenticated-isolation/run.mjs"
status=$?
set -e
if [ "$status" -ne 0 ]; then
  echo "AUTHENTICATED_QA_FAILURE exit=$status"
  for log in firebase-debug.log /tmp/firebase-debug.log; do
    if [ -f "$log" ]; then
      echo "AUTHENTICATED_QA_DIAGNOSTIC:$log"
      tail -n 120 "$log" | sed -E 's/((token|password|api[_-]?key)=)[^[:space:]]+/\1[REDACTED]/Ig'
    fi
  done
fi
exit "$status"