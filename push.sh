#!/bin/sh
cd "$(dirname "$0")" || exit 1
git add -A
git commit -m "biz colors and centering"
git push
echo ""
echo "==== DONE ===="
git log --oneline -1
