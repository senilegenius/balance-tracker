#!/usr/bin/env bash
set -euo pipefail

# Extracts Caddy's root CA certificate from the running container
# and adds it to the macOS Keychain so browsers trust it.
# Removes any previously trusted Caddy certs first to avoid buildup.
# Run this after `docker compose up`, and again after any `docker compose down -v`.

if [ "$(uname)" != "Darwin" ]; then
    echo "Error: This script only supports macOS."
    exit 1
fi

CONTAINER_NAME="my-balance-tracker-caddy-1"
CERT_PATH="/data/caddy/pki/authorities/local/root.crt"
LOCAL_CERT="caddy-root-ca.crt"
CERT_CN="Caddy Local Authority"

echo "Extracting Caddy root CA certificate..."

if ! docker cp "${CONTAINER_NAME}:${CERT_PATH}" "${LOCAL_CERT}" 2>/dev/null; then
    echo "Error: Could not extract certificate."
    echo "Make sure the containers are running: docker compose up -d"
    echo "Then wait a few seconds for Caddy to generate its CA."
    exit 1
fi

# Remove any existing Caddy CA certs from the Keychain
echo "Checking for existing Caddy CA certificates..."
EXISTING=$(security find-certificate -a -c "${CERT_CN}" -Z /Library/Keychains/System.keychain 2>/dev/null | grep "SHA-1" | awk '{print $NF}') || true

if [ -n "${EXISTING}" ]; then
    COUNT=$(echo "${EXISTING}" | wc -l | tr -d ' ')
    echo "Found ${COUNT} existing Caddy cert(s). Removing..."
    echo "${EXISTING}" | while read -r HASH; do
        sudo security delete-certificate -Z "${HASH}" /Library/Keychains/System.keychain 2>/dev/null || true
    done
    echo "Old certificates removed."
else
    echo "No existing Caddy certificates found."
fi

echo "Adding new certificate to macOS Keychain (requires sudo)..."
sudo security add-trusted-cert -d -r trustRoot \
    -k /Library/Keychains/System.keychain "${LOCAL_CERT}"

rm -f "${LOCAL_CERT}"

echo ""
echo "Done! Caddy's local CA is now trusted by macOS."
echo "Visit https://localhost to access the app."
echo ""
echo "Note: You may need to restart your browser for the change to take effect."
