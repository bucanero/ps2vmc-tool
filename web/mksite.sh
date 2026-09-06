#!/bin/sh
#
# Assemble the GitHub Pages site from web-ps2/ and web-ps1/.
#
#     ./web/mksite.sh [outdir]          # default outdir: _site
#
# Layout published at https://bucanero.github.io/ps2vmc-tool/
#
#     /             the PS2 tool   (web-ps2/)
#     /ps1/         the PS1 tool   (web-ps1/)
#
# Both pages are plain static files - the wasm module is base64 inside
# ps2vmc-wasm-binary.js, so nothing is fetched at run time and no MIME type or
# header configuration is needed on the server.
#
# The one thing that cannot be identical in both layouts is the link each page
# carries to the other one. In a checkout the pages sit side by side and the
# link reads ../web-ps1/index.html, which keeps them usable straight from
# file:// - a property the build deliberately preserves. Here those two hrefs
# are rewritten to the published layout, and the rewrite is asserted: if the
# markup ever changes so the pattern stops matching, this fails loudly instead
# of publishing a dead link.
#
set -e

cd "$(dirname "$0")/.."
OUT=${1:-_site}

rm -rf "$OUT"
mkdir -p "$OUT/ps1"

# Only what the pages actually load: no README, no build.sh, no test/, no
# web_api.c. web-ps2/*.js is exactly the nine scripts index.html pulls in;
# web-ps1/index.html is self-contained.
cp web-ps2/index.html "$OUT/"
cp web-ps2/*.js "$OUT/"
cp web-ps1/index.html "$OUT/ps1/"

# Not needed by the artifact-based deployment, which serves the upload as-is,
# but it keeps the site correct if it is ever published from a branch instead:
# Jekyll would otherwise try to interpret the pages.
: > "$OUT/.nojekyll"

# rewrite FILE PATTERN REPLACEMENT  (basic regex; fails if PATTERN is absent)
rewrite() {
	grep -q "$2" "$1" || { echo "mksite: no '$2' in $1" >&2; exit 1; }
	sed "s|$2|$3|g" "$1" > "$1.tmp"
	mv "$1.tmp" "$1"
}

rewrite "$OUT/index.html"     '\.\./web-ps1/index\.html' 'ps1/'
rewrite "$OUT/ps1/index.html" '\.\./web-ps2/index\.html' '../'

# Every <script src> must have landed, or the page is broken in a way that only
# shows up in a browser. Checked here so a missing file fails the deploy.
missing=0
for src in $(sed -n 's/.*<script src="\([^"]*\)".*/\1/p' "$OUT/index.html"); do
	[ -f "$OUT/$src" ] || { echo "mksite: index.html needs $src, not shipped" >&2; missing=1; }
done
[ "$missing" = 0 ] || exit 1

echo "site in $OUT/ ($(find "$OUT" -type f | wc -l | tr -d ' ') files, $(du -sh "$OUT" | cut -f1))"
