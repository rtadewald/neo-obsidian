#!/usr/bin/env bash
# Sobe o Neo-Obsidian pelo terminal: API (porta 8740) + front (porta 5180) e abre o navegador.
#   neo-obsidian          sobe tudo (Ctrl+C derruba os dois)
#   neo-obsidian parar    derruba o que estiver rodando nas portas do app
#   neo-obsidian abrir    só abre o navegador
set -u
APP="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
URL="http://localhost:5180"
API_PORTA=8740
WEB_PORTA=5180

ocupada() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null; }

parar() {
  for p in $API_PORTA $WEB_PORTA; do
    pids=$(ocupada "$p")
    [ -n "$pids" ] && kill $pids 2>/dev/null && echo "parado o que rodava na porta $p"
  done
}

case "${1:-}" in
  parar) parar; exit 0 ;;
  abrir) open "$URL"; exit 0 ;;
esac

if [ -n "$(ocupada $API_PORTA)" ] && [ -n "$(ocupada $WEB_PORTA)" ]; then
  echo "O Neo-Obsidian já está rodando. Abrindo $URL"
  echo "(para reiniciar: neo-obsidian parar && neo-obsidian)"
  open "$URL"
  exit 0
fi
parar >/dev/null   # se só uma das partes ficou de pé, recomeça limpo

echo "Subindo o Neo-Obsidian…"
uv run --directory "$APP/backend" jarvis &
API=$!
npm --prefix "$APP/frontend" run dev -- --clearScreen false &
WEB=$!

trap 'echo; echo "Desligando o Neo-Obsidian…"; kill $API $WEB 2>/dev/null; wait 2>/dev/null; exit 0' INT TERM

# espera os dois responderem e abre o navegador
for _ in $(seq 1 60); do
  if curl -s -o /dev/null "http://127.0.0.1:$API_PORTA/api/notas-indice" && curl -s -o /dev/null "$URL"; then
    echo
    echo "  ✅ Neo-Obsidian no ar: $URL   (Ctrl+C para desligar)"
    echo
    open "$URL"
    break
  fi
  sleep 0.5
done

# se um dos dois cair, derruba o outro e avisa
while kill -0 $API 2>/dev/null && kill -0 $WEB 2>/dev/null; do sleep 2; done
echo "Uma das partes do Neo-Obsidian parou; desligando a outra."
kill $API $WEB 2>/dev/null
wait 2>/dev/null
exit 1
