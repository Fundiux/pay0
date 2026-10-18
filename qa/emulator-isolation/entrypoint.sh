#!/bin/sh
set -eu
mkdir -p /tmp/.cache
cp -r /opt/emulator-cache/firebase /tmp/.cache/firebase
node /opt/probe/preflight.mjs
cd /opt/probe/synthetic
firebase emulators:exec --project demo-pay0-ui-qa --only auth,firestore,functions "node /opt/probe/run.mjs"
