"""Caminhos e regras fixas do Jarvis."""
from pathlib import Path

VAULT = Path("/Users/rtadewald/Obsidian Notes")
APP = Path(__file__).resolve().parents[3]          # 20-neo-obsidian/app
DADOS = APP / "dados"
DB = DADOS / "jarvis.db"
FRONT_DIST = APP / "frontend" / "dist"


MODELO_CHAT = "claude-sonnet-5-5"   # Sonnet 5.5 (sem isto, herdaria o "opus" do settings.json do usuário)
MODELO_RADAR = "haiku"    # classificação e "por que importa" dos sinais

# perfil "Claude Profile" do Chrome (deviceId da extensão Claude in Chrome nele): X e Instagram do radar rodam só nele,
# longe do Chrome do dia a dia. Fica em app/dados/chrome.json ({"perfil": "<deviceId>"}), fora do git. Se a extensão
# for reinstalada, o id muda: veja list_connected_browsers.
def _chrome_perfil() -> str:
    import json
    try:
        return json.loads((DADOS / "chrome.json").read_text(encoding="utf-8"))["perfil"]
    except (OSError, ValueError, KeyError):
        return ""


CHROME_PERFIL = _chrome_perfil()
