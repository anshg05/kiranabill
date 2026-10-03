#!/usr/bin/env bash
# D55 (owner, 3 Oct 2026): a push to main deploys to production ONLY when the
# latest commit message contains "[deploy]" - each production deploy costs
# Netlify credits. Netlify's ignore command: exit 0 = SKIP the build, exit 1 =
# build (docs.netlify.com/build/configure-builds/ignore-builds). Only the
# latest commit is read (`git log -1`): the build clone is shallow.
if git log -1 --pretty=%B | grep -qF "[deploy]"; then
  echo "netlify-ignore: [deploy] in the latest commit message - building"
  exit 1
fi
echo "netlify-ignore: no [deploy] in the latest commit message - skipping the build"
exit 0
