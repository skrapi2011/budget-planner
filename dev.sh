#!/usr/bin/env bash
# dev.sh — uruchamia backend (Flask :3001) i frontend (Vite :5173) razem.
#
#   ./dev.sh            # oba procesy, Ctrl+C zatrzymuje oba
#   ./dev.sh backend    # tylko backend
#   ./dev.sh frontend   # tylko frontend
#
# Logi sa prefiksowane ([backend] / [frontend]), zeby przeplatane wiersze
# pozostaly czytelne. Skrypt jest odporny na:
#   - brak backend/data/ (swiezy clone — SQLite nie otwiera pliku w nieistniejacym katalogu)
#   - brak frontend/node_modules (uruchamia npm install)
#   - brak python deps (wywala czytelny komunikat z komandem, nie traceback)
#   - zajete porty (pokazuje PID ocupanta i stopuje, nie startuje polowicznie)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"
BACKEND_PORT=3001
FRONTEND_PORT=5173
READY_TIMEOUT=90

c_dim=$'\033[2m'; c_red=$'\033[31m'; c_grn=$'\033[32m'; c_yel=$'\033[33m'; c_off=$'\033[0m'
info()  { printf '%s\n' "$c_dim$*$c_off"; }
ok()    { printf '%s\n' "$c_grn$*$c_off"; }
warn()  { printf '%s\n' "$c_yel$*$c_off" >&2; }
die()   { printf '%s\n' "$c_red$*$c_off" >&2; exit 1; }

target="${1:-all}"
case "$target" in all|backend|frontend) ;; *) die "Nieznany argument: $target (uzyj: all | backend | frontend)" ;; esac

# ---- 1. Zaleznosci ----------------------------------------------------------------

if ! command -v python3 >/dev/null; then die "Brak python3 w PATH"; fi

if [ "$target" != frontend ]; then
  # Brak requirements.txt w repo (AGENTS.md §9.7) — sprawdzamy importy wprost.
  if ! python3 -c "import flask, jwt, flask_cors" >/dev/null 2>&1; then
    die "Brak python deps. Zainstaluj:  python3 -m pip install flask pyjwt flask-cors"
  fi
fi

if [ "$target" != backend ]; then
  if ! command -v npm >/dev/null; then die "Brak npm w PATH"; fi
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    info "frontend: brak node_modules — uruchamiam npm install (to moze potrwac)"
    ( cd "$FRONTEND_DIR" && npm install )
  fi
fi

# ---- 2. Katalog bazy (swiezy clone) ------------------------------------------------

# .gitignore zawiera "!backend/data/.gitkeep", ale plik nie istnieje, wiec
# swiezy clone nie ma backend/data/ -> sqlite3: "unable to open database file".
mkdir -p "$BACKEND_DIR/data"

# ---- 3. Porty ---------------------------------------------------------------------

port_pid() {
  # Najpierw lsof, potem /proc (minimalne systemy bez lsof/ss).
  # Zawsze exit 0 — przy `set -e` niepudany lsof w podstawieniu wywalilby skrypt.
  local pid=""
  if command -v lsof >/dev/null; then
    pid="$(lsof -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1 || true)"
  elif command -v fuser >/dev/null; then
    pid="$(fuser "$1/tcp" 2>/dev/null | awk '{print $1}' || true)"
  fi
  printf '%s' "${pid:-}"
  return 0
}

check_port() {
  local p="$1" name="$2" pid
  pid="$(port_pid "$p")" || true
  if [ -n "${pid:-}" ]; then
    die "Port $p ($name) jest zajety przez PID $pid ($(ps -o comm= -p "$pid" 2>/dev/null || echo '?')). Zwolnij port lub zmien port w $BACKEND_DIR/App.py / $FRONTEND_DIR/vite.config.js"
  fi
}

[ "$target" != frontend ] && check_port "$BACKEND_PORT" "backend" || true
[ "$target" != backend ] && check_port "$FRONTEND_PORT" "frontend" || true

# ---- 4. Processy ------------------------------------------------------------------

PIDS=()

# Kazdy proces idzie do WLASNEJ grupy (setsid). Flask z debug=True startuje
# reloader (dwie pythonki), `npm run dev` to pipeline npm->vite->esbuild.
# Sam `kill $pid` zabija tylko otazajacy subshell, a python/vite zostaja.
# `kill -- -PGID` zabija cala grupe.
start_backend() {
  setsid bash -c "cd '$BACKEND_DIR' && exec python3 App.py 2>&1 | sed -u 's/^/[backend]  /'" &
  PIDS+=($!)
}

start_frontend() {
  setsid bash -c "cd '$FRONTEND_DIR' && exec npm run dev 2>&1 | sed -u 's/^/[frontend] /'" &
  PIDS+=($!)
}

cleanup() {
  trap - INT TERM EXIT
  for pid in "${PIDS[@]}"; do
    kill -TERM -- -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
  done
  wait 2>/dev/null || true
}
trap 'cleanup; exit 0' INT TERM
trap cleanup EXIT

wait_for() {
  local url="$1" name="$2" i
  for ((i = 0; i < READY_TIMEOUT * 2; i++)); do
    if curl -s -o /dev/null --max-time 2 "$url"; then return 0; fi
    sleep 0.5
  done
  warn "$name nie odpowiedzial w ${READY_TIMEOUT}s pod $url — patrz log powyzej"
  return 1
}

[ "$target" != frontend ] && start_backend || true
[ "$target" != backend ] && start_frontend || true

# Frontend proxy /api -> 127.0.0.1:3001 (vite.config.js), wiec backend musi wstac pierwszy.
if [ "$target" != frontend ]; then
  info "Czekam na backend  http://127.0.0.1:$BACKEND_PORT ..."
  wait_for "http://127.0.0.1:$BACKEND_PORT/api/auth/login" "backend"
fi
if [ "$target" != backend ]; then
  info "Czekam na frontend http://localhost:$FRONTEND_PORT ..."
  wait_for "http://localhost:$FRONTEND_PORT/" "frontend"
fi

echo
ok "Uruchomione. Ctrl+C zatrzymuje oba procesy."
[ "$target" != frontend ] && ok "  backend:  http://127.0.0.1:$BACKEND_PORT" || true
[ "$target" != backend ] && ok "  frontend: http://localhost:$FRONTEND_PORT  (demo: admin / admin123)" || true
echo

# Trzymaj skrypt zywym, zeby Ctrl+C trafil w trap.
# UWAGA: bash w `wait -n` NIE obsluga trapu SIGINT (sygnal jest odroczony do
# konca `wait`, a `wait` konczy dopiero gdy child padnie) — w terminalu Ctrl+C
# nie zabijalo procesow. Petla z `sleep` konczy sie co 0.5 s, wiec trapchodzi
# natychmiast. `kill -0` wykryje rowniez padniecie ktoregos procesu.
while [ ${#PIDS[@]} -gt 0 ]; do
  for pid in "${PIDS[@]}"; do
    kill -0 "$pid" 2>/dev/null || { warn "Proces $pid padl — zatrzymuje dev.sh"; cleanup; exit 1; }
  done
  sleep 0.5
done
cleanup
