import { useEffect, useState } from 'react'
import { api } from './api'

const TEXTO: Record<string, [string, string]> = {
  Instagram: ['Radar do Instagram', 'Reels que estão viralizando nos perfis que você acompanha e nos concorrentes, no mesmo formato das abas X e Sites: cards, foco, likes e levar ao Jarvis.'],
  Ideias: ['Mesa da ideia', 'Fonte à esquerda, ângulos, hooks e roteiro no centro, com o chat daquela ideia. Salvas → em desenvolvimento (1 Copies/0 Ideias) → Priorizar.'],
  Desempenho: ['Desempenho no Metricool', 'Histórico de posts, desempenho de cada um e o que está agendado para os próximos dias.'],
  Skills: ['Skills do vault', 'Lista das skills de 3 Skills/ e editor do SKILL.md, com mudanças propostas pelo chat em diff.'],
  Calendário: ['Calendário', 'Mês somente leitura: Prazos do Notion e agendados do Metricool, com sugestões para os dias vazios.'],
  Config: ['Configurações', 'Fontes do radar, frequência da coleta, conta do Instagram dedicada e temas.'],
}

export function EmBreve({ pagina }: { pagina: string }) {
  const [titulo, desc] = TEXTO[pagina] ?? [pagina, '']
  const [mc, setMc] = useState<string>('')
  useEffect(() => {
    if (pagina === 'Desempenho') api.metricool().then((r) => setMc(r.conectado ? 'Conectado.' : r.motivo)).catch(() => {})
  }, [pagina])
  return (
    <div className="embreve">
      <h1 className="titulo">{titulo}</h1>
      <div className="vazio glass glass--light">
        <p className="embreve-tag">Próxima etapa</p>
        <p>{desc}</p>
        {mc && <p className="mudo">{mc}</p>}
      </div>
    </div>
  )
}
