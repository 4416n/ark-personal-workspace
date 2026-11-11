#!/usr/bin/env bash
set -euo pipefail

# This setup belongs only on the disposable GitHub-hosted Linux job below.
# Never relax a developer workstation's namespace policy to run the tests.
if [[ "${GITHUB_ACTIONS:-}" != "true" || "${RUNNER_OS:-}" != "Linux" ]]; then
  echo "Sandbox CI setup requires the disposable GitHub Actions Linux runner." >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install --yes bubblewrap dbus-user-session

# Ubuntu 24.04 restricts unprivileged namespaces through AppArmor by default.
# The test's own bubblewrap filesystem/network/PID isolation remains enabled.
if [[ -e /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]]; then
  sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
fi
if [[ -e /proc/sys/kernel/unprivileged_userns_clone ]]; then
  sudo sysctl -w kernel.unprivileged_userns_clone=1
fi

ci_uid="$(id -u)"
on_failure() {
  echo "Sandbox runner preparation failed; system/user service diagnostics:" >&2
  sudo systemctl --no-pager --full status "user@${ci_uid}.service" || true
  sudo journalctl --no-pager -n 80 -u "user@${ci_uid}.service" || true
  if [[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
    systemctl --user --no-pager --full status || true
  fi
}
trap on_failure ERR
sudo loginctl enable-linger "$(id -un)"
sudo systemctl start "user@${ci_uid}.service"
export XDG_RUNTIME_DIR="/run/user/${ci_uid}"
export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus"
# D-Bus socket activation and the user manager can finish after start returns.
for attempt in {1..20}; do
  if [[ -S "${XDG_RUNTIME_DIR}/bus" ]] && systemctl --user show-environment >/dev/null; then
    break
  fi
  sleep 0.5
done
test -S "${XDG_RUNTIME_DIR}/bus"
systemctl --user show-environment >/dev/null
systemctl --user is-active dbus.socket
systemd-run --user --wait --pipe --collect /usr/bin/true
printf 'XDG_RUNTIME_DIR=%s\nDBUS_SESSION_BUS_ADDRESS=%s\n' \
  "$XDG_RUNTIME_DIR" "$DBUS_SESSION_BUS_ADDRESS" >> "$GITHUB_ENV"
