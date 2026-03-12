#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="sensor-dashboard.service"
HELPER_SERVICE_NAME="relay-helper.service"
PROJECT_DIR="/home/tom/Garden"
UNIT_SOURCE="$PROJECT_DIR/$SERVICE_NAME"
UNIT_DEST="/etc/systemd/system/$SERVICE_NAME"
HELPER_UNIT_SOURCE="$PROJECT_DIR/$HELPER_SERVICE_NAME"
HELPER_UNIT_DEST="/etc/systemd/system/$HELPER_SERVICE_NAME"

if [[ ! -f "$UNIT_SOURCE" ]]; then
  echo "Missing $UNIT_SOURCE"
  exit 1
fi

if [[ ! -f "$HELPER_UNIT_SOURCE" ]]; then
  echo "Missing $HELPER_UNIT_SOURCE"
  exit 1
fi

sudo cp "$UNIT_SOURCE" "$UNIT_DEST"
sudo cp "$HELPER_UNIT_SOURCE" "$HELPER_UNIT_DEST"
sudo systemctl daemon-reload
sudo systemctl enable "$HELPER_SERVICE_NAME"
sudo systemctl restart "$HELPER_SERVICE_NAME"
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo "Service installed and started: $SERVICE_NAME"
echo "Service installed and started: $HELPER_SERVICE_NAME"
echo "Check status with: sudo systemctl status $SERVICE_NAME --no-pager"
