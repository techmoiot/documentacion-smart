#!/usr/bin/env bash
# Instalador para un contenedor LXC (Debian 12/13 o Ubuntu 22.04/24.04)
#
#   curl -fsSL https://raw.githubusercontent.com/techmoiot/documentacion-smart/main/install.sh | sudo bash
#
# Variables opcionales:  REPO_URL  BRANCH  APP_DIR  DATA_DIR  PORT
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/techmoiot/documentacion-smart.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/documentacion-smart}"
DATA_DIR="${DATA_DIR:-/var/lib/documentacion-smart}"
PORT="${PORT:-3000}"
SVC_USER="smartdoc"
SERVICE="documentacion-smart"
ENV_FILE="/etc/documentacion-smart.env"
MIN_NODE_MAJOR=22

c() { if [ -t 1 ]; then printf '\033[%sm%s\033[0m' "$1" "$2"; else printf '%s' "$2"; fi; }
info() { echo "$(c 36 '▸') $*"; }
ok()   { echo "$(c 32 '✔') $*"; }
die()  { echo "$(c 31 '✘') $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Ejecute el instalador como root (sudo)."
command -v apt-get >/dev/null 2>&1 || die "Este instalador soporta Debian/Ubuntu (apt)."
export DEBIAN_FRONTEND=noninteractive

# 1) Paquetes base
info "Instalando paquetes base …"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git util-linux >/dev/null

# 2) Node.js >= 22 (requerido por el SQLite integrado)
node_ok() { command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge "$MIN_NODE_MAJOR" ]; }
if ! node_ok; then
  info "Instalando Node.js ${MIN_NODE_MAJOR}.x (NodeSource) …"
  curl -fsSL "https://deb.nodesource.com/setup_${MIN_NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node_ok || die "No se pudo instalar Node.js ${MIN_NODE_MAJOR} o superior."
ok "Node.js $(node -v)"

# 3) Usuario de servicio
id "$SVC_USER" >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SVC_USER"

# 4) Código
if [ -d "$APP_DIR/.git" ]; then
  info "Ya existe una instalación en $APP_DIR: se actualiza."
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" checkout --quiet "$BRANCH"
  git -C "$APP_DIR" merge --ff-only --quiet "origin/$BRANCH"
else
  info "Descargando el código desde $REPO_URL …"
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR" || die "No se pudo clonar el repositorio. Si es privado, use una clave de despliegue (SSH) en REPO_URL."
fi
info "Instalando dependencias …"
(cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
chmod +x "$APP_DIR/bin/document"
ln -sf "$APP_DIR/bin/document" /usr/local/bin/document

# 5) Configuración y datos
mkdir -p "$DATA_DIR"
chown -R "$SVC_USER:$SVC_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<ENV
# Configuración de Smart Connection · Documentación de red
PORT=$PORT
HOST=0.0.0.0
DATA_DIR=$DATA_DIR
# Rama que sigue "document update"
BRANCH=$BRANCH
# Detrás de un proxy inverso con HTTPS, descomente estas dos líneas:
#TRUST_PROXY=1
#COOKIE_SECURE=1
# Mapa sin Internet: URL de un servidor de teselas propio
#TILE_URL=http://servidor-de-mapas/{z}/{x}/{y}.png
ENV
  chmod 644 "$ENV_FILE"
fi
set -a; . "$ENV_FILE"; set +a

# 6) Servicio systemd
NODE_BIN="$(command -v node)"
cat > "/etc/systemd/system/${SERVICE}.service" <<UNIT
[Unit]
Description=Smart Connection - Documentacion de red
After=network.target

[Service]
Type=simple
User=$SVC_USER
Group=$SVC_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN --disable-warning=ExperimentalWarning server/index.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now "$SERVICE" >/dev/null 2>&1

# 7) Comprobación
info "Esperando a que el servicio responda …"
up=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then up=1; break; fi
  sleep 1
done
[ "$up" -eq 1 ] || die "El servicio no responde. Revise: journalctl -u $SERVICE -n 50"

# 8) Administrador inicial (solo si no hay usuarios)
ADMIN_MSG=""
run_cli() { (cd "$APP_DIR" && DATA_DIR="$DATA_DIR" setpriv --reuid "$SVC_USER" --regid "$SVC_USER" --init-groups node --disable-warning=ExperimentalWarning server/cli.js "$@"); }
if [ "$(run_cli user-count 2>/dev/null || echo 1)" = "0" ]; then
  ADMIN_MSG="$(run_cli create-admin admin)"
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
ok "Instalación completada"
echo "   Acceso:          http://${IP:-<ip-del-contenedor>}:${PORT}"
echo "   Actualizar:      document update"
echo "   Estado / logs:   document status · document logs -f"
echo "   Respaldos:       document backup"
if [ -n "$ADMIN_MSG" ]; then
  echo
  echo "$ADMIN_MSG"
  echo "   Guarde esta contraseña ahora: no se vuelve a mostrar (puede restablecerla con: document create-admin admin)."
fi
