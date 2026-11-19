#!/bin/bash
# O Claude Code escuta os pedidos que o Rodrigo manda do app (Monitor com este script): cada linha nova de
# dados/fila.jsonl vira uma notificação. Enquanto roda, toca dados/.ouvinte a cada 20 s (o app mostra a bolinha verde).
DIR="$(cd "$(dirname "$0")" && pwd)/dados"
mkdir -p "$DIR"; touch "$DIR/fila.jsonl"
( while true; do touch "$DIR/.ouvinte"; sleep 20; done ) &
VIVO=$!
trap 'kill $VIVO 2>/dev/null; rm -f "$DIR/.ouvinte"' EXIT
tail -n0 -F "$DIR/fila.jsonl"
