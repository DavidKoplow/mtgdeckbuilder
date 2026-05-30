#!/usr/bin/env bash
set -euo pipefail

gateway_dir="${MAGE_GATEWAY_DIR:-/opt/mage/gateway}"
lib_dir="${MAGE_LIB_DIR:-/opt/mage/lib}"
local_server_dir="${MAGE_LOCAL_SERVER_DIR:-/opt/mage/server}"
gateway_port="${PORT:-${MAGE_GATEWAY_PORT:-17888}}"
gateway_host="${MAGE_GATEWAY_HOST:-0.0.0.0}"
server_host="${MAGE_SERVER_HOST:-beta.xmage.today}"
server_port="${MAGE_SERVER_PORT:-17171}"
default_java_opts="-Xms256m -Xmx384m -Xss512k -XX:+UseG1GC -XX:MaxGCPauseMillis=200 -XX:+ExitOnOutOfMemoryError -Djava.net.preferIPv4Stack=true"
default_local_server_java_opts="-Xms512m -Xmx768m -Xss512k -XX:+UseG1GC -XX:MaxGCPauseMillis=200 -XX:+ExitOnOutOfMemoryError -Djava.net.preferIPv4Stack=true"

is_truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

if [[ ! -f "${gateway_dir}/mage-web-gateway.jar" ]]; then
  echo "Could not find mage-web-gateway.jar in ${gateway_dir}" >&2
  exit 1
fi

if [[ ! -d "${lib_dir}" ]]; then
  echo "Could not find MAGE runtime libs in ${lib_dir}" >&2
  exit 1
fi

if is_truthy "${MAGE_LOCAL_AI_SERVER:-false}"; then
  local_server_port="${MAGE_LOCAL_SERVER_PORT:-17171}"
  runtime_config_dir="${MAGE_LOCAL_SERVER_RUNTIME_CONFIG_DIR:-/tmp/mage-server-config}"
  server_jar="$(find "${local_server_dir}/lib" -maxdepth 1 -name 'mage-server*.jar' -print -quit 2>/dev/null || true)"
  if [[ -z "${server_jar}" ]]; then
    echo "Could not find mage-server jar in ${local_server_dir}/lib" >&2
    exit 1
  fi
  if [[ ! -f "${local_server_dir}/config/config.xml" ]]; then
    echo "Could not find local MAGE server config in ${local_server_dir}/config" >&2
    exit 1
  fi

  mkdir -p "${runtime_config_dir}"
  cp -R "${local_server_dir}/config/." "${runtime_config_dir}/"
  sed -i "s/port=\"[0-9][0-9]*\"/port=\"${local_server_port}\"/" "${runtime_config_dir}/config.xml"

  server_host="${MAGE_LOCAL_SERVER_HOST:-127.0.0.1}"
  server_port="${local_server_port}"

  echo "Starting local AI-enabled MAGE server on 0.0.0.0:${local_server_port}"
  (
    cd "${local_server_dir}"
    exec java ${MAGE_LOCAL_SERVER_JAVA_OPTS:-${default_local_server_java_opts}} \
      "-Dxmage.config.path=${runtime_config_dir}/config.xml" \
      -jar "${server_jar}" \
      "-testMode=${MAGE_LOCAL_SERVER_TEST_MODE:-false}"
  ) &
  local_server_pid="$!"

  for _ in $(seq 1 "${MAGE_LOCAL_SERVER_WAIT_SECONDS:-90}"); do
    if (echo >/dev/tcp/127.0.0.1/${local_server_port}) >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "${local_server_pid}" >/dev/null 2>&1; then
      echo "Local MAGE server exited before accepting connections" >&2
      wait "${local_server_pid}"
      exit 1
    fi
    sleep 1
  done
fi

server_target="${MAGE_SERVER_URL:-${server_host}:${server_port}}"

cd "${gateway_dir}"
echo "Starting MAGE web gateway wrapper on ${gateway_host}:${gateway_port}; target server ${server_target}"
exec java ${MAGE_GATEWAY_JAVA_OPTS:-${default_java_opts}} \
  -cp "mage-web-gateway.jar:${lib_dir}/*" \
  "-Dmage.web.host=${gateway_host}" \
  "-Dmage.web.port=${gateway_port}" \
  "-Dmage.server.host=${server_host}" \
  "-Dmage.server.port=${server_port}" \
  mage.webgateway.BridgeMain
