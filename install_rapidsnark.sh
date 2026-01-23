#!/bin/bash
set -e

# rapidsnark pre-built binary installer
# Downloads from GitHub releases instead of compiling from source

VERSION="v0.0.8"
INSTALL_DIR="/usr/local/bin"

echo "🚀 Installing rapidsnark ${VERSION}..."

# Detect architecture and OS
ARCH=$(uname -m)
OS=$(uname -s)

echo "   Architecture: $ARCH, OS: $OS"

# Determine download URL
if [[ "$OS" == "Darwin" ]]; then
    if [[ "$ARCH" == "arm64" ]]; then
        DOWNLOAD_URL="https://github.com/iden3/rapidsnark/releases/download/${VERSION}/rapidsnark-macOS-arm64-${VERSION}.zip"
        ZIP_NAME="rapidsnark-macOS-arm64-${VERSION}.zip"
    else
        DOWNLOAD_URL="https://github.com/iden3/rapidsnark/releases/download/${VERSION}/rapidsnark-macOS-x86_64-${VERSION}.zip"
        ZIP_NAME="rapidsnark-macOS-x86_64-${VERSION}.zip"
    fi
elif [[ "$OS" == "Linux" ]]; then
    if [[ "$ARCH" == "aarch64" || "$ARCH" == "arm64" ]]; then
        DOWNLOAD_URL="https://github.com/iden3/rapidsnark/releases/download/${VERSION}/rapidsnark-linux-arm64-${VERSION}.zip"
        ZIP_NAME="rapidsnark-linux-arm64-${VERSION}.zip"
    else
        DOWNLOAD_URL="https://github.com/iden3/rapidsnark/releases/download/${VERSION}/rapidsnark-linux-x86_64-${VERSION}.zip"
        ZIP_NAME="rapidsnark-linux-x86_64-${VERSION}.zip"
    fi
else
    echo "❌ Unsupported OS: $OS"
    exit 1
fi

echo "   Download URL: $DOWNLOAD_URL"

# Check if already installed
if [ -f "$INSTALL_DIR/rapidsnark" ]; then
    INSTALLED_VERSION=$("$INSTALL_DIR/rapidsnark" 2>&1 | head -1 || echo "unknown")
    echo "   rapidsnark already installed: $INSTALL_DIR/rapidsnark"
    read -p "   Reinstall? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "   Skipped."
        exit 0
    fi
fi

# Download to temp directory
TMP_DIR=$(mktemp -d)
cd "$TMP_DIR"

echo "📥 Downloading rapidsnark..."
curl -L -o "$ZIP_NAME" "$DOWNLOAD_URL"

echo "📦 Extracting..."
unzip -q "$ZIP_NAME"

# Find the prover binary
PROVER_BIN=$(find . -name "prover" -type f | head -1)
if [ -z "$PROVER_BIN" ]; then
    echo "❌ prover binary not found in archive"
    rm -rf "$TMP_DIR"
    exit 1
fi

# Install to /usr/local/bin
echo "📋 Installing to $INSTALL_DIR/rapidsnark..."
if [ -w "$INSTALL_DIR" ]; then
    cp "$PROVER_BIN" "$INSTALL_DIR/rapidsnark"
    chmod +x "$INSTALL_DIR/rapidsnark"
else
    echo "   (requires sudo)"
    sudo cp "$PROVER_BIN" "$INSTALL_DIR/rapidsnark"
    sudo chmod +x "$INSTALL_DIR/rapidsnark"
fi

# Cleanup
rm -rf "$TMP_DIR"

# Verify installation
if [ -x "$INSTALL_DIR/rapidsnark" ]; then
    echo "✅ rapidsnark installed successfully!"
    echo "   Binary: $INSTALL_DIR/rapidsnark"
    echo "   Version: ${VERSION}"
else
    echo "❌ Installation failed"
    exit 1
fi
