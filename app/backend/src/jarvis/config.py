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


def _pasta_perfil() -> str:
    """A pasta do perfil "Claude Profile" no Chrome (ex.: "Profile 5"), lida do Local State."""
    import json
    try:
        info = json.loads((Path.home() / "Library/Application Support/Google/Chrome/Local State").read_text())["profile"]["info_cache"]
        return next((k for k, v in info.items() if v.get("name") == "Claude Profile"), "")
    except (OSError, ValueError, KeyError):
        return ""


def abrir_perfil_chrome() -> bool:
    """Abre o Chrome no perfil "Claude Profile" (a extensão conecta sozinha quando ele abre)."""
    import subprocess
    pasta = _pasta_perfil()
    if not pasta:
        return False
    subprocess.run(["open", "-na", "Google Chrome", "--args", f"--profile-directory={pasta}"], check=False)
    return True


async def com_perfil(rodar) -> str:
    """Roda a sessão do Chrome; se o perfil Claude Profile estiver fechado (SEM_PERFIL), abre ele e tenta de novo."""
    import asyncio
    final = await rodar()
    if "SEM_PERFIL" in final and abrir_perfil_chrome():
        await asyncio.sleep(12)   # tempo de o Chrome abrir e a extensão conectar
        final = await rodar()
    return final
