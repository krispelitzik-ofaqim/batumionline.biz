#!/bin/sh
cd "$(dirname "$0")" || exit 1
echo ">> 1/3 adding files..."
git add -A
echo ">> 2/3 committing..."
git commit -m "biz: title, lawyer shipping details, printable address label" || echo "   (nothing to commit / commit failed)"
echo ">> 3/3 pushing..."
git push || echo "   (PUSH FAILED — see message above)"
echo ""
echo "==== DONE ===="
git log --oneline -1
echo "--- pending (should be empty): ---"
git status -s
