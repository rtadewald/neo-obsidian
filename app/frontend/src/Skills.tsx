import { useEffect, useState } from 'react'
import type { SkillResumo } from './Menu'
import { Texto } from './Chat'

type Skill = { nome: string; descricao: string; corpo: string; referencias: string[] }

/** Skills do vault, só leitura (editar com diff pelo chat vem depois). */
export function Skills({ lista, aberta, onAbrir }: { lista: SkillResumo[]; aberta: string | null; onAbrir: (n: string) => void }) {
  const [skill, setSkill] = useState<Skill | null>(null)
  const atual = aberta ?? lista[0]?.nome ?? null

  useEffect(() => {
    if (!atual) return
    fetch(`/api/skills/${encodeURIComponent(atual)}`).then((r) => r.json()).then(setSkill).catch(() => setSkill(null))
  }, [atual])

  return (
    <div className="skills">
      <h1 className="titulo">Skills</h1>
      <p className="sub">{lista.length} skills em <code>3 Skills/</code> · só leitura por enquanto</p>
      <div className="skills-corpo">
        <nav className="skills-lista glass glass--light" aria-label="Skills">
          {lista.map((s) => (
            <button key={s.nome} className={`skills-item ${s.nome === atual ? 'is-ativa' : ''}`} onClick={() => onAbrir(s.nome)}>
              <span>{s.nome}</span>
              <small>{s.grupo}</small>
            </button>
          ))}
        </nav>
        <article className="skills-leitor glass glass--light">
          {skill ? (
            <>
              <p className="legenda-grupo">{skill.nome}{skill.referencias.length ? ` · ${skill.referencias.length} em references/` : ''}</p>
              {skill.descricao && <p className="skills-desc">{skill.descricao}</p>}
              <div className="skills-md"><Texto md={skill.corpo} /></div>
            </>
          ) : <p className="mudo">Carregando…</p>}
        </article>
      </div>
    </div>
  )
}
