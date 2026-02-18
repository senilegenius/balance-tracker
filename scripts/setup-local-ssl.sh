#!/usr/bin/env bash
set -euo pipefail

# Extracts Caddy's root CA certificate from the running container
# and adds it to the macOS Keychain so browsers trust it.
# Run this once after the first `docker compose up`.

CONTAINER_NAME="my-balance-tracker-caddy-1"
CERT_PATH="/data/caddy/pki/authorities/local/root.crt"
LOCAL_CERT="caddy-root-ca.crt"

echo "Extracting Caddy root CA certificate..."

if ! docker cp "${CONTAINER_NAME}:${CERT_PATH}" "${LOCAL_CERT}" 2>/dev/null; then
    echo "Error: Could not extract certificate."
    echo "Make sure the containers are running: docker compose up -d"
    echo "Then wait a few seconds for Caddy to generate its CA."
    exit 1
fi

echo "Adding certificate to macOS Keychain (requires sudo)..."
sudo security add-trusted-cert -d -r trustRoot \
    -k /Library/Keychains/System.keychain "${LOCAL_CERT}"

rm -f "${LOCAL_CERT}"

echo ""
echo "Done! Caddy's local CA is now trusted by macOS."
echo "Visit https://localhost to access the app."
echo ""
echo "Note: You may need to restart your browser for the change to take effect."
