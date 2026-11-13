"""Transcrição de vídeos do YouTube pela legenda (sem baixar o vídeo): dá pro Jarvis "assistir" um vídeo
que o Rodrigo manda no chat, do jeito que o Claude Code consegue com WebFetch num vídeo do X."""
import re

from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import NoTranscriptFound, TranscriptsDisabled, VideoUnavailable

ID_RE = re.compile(r"(?:v=|youtu\.be/|shorts/|embed/)([\w-]{11})")


def id_do_link(url_ou_id: str) -> str | None:
    if re.fullmatch(r"[\w-]{11}", url_ou_id):
        return url_ou_id
    m = ID_RE.search(url_ou_id)
    return m.group(1) if m else None


def transcrever(url_ou_id: str, idiomas: list[str] = ["pt", "pt-BR", "en"]) -> dict:
    """Texto corrido da legenda (manual ou automática) de um vídeo do YouTube, nos idiomas preferidos
    quando existem, ou na primeira legenda disponível."""
    vid = id_do_link(url_ou_id)
    if not vid:
        return {"erro": f"não achei um ID de vídeo do YouTube em: {url_ou_id}"}
    try:
        lista = YouTubeTranscriptApi().list(vid)
    except (TranscriptsDisabled, VideoUnavailable) as e:
        return {"erro": f"sem legenda disponível pra esse vídeo ({type(e).__name__})"}
    try:
        transcricao = lista.find_transcript(idiomas)
    except NoTranscriptFound:
        try:
            transcricao = next(iter(lista))
        except StopIteration:
            return {"erro": "esse vídeo não tem nenhuma legenda"}
    dados = transcricao.fetch()
    texto = " ".join(t.text.strip() for t in dados if t.text.strip())
    minutos = round(dados[-1].start / 60) if len(dados) else 0
    return {"id": vid, "idioma": transcricao.language_code, "gerada": transcricao.is_generated,
            "duracao_min": minutos, "texto": texto}
