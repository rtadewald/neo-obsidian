"""Autenticação do agente — o único ponto que sabe como o Jarvis fala com o Claude.

Decisão Q9 (specs.md): usar o login da assinatura do Claude Code (`claude /login`), não chave de API.
Se a ANTHROPIC_API_KEY estiver no ambiente, o CLI a prefere e cobra por uso; por isso ela é retirada aqui.
Para trocar para chave de API, basta mudar este módulo.
"""
import os


def preparar() -> str:
    """Ajusta o ambiente do processo antes de qualquer sessão do SDK. Devolve o modo em uso."""
    os.environ.pop("ANTHROPIC_API_KEY", None)
    return "assinatura"
