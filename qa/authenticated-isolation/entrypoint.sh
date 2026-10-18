#!/bin/sh
set -eu
mkdir -p /tmp/.cache
cp -r /opt/emulator-cache/firebase /tmp/.cache/firebase
node /opt/pay0/qa/emulator-isolation/preflight.mjs
mkdir -p /tmp/pay0-next /tmp/pay0-test-results /tmp/pay0-playwright-results
node /opt/pay0/qa/authenticated-isolation/path-preflight.mjs
cd /tmp
emulator_log=/tmp/firebase-emulators.log
firebase emulators:start --config /opt/pay0/firebase.authenticated-qa.json --project demo-pay0-ui-qa --only auth,firestore,functions >"$emulator_log" 2>&1 &
emulator_pid=$!
cleanup() {
  if kill -0 "$emulator_pid" 2>/dev/null; then
    kill "$emulator_pid" 2>/dev/null || true
    wait "$emulator_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

set +e
node /opt/pay0/qa/authenticated-isolation/emulator-readiness.mjs "$emulator_pid" "$emulator_log"
readiness_status=$?
if [ "$readiness_status" -eq 0 ]; then
  echo "AUTHENTICATED_QA_STAGE harness:start"
  FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-pay0-ui-qa \
    node /opt/pay0/qa/authenticated-isolation/run.mjs
  status=$?
else
  status=$readiness_status
fi
set -e
if [ "$status" -ne 0 ]; then
  echo "AUTHENTICATED_QA_FAILURE exit=$status"
  echo "AUTHENTICATED_QA_DIAGNOSTIC:$emulator_log"
  tail -n 160 "$emulator_log" | sed -E 's/((token|password|api[_-]?key)=)[^[:space:]]+/\1[REDACTED]/Ig' || true
  for log in firebase-debug.log /tmp/firebase-debug.log; do
    if [ -f "$log" ]; then
      echo "AUTHENTICATED_QA_DIAGNOSTIC:$log"
      tail -n 120 "$log" | sed -E 's/((token|password|api[_-]?key)=)[^[:space:]]+/\1[REDACTED]/Ig'
    fi
  done
fi
exit "$status"
