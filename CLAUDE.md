# Neo-Obsidian

App local (FastAPI + React Flow) por cima do vault do Obsidian: ideias de conteúdo num canvas, as produções de cada
ideia num card, o radar e o chat do Jarvis. **Antes de qualquer trabalho, leia o [AGENTS.md](AGENTS.md)**: as regras,
o de-para do vault (pastas, emojis, frontmatter, links), o modelo do canvas, cada tela e cada processo.

- Rodar: `neo-obsidian` (API na 8740, front na 5180). A API não recarrega sozinha: reinicie depois de mexer em Python.
- Tipos do front: `npx tsc --noEmit -p tsconfig.app.json` em `app/frontend`.
- PT-BR em tudo. Commit só quando o Rodrigo pedir. O repositório é público: nada de notas, `app/dados/` ou chaves.
- Decisões e escopo: [specs.md](specs.md).
