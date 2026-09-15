#!/bin/bash
# setup.sh — one time setup, and the thing to run when a scrape starts failing.
set -e
cd "$(dirname "$0")"

echo "compiling the OCR script..."
swiftc -O ocr.swift -o bin/ocr

echo "updating yt-dlp..."
if [ ! -f bin/yt-dlp_macos ]; then
  curl -sL -o bin/yt-dlp_macos https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos
  chmod +x bin/yt-dlp_macos
else
  bin/yt-dlp_macos -U || echo "  (self update failed, delete bin/yt-dlp_macos and rerun to fetch a fresh copy)"
fi

echo
echo "yt-dlp $(bin/yt-dlp_macos --version)"
echo "ocr    ready"
echo
echo "usage:  node scrape.mjs @someaccount --limit 30"
