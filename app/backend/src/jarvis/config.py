"""Caminhos e regras fixas do Jarvis."""
from pathlib import Path

VAULT = Path("/Users/rtadewald/Obsidian Notes")
APP = Path(__file__).resolve().parents[3]          # 20-jarvisOS/app
DADOS = APP / "dados"
DB = DADOS / "jarvis.db"
FRONT_DIST = APP / "frontend" / "dist"

# Q30: o agente escreve sem perguntar só aqui; o resto do vault é leitura.
ESCRITA_LIVRE = [VAULT / "1 Copies" / "0 Ideias", VAULT / "1 Copies" / "1 Priorizar"]

MODELO_CHAT = "claude-sonnet-5-5"   # Sonnet 5.5 (sem isto, herdaria o "opus" do settings.json do usuário)
MODELO_RADAR = "haiku"    # classificação e "por que importa" dos sinais
