import { useEffect, useMemo, useState } from 'react'
import { Icone } from './Icone'

/** Leque do JCO-359: o orbe lima no canto inferior esquerdo se projeta em arcos com as skills do vault.
 *  1º arco: Config e Todas as skills (setores de vidro escuro). Arcos de fora: uma peça por skill. */
export type SkillResumo = { nome: string; descricao: string; grupo: string; referencias: number }

const O = 44                                   // centro do orbe, a partir do canto inferior esquerdo (px)
const ANEIS = [{ r: 260, n: 3 }, { r: 400, n: 4 }, { r: 540, n: 5 }, { r: 690, n: 6 }]
const A0 = 6, A1 = 84                          // ângulos (graus, acima da horizontal)
const ORDEM_GRUPO = ['Reels e carrosséis', 'Pesquisa', 'Copy', 'VSL']
const COR_GRUPO: Record<string, string> = { 'Reels e carrosséis': '#e2f05c', Pesquisa: '#9fd8ff', Copy: '#f2b880', VSL: '#d7a6ff' }

const rad = (g: number) => (g * Math.PI) / 180
const legivel = (n: string) => n.replace(/-/g, ' ')

function setor(r0: number, r1: number, de: number, ate: number) {
  // coordenadas do SVG com origem no orbe e y para cima (o SVG é virado no CSS)
  const p = (r: number, a: number) => `${(r * Math.cos(rad(a))).toFixed(1)} ${(r * Math.sin(rad(a))).toFixed(1)}`
  return `M${p(r0, de)} L${p(r1, de)} A${r1} ${r1} 0 0 1 ${p(r1, ate)} L${p(r0, ate)} A${r0} ${r0} 0 0 0 ${p(r0, de)}Z`
}

export function Leque({ aberto, skills, onSkill, onTodas, onConfig, onFechar }: {
  aberto: boolean; skills: SkillResumo[]
  onSkill: (nome: string) => void; onTodas: () => void; onConfig: () => void; onFechar: () => void
}) {
  const [sobre, setSobre] = useState<SkillResumo | null>(null)
  const [escala, setEscala] = useState(1)

  useEffect(() => {
    const ajusta = () => setEscala(Math.min(1, (window.innerHeight - 70) / 790, (window.innerWidth - 40) / 820))
    ajusta()
    window.addEventListener('resize', ajusta)
    return () => window.removeEventListener('resize', ajusta)
  }, [])
  useEffect(() => {
    if (!aberto) { setSobre(null); return }
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onFechar()
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [aberto, onFechar])

  const pecas = useMemo(() => {
    const ordem = [...skills].sort((a, b) => ORDEM_GRUPO.indexOf(a.grupo) - ORDEM_GRUPO.indexOf(b.grupo) || a.nome.localeCompare(b.nome))
    const out: { s: SkillResumo; x: number; y: number; anel: number }[] = []
    let i = 0
    ANEIS.forEach(({ r, n }, anel) => {
      for (let k = 0; k < n && i < ordem.length; k++, i++) {
        const a = rad(A0 + ((A1 - A0) * (k + 0.5)) / n)
        out.push({ s: ordem[i], x: r * Math.cos(a), y: r * Math.sin(a), anel })
      }
    })
    return out
  }, [skills])

  const fazer = (fn: () => void) => () => { fn(); onFechar() }

  return (
    <div className={`leque-veu ${aberto ? 'is-aberto' : ''}`} onClick={onFechar} aria-hidden={!aberto}>
      <div className="leque" style={{ transform: `scale(${escala})` }} onClick={(e) => e.stopPropagation()} role="menu" aria-label="Skills e configurações">
        <svg className="leque-svg" viewBox="-20 -20 240 240" width="240" height="240" aria-hidden="true">
          <path className="leque-setor" d={setor(72, 186, 6, 43)} />
          <path className="leque-setor" d={setor(72, 186, 47, 84)} />
        </svg>
        {[{ nome: 'Config', icone: 'config', a: 24.5, fn: onConfig }, { nome: 'Todas as skills', icone: 'skills', a: 65.5, fn: onTodas }].map((b) => (
          <button key={b.nome} role="menuitem" tabIndex={aberto ? 0 : -1} className="leque-base"
            style={{ left: O + 129 * Math.cos(rad(b.a)), bottom: O + 129 * Math.sin(rad(b.a)) }} onClick={fazer(b.fn)}>
            <Icone n={b.icone} t={18} /><span>{b.nome}</span>
          </button>
        ))}
        {pecas.map(({ s, x, y, anel }, i) => (
          <button key={s.nome} role="menuitem" tabIndex={aberto ? 0 : -1} className="peca"
            style={{ left: O + x, bottom: O + y, ['--dx' as string]: `${-x}px`, ['--dy' as string]: `${y}px`, transitionDelay: aberto ? `${80 + anel * 70 + i * 12}ms` : '0ms' }}
            onMouseEnter={() => setSobre(s)} onFocus={() => setSobre(s)} onClick={fazer(() => onSkill(s.nome))}>
            <i style={{ background: COR_GRUPO[s.grupo] }} />
            <span>{legivel(s.nome)}</span>
          </button>
        ))}
      </div>
      <div className={`leque-legenda ${sobre ? 'is-on' : ''}`} onClick={(e) => e.stopPropagation()}>
        {sobre ? (
          <>
            <p className="legenda-grupo"><i style={{ background: COR_GRUPO[sobre.grupo] }} />{sobre.grupo}{sobre.referencias ? ` · ${sobre.referencias} referência${sobre.referencias > 1 ? 's' : ''}` : ''}</p>
            <p className="legenda-nome">{legivel(sobre.nome)}</p>
            <p className="legenda-desc">{sobre.descricao || 'Sem descrição no SKILL.md.'}</p>
            <p className="legenda-dica">Clique para abrir</p>
          </>
        ) : null}
      </div>
    </div>
  )
}

export function Orbe({ aberto, onClick }: { aberto: boolean; onClick: () => void }) {
  return (
    <button className={`orbe ${aberto ? 'is-aberto' : ''}`} onClick={onClick}
      aria-label={aberto ? 'Fechar skills' : 'Abrir skills e configurações'} title="Skills e configurações" aria-expanded={aberto}>
      <span className="pupila" />
    </button>
  )
}
