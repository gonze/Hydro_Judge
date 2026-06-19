#!/usr/bin/env bash
if command -v prlimit >/dev/null 2>&1; then
    prlimit --pid $$ --stack=unlimited:unlimited 2>/dev/null || true
fi
exec /usr/bin/node judge/server.js
