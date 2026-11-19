import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarioEditorial } from './CalendarioEditorial'
import { PainelNota } from './ModalNota'
import { ModalTabela, tabelaSalva, type EstadoTabela } from './Tabela'
import { carregarTudo, listarCanvases, post, tudoEmCache, type Alvo, type EstadoCanvas, type StatusProd } from './canvasApi'
import { mudarStatus, registrarAcao } from './desfazer'
import type { Trecho } from './notas'
import { avisar } from './porta'

/** Redação: a tabela das copies (as mesmas abas, filtros e ações da tabela do canvas) com a nota aberta à direita,
 *  como no Obsidian, e um calendário que abre no lugar da nota: arrastar uma linha da tabela para um dia agenda a copy
 *  (`scheduled`). Todas as copies, de todos os canvas. */
const CHAVE_ABAS = 'redacao-abas'   // as copies abertas em abas (como no Obsidian) e qual está à frente
export const EVENTO_REDACAO = 'redacao-abrir'   // a busca (⌘O) abre uma copy aqui: {alvo, nova}
const CHAVE_CAL = 'redacao-calendario'
const CHAVE_LARG = 'redacao-largura'   // fração da largura que a tabela ocupa (a divisória arrasta)

export function Redacao({ versao, onTrecho }: { versao?: number; onTrecho?: (t: Trecho, pedido?: string) => void }) {
  const [est, setEst] = useState<EstadoCanvas | null>(() => tudoEmCache())   // abre na hora com o que o app já tem
  const [icones, setIcones] = useState<Record<string, string>>({})
  const [t, setT] = useState<EstadoTabela>(() => tabelaSalva('ideias'))
  const [abas, setAbas] = useState<{ lista: Alvo[]; ativa: number }>(() => { try { return JSON.parse(localStorage.getItem(CHAVE_ABAS) || 'null') ?? { lista: [], ativa: 0 } } catch { return { lista: [], ativa: 0 } } })
  const aberta: Alvo | null = abas.lista[abas.ativa] ?? null
  const mesma = (a: Alvo, b: Alvo) => a.raiz === b.raiz && a.nome === b.nome
  // abrir: na aba da frente (troca a copy dela) ou, com `nova` (⌘+clique, ⌘↵ na busca), numa aba nova; já aberta, só vai para ela
  const abrirEm = useCallback((a: Alvo, nova?: boolean) => setAbas(({ lista, ativa }) => {
    const i = lista.findIndex((x) => mesma(x, a))
    if (i >= 0) return { lista, ativa: i }
    if (nova || !lista.length) return { lista: [...lista, a], ativa: lista.length }
    return { lista: lista.map((x, k) => (k === ativa ? a : x)), ativa }
  }), [])
  const setAberta = (a: Alvo | null) => setAbas(({ lista, ativa }) => a ? { lista: lista.map((x, k) => (k === ativa ? a : x)), ativa } : fecharLista(lista, ativa))
  const fecharLista = (lista: Alvo[], i: number) => { const l = lista.filter((_, k) => k !== i); return { lista: l, ativa: Math.max(0, Math.min(i, l.length - 1)) } }
  const fechar = (i: number) => setAbas(({ lista, ativa }) => { const r = fecharLista(lista, i); return { ...r, ativa: i < ativa ? ativa - 1 : r.ativa } })
  // ⌘[ esconde a tabela: só a copy, como no Obsidian
  const [soCopy, setSoCopy] = useState(false)
  const [cal, setCal] = useState<boolean>(() => { try { return localStorage.getItem(CHAVE_CAL) === 'sim' } catch { return false } })
  const [calVersao, setCalVersao] = useState(0)
  // divisória entre a tabela e a nota: arrastar muda a proporção (fica guardada); duplo clique volta ao meio
  const [frac, setFrac] = useState<number>(() => { try { return Number(localStorage.getItem(CHAVE_LARG)) || 0.48 } catch { return 0.48 } })
  useEffect(() => { try { localStorage.setItem(CHAVE_LARG, String(frac)) } catch { /* sem storage */ } }, [frac])
  const caixa = useRef<HTMLDivElement>(null)
  const arrastar = (e: React.PointerEvent) => {
    const r = caixa.current?.getBoundingClientRect()
    if (!r) return
    e.preventDefault()
    const mover = (ev: PointerEvent) => setFrac(Math.min(0.8, Math.max(0.22, (ev.clientX - r.left) / r.width)))
    const soltar = () => { window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar); document.body.classList.remove('arrastando') }
    document.body.classList.add('arrastando')
    window.addEventListener('pointermove', mover); window.addEventListener('pointerup', soltar)
  }
  useEffect(() => { try { localStorage.setItem(CHAVE_ABAS, JSON.stringify(abas)) } catch { /* sem storage */ } }, [abas])
  useEffect(() => {
    const ev = (e: Event) => { const d = (e as CustomEvent<{ alvo: Alvo; nova?: boolean }>).detail; abrirEm(d.alvo, d.nova); setCal(false) }
    const tecla = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === '[' || e.code === 'BracketLeft') && !document.querySelector('.modal-fundo, .paleta-fundo')) {
        e.preventDefault(); e.stopPropagation(); setSoCopy((v) => !v)
      }
    }
    window.addEventListener(EVENTO_REDACAO, ev); window.addEventListener('keydown', tecla, true)
    return () => { window.removeEventListener(EVENTO_REDACAO, ev); window.removeEventListener('keydown', tecla, true) }
  }, [abrirEm])
  useEffect(() => { try { localStorage.setItem(CHAVE_CAL, cal ? 'sim' : 'nao') } catch { /* sem storage */ } }, [cal])

  const recarregar = useCallback(async () => {
    const tudo = await carregarTudo().catch(() => null)
    if (tudo) setEst(tudo)
  }, [])
  // a nota salva a cada pausa na digitação e o vault avisa (versao): recarregar tudo a cada tecla travava a tabela,
  // então espera 1,5 s sem mudança
  const primeira = useRef(true)
  useEffect(() => {
    if (primeira.current) { primeira.current = false; recarregar(); return }
    const id = window.setTimeout(recarregar, 1500)
    return () => window.clearTimeout(id)
  }, [recarregar, versao])
  useEffect(() => { listarCanvases().then((l) => setIcones(Object.fromEntries(l.map((c) => [c.nome, c.icone])))).catch(() => {}) }, [])

  const abrir = (a: Alvo, opts?: { nova?: boolean }) => { abrirEm(a, opts?.nova); setCal(false) }
  const statusDe = (a: Alvo) => est?.producoes.find((p) => p.raiz === a.raiz && p.nome === a.nome)?.status ?? ''

  const calendarioBotao = (
    <button className={`tabela-canvas ${cal ? 'is-on' : ''}`} onClick={() => setCal((v) => !v)}
      title={cal ? 'Voltar para a nota' : 'Abrir o calendário: arraste uma copy da tabela para um dia para agendar'}>
      📅 {cal ? 'Fechar calendário' : 'Calendário'}</button>
  )

  return (
    <div ref={caixa} className={`redacao ${aberta || cal ? 'com-lado' : ''} ${soCopy && (aberta || cal) ? 'so-copy' : ''}`}
      style={soCopy && (aberta || cal) ? { gridTemplateColumns: 'minmax(0, 1fr)' } : aberta || cal ? { gridTemplateColumns: `minmax(0, ${frac}fr) 0px minmax(0, ${1 - frac}fr)` } : undefined}>
      <div className="redacao-tabela" hidden={soCopy && !!(aberta || cal)}>
        {est && <ModalTabela embutido est={est} t={t} aberta={aberta} extra={calendarioBotao} icones={icones} canvasNome="todos os canvas"
          onMudar={setT} onFechar={() => {}} onAbrir={abrir} onCanvas={() => {}}
          onStatus={async (alvos, st: StatusProd) => {
            try { await mudarStatus(alvos.map((a) => ({ nome: a.nome, status: statusDe(a) })), st); avisar(alvos.length === 1 ? 'Status mudou' : `${alvos.length} copies mudaram de status`) }
            catch (e) { avisar((e as Error).message) }
            await recarregar()
          }}
          onData={async (a, data) => {
            const r = await fetch(`/api/notas/${a.raiz}/${encodeURIComponent(a.nome)}/agenda`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) })
            if (!r.ok) avisar('Não deu para mudar a data.'); else avisar('Data mudou')
            await recarregar(); setCalVersao((v) => v + 1)
          }}
          onTags={async (a, tags) => {
            const { antes } = await post<{ antes: string[] }>('tags', { nome: a.nome, tags })
            registrarAcao({ rotulo: `tags de ${a.nome}`, desfazer: () => post('tags', { nome: a.nome, tags: antes }), refazer: () => post('tags', { nome: a.nome, tags }) })
            await recarregar()
          }}
          onRenomear={async (a, novo) => {
            const r = await fetch(`/api/notas/${a.raiz}/${encodeURIComponent(a.nome)}/acao`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'renomear', novo }) })
            if (!r.ok) { const d = await r.json().catch(() => ({})); avisar(d.detail || 'Não deu para renomear.') }
            else { const d = await r.json().catch(() => ({})); avisar('Renomeada'); if (aberta?.nome === a.nome) setAberta({ raiz: (d.raiz ?? a.raiz) as Alvo['raiz'], nome: d.nome ?? novo }); await recarregar() }
          }}
          onApagar={async (alvos) => {
            for (const a of alvos) await fetch(`/api/notas/${a.raiz}/${encodeURIComponent(a.nome)}/acao`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'lixeira' }) })
            if (aberta && alvos.some((a) => a.nome === aberta.nome)) setAberta(null)
            avisar(alvos.length === 1 ? 'Na lixeira do vault' : `${alvos.length} notas na lixeira do vault`)
            await recarregar()
          }} />}
      </div>
      {(aberta || cal) && <div className="redacao-divisoria" onPointerDown={arrastar} onDoubleClick={() => setFrac(0.48)} title="Arraste para mudar a proporção (duplo clique volta ao meio)" />}
      {cal ? (
        <aside className="redacao-lado redacao-cal glass glass--light">
          <header className="redacao-lado-topo"><b>📅 Calendário</b><span className="mudo">arraste uma copy da tabela para um dia</span>
            <button className="btn-icone" onClick={() => setCal(false)} aria-label="Fechar o calendário">×</button></header>
          <CalendarioEditorial key={calVersao} onAbrir={(raiz, nome) => abrir({ raiz, nome } as Alvo)} onMudou={() => { recarregar(); avisar('Agendada') }} />
        </aside>
      ) : aberta ? (
        <aside className="redacao-lado redacao-nota glass glass--light">
          <nav className="redacao-abas" role="tablist">
            {abas.lista.map((a, i) => (
              <div key={`${a.raiz}/${a.nome}`} role="tab" aria-selected={i === abas.ativa} className={`redacao-aba ${i === abas.ativa ? 'is-ativa' : ''}`}
                onClick={() => setAbas((x) => ({ ...x, ativa: i }))} onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); fechar(i) } }} title={a.nome}>
                <span>{a.nome}</span>
                <button onClick={(e) => { e.stopPropagation(); fechar(i) }} aria-label={`Fechar ${a.nome}`} title="Fechar a aba (ou clique do meio)">×</button>
              </div>
            ))}
            <button className="redacao-so-copy btn-icone" onClick={() => setSoCopy((v) => !v)} title={soCopy ? 'Mostrar a tabela (⌘[)' : 'Só a copy (⌘[)'}>{soCopy ? '⇥' : '⇤'}</button>
          </nav>
          <PainelNota key={`${aberta.raiz}/${aberta.nome}`} alvo={aberta} fixo versao={versao} onTrecho={onTrecho} avisar={avisar}
            onLink={(nome) => { const p = est?.producoes.find((x) => x.nome === nome); if (p) abrirEm({ raiz: p.raiz, nome: p.nome }, true) }}
            onMudou={(novo) => { if (novo) setAberta(novo); recarregar(); setCalVersao((v) => v + 1) }} />
        </aside>
      ) : null}
    </div>
  )
}
