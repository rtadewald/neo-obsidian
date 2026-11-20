import { exportarPdf } from './exportarPdf'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { Sumario } from './Sumario'
import { Editor } from './Editor'
import type { Extra } from './propriedades'
import { Icone } from './Icone'
import { mudarStatus as statusComDesfazer } from './desfazer'
import { PASTA, obsidian, type Raiz } from './notas'
import { STATUS, type Alvo, type Producao } from './canvasApi'

/** O painel de uma nota (cabeçalho, propriedades, editor e sumário): a Redação e a página Skills usam. */
type Nota = { nome: string; raiz: Raiz; caminho: string; texto: string; mtime: number }
type Estado = 'salvo' | 'editando' | 'salvando' | 'conflito' | 'erro'
const urlNota = (a: Alvo) => `/api/notas/${a.raiz}/${encodeURIComponent(a.nome)}`
const ROTULO: Record<Estado, string> = { salvo: 'Salvo', editando: 'Editando…', salvando: 'Salvando…', conflito: 'Mudou no Obsidian', erro: 'Erro ao salvar' }

async function acao(a: Alvo, corpo: Record<string, string>) {
  const r = await fetch(`${urlNota(a)}/acao`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.detail || 'Não deu certo.')
  return d as Alvo
}

/** `fixo` (página Skills): o título não renomeia, para os arquivos das skills. */
export function PainelNota({ alvo, prod, versao, onMudou, avisar, onLink, fixo }: {
  alvo: Alvo; prod?: Producao; versao?: number; onLink: (nome: string, nova?: boolean) => void; fixo?: boolean
  onMudou: (novo?: Alvo) => void; avisar: (m: string) => void
}) {
  const [nota, setNota] = useState<Nota | null>(null)
  const [texto, setTexto] = useState('')
  const [estado, setEstado] = useState<Estado>('salvo')
  const [titulo, setTitulo] = useState<string | null>(null)
  // o sumário da direita pode sair (vale para todas as notas e para a página Skills; fica guardado)
  const [semSumario, setSemSumario] = useState(() => { try { return localStorage.getItem('sumario-oculto') === '1' } catch { return false } })
  const alternarSumario = () => setSemSumario((v) => { try { localStorage.setItem('sumario-oculto', v ? '0' : '1') } catch { /* sem storage */ } return !v })
  // ⌘] mostra/oculta o sumário (vale também com o cursor no editor)
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || !(e.key === ']' || e.code === 'BracketRight')) return
      e.preventDefault(); e.stopPropagation()
      alternarSumario()
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const view = useRef<EditorView | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const ref = useRef({ nota, texto, estado })
  ref.current = { nota, texto, estado }

  const abrir = useCallback(async () => {
    const r = await fetch(urlNota(alvo))
    if (!r.ok) { setNota(null); return }
    const n: Nota = await r.json()
    setNota(n); setTexto(n.texto); setEstado('salvo')
  }, [alvo])
  useEffect(() => { abrir() }, [abrir])

  const salvar = useCallback(async () => {
    const { nota: n, texto: t, estado: e } = ref.current
    window.clearTimeout(timer.current)
    if (!n || e === 'salvo' || e === 'conflito') return
    setEstado('salvando')
    const r = await fetch(urlNota(n), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: t, mtime: n.mtime }) })
    if (r.status === 409) { setEstado('conflito'); return }
    if (!r.ok) { setEstado('erro'); return }
    const { mtime } = await r.json()
    setNota((x) => (x ? { ...x, mtime, texto: t } : x))
    setEstado(ref.current.texto === t ? 'salvo' : 'editando')
  }, [])
  useEffect(() => () => { if (ref.current.estado === 'editando') salvar() }, [salvar])

  // a nota mudou no vault (o Claude Code escreveu nela)
  useEffect(() => {
    const n = ref.current.nota
    if (!versao || !n || ref.current.estado !== 'salvo') return
    fetch(urlNota(n)).then((r) => (r.ok ? r.json() : null)).then((d: Nota | null) => {
      if (d && ref.current.estado === 'salvo' && d.mtime !== ref.current.nota?.mtime) { setNota(d); setTexto(d.texto) }
    }).catch(() => {})
  }, [versao])

  function mudar(v: string) {
    setTexto(v)
    setEstado((e) => (e === 'conflito' ? e : 'editando'))
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(salvar, 1000)
  }

  async function executar(f: () => Promise<Alvo | void>, msg?: string) {
    await salvar()
    try {
      const d = await f()
      if (msg) avisar(msg)
      onMudou(d && d.nome ? { raiz: d.raiz, nome: d.nome } : undefined)
      if (!d || !d.nome) abrir()
    } catch (e) { avisar((e as Error).message) }
  }

  // pela rota do canvas, que deixa a mudança no ⌘Z do app (vale depois de fechar a nota)
  // o status novo aparece na hora; o do servidor toma o lugar quando a nota recarrega
  const [stLocal, setStLocal] = useState<string | null>(null)
  useEffect(() => setStLocal(null), [prod?.status, prod?.nome])
  const mudarStatus = (s: string) => {
    if (!prod || s === (stLocal ?? prod.status)) return
    setStLocal(s)
    const msg = s === 'publicado' ? 'Publicada' : prod.raiz === 'publicados' ? 'Voltou para Priorizar' : undefined
    return executar(async () => {
      const r = await statusComDesfazer([{ nome: alvo.nome, status: prod.status }], s)
      const n = r.notas[0]
      return n ? { raiz: n.raiz as Raiz, nome: n.nome } : undefined
    }, msg)
  }

  const mudarData = (data: string) => data && executar(async () => {
    const r = await fetch(`${urlNota(alvo)}/agenda`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) })
    if (!r.ok) throw new Error('Não consegui mudar a data.')
  }, 'Data mudou')
  const mudarDatas = (datas: string[]) => datas.length && executar(async () => {
    const r = await fetch(`${urlNota(alvo)}/agenda`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ datas }) })
    if (!r.ok) throw new Error('Não consegui mudar as datas.')
  }, datas.length > 1 ? `${datas.length} datas` : 'Data mudou')

  async function confirmarTitulo() {
    const v = titulo?.trim()
    setTitulo(null)
    if (v && v !== alvo.nome) await executar(() => acao(alvo, { acao: 'renomear', novo: v }))
  }

  const caminho = nota?.caminho ?? `${PASTA[alvo.raiz]}/${alvo.nome}.md`

  const extra: Extra = prod ? {
    status: { valor: stLocal ?? prod.status, opcoes: STATUS.map((x) => ({ k: x.k, rotulo: `${x.marca} ${x.nome}` })), mudar: mudarStatus },
    onData: mudarData,
    onDatas: mudarDatas,
    onPublicado: (sim) => mudarStatus(sim ? 'publicado' : prod.scheduled ? 'agendado' : 'edicao'),
    onLink,
  } : { onLink }

  if (!nota) return <div className="modal-corpo"><p className="mudo">Carregando…</p></div>

  return (
    <>
      <div className={`modal-topo ${semSumario ? "sem-sumario" : ""}`}>
        <div className="modal-titulo">
          <p className="ideias-caminho">{caminho.split('/').slice(0, -1).join(' / ')}</p>
          {titulo !== null ? (
            <form onSubmit={(e) => { e.preventDefault(); confirmarTitulo() }}>
              <input className="ideias-titulo-campo" autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} onBlur={confirmarTitulo}
                onFocus={(e) => e.target.select()} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setTitulo(null) } }} aria-label="Nome da nota" />
            </form>
          ) : fixo ? <h1>{alvo.nome.split('/').pop()}</h1>
            : <h1 className="is-editavel" title="Clique para renomear" onClick={() => setTitulo(alvo.nome)}>{alvo.nome}</h1>}
        </div>
        {/* o estado só aparece quando pede atenção (conflito com o Obsidian ou erro ao salvar) */}
        {(estado === 'conflito' || estado === 'erro') && <span className={`ideias-estado is-${estado}`}>
          {estado === 'conflito' ? <button onClick={abrir}>{ROTULO[estado]} · recarregar</button> : ROTULO[estado]}
        </span>}
        <button className={`btn-icone ${semSumario ? '' : 'is-on'}`} onClick={alternarSumario} aria-pressed={!semSumario}
          title={semSumario ? 'Mostrar o sumário (⌘])' : 'Esconder o sumário (⌘])'} aria-label={semSumario ? 'Mostrar o sumário' : 'Esconder o sumário'}>
          <svg className="i" width="15" height="15" viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3.5" width="14" height="13" rx="2.5" /><path d="M12.5 3.5v13M14.6 7.2h-.1M14.6 10h-.1" /></svg></button>
        {fixo
          ? <a className="btn-icone" href={obsidian(alvo.raiz, alvo.nome)} title="Abrir no Obsidian"><Icone n="seta" t={14} /></a>
          : <button className="btn-icone" onClick={async () => { await salvar(); exportarPdf(alvo.nome, ref.current.texto) }} title="Exportar em PDF" aria-label="Exportar em PDF">
              <svg className="i" width="15" height="15" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.8h6.5L15.5 7v10.2H5z" /><path d="M11.5 2.8V7h4M10.2 9.4v5.2M7.9 12.4l2.3 2.3 2.3-2.3" /></svg></button>}
      </div>

      <div className={`modal-corpo modal-corpo--sumario ${semSumario ? "sem-sumario" : ""}`}>
        <div className="modal-editor">
          <Editor chave={`${alvo.raiz}/${alvo.nome}`} valor={texto} onMudar={mudar} onSalvar={salvar} viewRef={view} extra={extra} onLink={onLink} />
        </div>
        {!semSumario && <Sumario key={`${alvo.raiz}/${alvo.nome}`} texto={texto} view={view} />}
      </div>
    </>
  )
}
