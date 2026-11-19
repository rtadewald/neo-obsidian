import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarioEditorial } from './CalendarioEditorial'
import { PainelNota } from './ModalNota'
import { ModalTabela, tabelaSalva, type Criacao, type EstadoTabela } from './Tabela'
import { carregarTudo, post, tudoEmCache, type Alvo, type EstadoCanvas, type StatusProd } from './canvasApi'
import { mudarStatus, registrarAcao } from './desfazer'
import { avisar } from './porta'

/** Redação: a tabela das copies (abas por status, Criação por categoria, Winners, Pinados e Skills) com a nota aberta à direita,
 *  como no Obsidian, e um calendário que abre no lugar da nota: arrastar uma linha da tabela para um dia agenda a copy
 *  (`scheduled`). Todas as copies do vault. */
const CHAVE_ABAS = 'redacao-abas'   // as copies abertas em abas (como no Obsidian) e qual está à frente
export const EVENTO_REDACAO = 'redacao-abrir'   // a busca (⌘O) abre uma copy aqui: {alvo, nova}
const CHAVE_CAL = 'redacao-calendario'
const CHAVE_LARG = 'redacao-largura'   // fração da largura que a tabela ocupa (a divisória arrasta)

export function Redacao({ versao }: { versao?: number }) {
  const [est, setEst] = useState<EstadoCanvas | null>(() => tudoEmCache())   // abre na hora com o que o app já tem
  const [t, setT] = useState<EstadoTabela>(() => tabelaSalva('ideias'))
  // cor e ordem das categorias e das copies na Criação (dados/criacao.json)
  const [criacao, setCriacao] = useState<Criacao>({ cores: {}, categorias: [], ordem: {} })
  useEffect(() => { fetch('/api/criacao', { cache: 'no-store' }).then((r) => r.json()).then(setCriacao).catch(() => {}) }, [])
  const mudarCriacao = (m: Partial<Criacao>) => {
    setCriacao((c) => ({ cores: { ...c.cores, ...(m.cores ?? {}) }, categorias: m.categorias ?? c.categorias, ordem: { ...c.ordem, ...(m.ordem ?? {}) } }))
    fetch('/api/criacao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) }).then((r) => r.json()).then(setCriacao).catch(() => avisar('Não consegui guardar.'))
  }
  const [abas, setAbas] = useState<{ lista: Alvo[]; ativa: number }>(() => { try { return JSON.parse(localStorage.getItem(CHAVE_ABAS) || 'null') ?? { lista: [], ativa: 0 } } catch { return { lista: [], ativa: 0 } } })
  // ⌘P alterna entre o modo copy (lateral + a copy aberta) e a tabela inteira; as abas de notas continuam guardadas
  const [verTabela, setVerTabela] = useState(false)
  const aberta: Alvo | null = verTabela ? null : abas.lista[abas.ativa] ?? null
  const abasRef = useRef(abas); abasRef.current = abas
  const abertaRef = useRef(aberta); abertaRef.current = aberta
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
  // ⌘B ou o botão ⇤ nas abas esconde a tabela: só a copy ou o calendário
  const [soCopy, setSoCopy] = useState(false)
  // ⌘[ esconde o menu de categorias da tabela (fica guardado)
  const [semCats, setSemCats] = useState(() => { try { return localStorage.getItem('redacao-sem-cats') === 'sim' } catch { return false } })
  useEffect(() => { try { localStorage.setItem('redacao-sem-cats', semCats ? 'sim' : 'nao') } catch { /* sem storage */ } }, [semCats])
  // ⌘] esconde as colunas Status e Data no painel de copies (modo copy)
  const [semColunas, setSemColunas] = useState(() => { try { return localStorage.getItem('redacao-sem-colunas') === 'sim' } catch { return false } })
  useEffect(() => { try { localStorage.setItem('redacao-sem-colunas', semColunas ? 'sim' : 'nao') } catch { /* sem storage */ } }, [semColunas])
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
    const mover = (ev: PointerEvent) => (escrita ? setLatW(Math.round(Math.min(900, Math.max(260, ev.clientX - r.left)))) : setFrac(Math.min(0.85, Math.max(0.12, (ev.clientX - r.left) / r.width))))
    const soltar = () => { window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar); document.body.classList.remove('arrastando') }
    document.body.classList.add('arrastando')
    window.addEventListener('pointermove', mover); window.addEventListener('pointerup', soltar)
  }
  // largura do card inteiro (fração da página, centralizado): alças nas bordas; duplo clique volta a ocupar tudo
  const [cardW, setCardW] = useState<number>(() => { try { return Number(localStorage.getItem('redacao-card')) || 1 } catch { return 1 } })
  useEffect(() => { try { localStorage.setItem('redacao-card', String(cardW)) } catch { /* sem storage */ } }, [cardW])
  const soCopyAtivo = soCopy && !!(aberta || cal)
  // sem nota aberta, o card encolhe para a largura que a tabela tinha (como o modo só copy faz com a nota): sem buraco à direita
  const soTabela = !(aberta || cal)
  const fatorCard = soCopyAtivo && cal ? 1 - frac : 1
  // modo copy (copy aberta, sem calendário): a mesma tabela à esquerda, sem Status e Data, de largura em px
  const escrita = !!aberta && !cal
  const [latW, setLatW] = useState<number>(() => { try { return Number(localStorage.getItem('redacao-lateral-tabela')) || 480 } catch { return 480 } })
  useEffect(() => { try { localStorage.setItem('redacao-lateral-tabela', String(latW)) } catch { /* sem storage */ } }, [latW])
  // só a tabela: largura própria em px (as alças mexem livremente); vazio = ocupa tudo (duplo clique volta a isso)
  const [tabCardW, setTabCardW] = useState<number | null>(() => { try { return Number(localStorage.getItem('redacao-card-tabela')) || null } catch { return null } })
  useEffect(() => { try { localStorage.setItem('redacao-card-tabela', tabCardW ? String(tabCardW) : '') } catch { /* sem storage */ } }, [tabCardW])
  // altura do card (fração da página, preso no topo): a borda de baixo e os cantos de baixo mexem nela
  const [cardH, setCardH] = useState<number>(() => { try { return Number(localStorage.getItem('redacao-card-altura')) || 1 } catch { return 1 } })
  useEffect(() => { try { localStorage.setItem('redacao-card-altura', String(cardH)) } catch { /* sem storage */ } }, [cardH])
  // lado: 1 borda direita, -1 esquerda, 0 só a altura; alto: a alça também mexe na altura (borda de baixo e cantos)
  const arrastarCard = (lado: 1 | -1 | 0, alto = false) => (e: React.PointerEvent) => {
    const pai = caixa.current?.parentElement?.getBoundingClientRect()
    const total = pai?.width, altura = pai?.height
    if (!total || !altura) return
    const y0 = e.clientY, h0 = cardH
    e.preventDefault()
    // no modo só copy o card tem a largura que a nota tinha (cardW × lado da nota): a alça mexe nessa largura
    const fator = fatorCard
    const x0 = e.clientX, w0 = cardW * fator
    const px0 = caixa.current?.getBoundingClientRect().width ?? 0
    const mover = (ev: PointerEvent) => {
      if (lado && soTabela) setTabCardW(Math.round(Math.min(total, Math.max(320, px0 + lado * 2 * (ev.clientX - x0)))))
      else if (lado) setCardW(Math.min(1, Math.max(0.25 / fator, (w0 + (lado * 2 * (ev.clientX - x0)) / total) / fator)))
      if (alto) setCardH(Math.min(1, Math.max(0.3, h0 + (ev.clientY - y0) / altura)))
    }
    const soltar = () => { window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar); document.body.classList.remove('arrastando') }
    document.body.classList.add('arrastando')
    window.addEventListener('pointermove', mover); window.addEventListener('pointerup', soltar)
  }
  useEffect(() => { try { localStorage.setItem(CHAVE_ABAS, JSON.stringify(abas)) } catch { /* sem storage */ } }, [abas])
  useEffect(() => {
    const ev = (e: Event) => { const d = (e as CustomEvent<{ alvo: Alvo; nova?: boolean }>).detail; abrirEm(d.alvo, d.nova); setCal(false); setVerTabela(false) }
    const tecla = (e: KeyboardEvent) => {
      // atalhos do modo esc (fora de campos e do editor, sem modal): ⌘B esconde/mostra a tabela (fica a copy) · ⌘[ categorias ·
      // ⌘] colunas Status e Data no modo copy · ⌘P esconde/mostra a copy (fica a tabela inteira) · ⌘C calendário (só sem texto selecionado, para o copiar seguir valendo)
      const alvo = e.target as HTMLElement | null
      const k = e.code
      // modo copy: ⌘1…⌘9 (ou ⌃/⌥) vão para a 1ª…9ª aba de nota, por cima da troca de página da navbar
      const n = /^Digit[1-9]$/.test(k) ? Number(k.slice(5)) : 0
      if (n && (e.metaKey || e.ctrlKey || e.altKey) && !e.shiftKey && abertaRef.current && n <= abasRef.current.lista.length && !document.querySelector('.modal-fundo, .paleta-fundo')) {
        e.preventDefault(); e.stopImmediatePropagation(); setAbas((x) => ({ ...x, ativa: n - 1 })); return
      }
      // a nota abre com o cursor no editor: lá o ⌘B sem texto selecionado também esconde/mostra a tabela
      // (com seleção segue sendo negrito)
      const noEditor = !!alvo?.closest?.('.cm-editor')
      const bLivre = k === 'KeyB' && noEditor && !!window.getSelection()?.isCollapsed
      const campo = alvo?.closest?.('textarea, input, select, [contenteditable="true"], .cm-editor') && !bLivre
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || campo || document.querySelector('.modal-fundo, .paleta-fundo')) return
      const feito = () => { e.preventDefault(); e.stopPropagation() }
      if (k === 'KeyB') { feito(); setSoCopy((v) => !v) }
      else if (k === 'BracketLeft') { feito(); setSemCats((v) => !v) }
      else if (k === 'BracketRight') { feito(); setSemColunas((v) => !v) }
      else if (k === 'KeyP') { feito(); setVerTabela((v) => !v) }
      else if (k === 'KeyC' && !String(window.getSelection() ?? '')) { feito(); setCal((v) => !v) }
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

  const abrir = (a: Alvo, opts?: { nova?: boolean }) => { abrirEm(a, opts?.nova); setCal(false); setVerTabela(false) }
  const statusDe = (a: Alvo) => est?.producoes.find((p) => p.raiz === a.raiz && p.nome === a.nome)?.status ?? ''

  // o Calendário mora na navbar do topo, à direita (o App deixa o #nav-direita vazio para isso)
  const [navDireita, setNavDireita] = useState<HTMLElement | null>(null)
  useEffect(() => setNavDireita(document.getElementById('nav-direita')), [])
  const botoes = <>
    <button className={`lateral-btn ${cal ? 'is-ativa' : ''}`} onClick={() => setCal((v) => !v)}
      title={cal ? 'Fechar o calendário' : 'Abrir o calendário: arraste uma copy da tabela para um dia para agendar'}><span>📅</span><span>Calendário</span></button>
  </>
  const botoesNav = navDireita && createPortal(botoes, navDireita)

  return (
    <div ref={caixa} className={`redacao ${aberta || cal ? 'com-lado' : ''} ${soCopy && (aberta || cal) ? 'so-copy' : ''}`}
      style={{ width: soTabela ? (tabCardW ? `min(100%, ${tabCardW}px)` : '100%') : `${cardW * fatorCard * 100}%`, height: `${cardH * 100}%`, ...(soCopy && (aberta || cal) ? { gridTemplateColumns: 'minmax(0, 1fr)' } : escrita ? { gridTemplateColumns: `${latW}px 0px minmax(0, 1fr)` } : cal ? { gridTemplateColumns: `minmax(0, ${frac}fr) 0px minmax(0, ${1 - frac}fr)` } : {}) }}>
      {botoesNav}
      <div className="redacao-borda is-esq" onPointerDown={arrastarCard(-1)} onDoubleClick={() => (soTabela ? setTabCardW(null) : setCardW(1))} title="Arraste para mudar a largura (duplo clique ocupa tudo)" />
      <div className="redacao-borda is-dir" onPointerDown={arrastarCard(1)} onDoubleClick={() => (soTabela ? setTabCardW(null) : setCardW(1))} title="Arraste para mudar a largura (duplo clique ocupa tudo)" />
      <div className="redacao-borda-baixo" onPointerDown={arrastarCard(0, true)} onDoubleClick={() => setCardH(1)} title="Arraste para mudar a altura (duplo clique ocupa tudo)" />
      <div className="redacao-canto is-esq" onPointerDown={arrastarCard(-1, true)} onDoubleClick={() => { if (soTabela) setTabCardW(null); else setCardW(1); setCardH(1) }} title="Arraste para mudar o tamanho (duplo clique ocupa tudo)" />
      <div className="redacao-canto is-dir" onPointerDown={arrastarCard(1, true)} onDoubleClick={() => { if (soTabela) setTabCardW(null); else setCardW(1); setCardH(1) }} title="Arraste para mudar o tamanho (duplo clique ocupa tudo)" />
      <div className="redacao-tabela" hidden={soCopy && !!(aberta || cal)}>
        {est && <ModalTabela embutido compacto={escrita} semColunas={escrita && semColunas} semCategorias={semCats} extra={<div className="redacao-botoes-w">{botoes}</div>} est={est} t={t} aberta={aberta}
          onMudar={setT} onFechar={() => {}} onAbrir={abrir} criacao={criacao} onCriacao={mudarCriacao}
          onCategoria={async (a, categoria) => { await post('categoria', { nomes: [a.nome], categoria }); avisar(categoria ? `Foi para ${categoria}` : "Ficou sem categoria"); await recarregar() }}
          onRenomearCategoria={async (de, para) => { await post('categoria/renomear', { de, para }); avisar(`Categoria agora é ${para}`)
            fetch('/api/criacao', { cache: 'no-store' }).then((r) => r.json()).then(setCriacao).catch(() => {})   // a lista e a cor já vêm com o nome novo
            setT((x) => (x.filtros?.categoria?.includes(de) ? { ...x, filtros: { ...x.filtros, categoria: x.filtros.categoria.map((c) => (c === de ? para : c)) } } : x))
            await recarregar() }}
          onArquivar={async (a, sim) => { await post('arquivar', { raiz: a.raiz, nome: a.nome, sim }); avisar(sim ? 'Arquivada (fora da Criação)' : 'Desarquivada'); await recarregar() }}
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
      {(aberta || cal) && <div className="redacao-divisoria" onPointerDown={arrastar} onDoubleClick={() => (escrita ? setLatW(480) : setFrac(0.48))} title="Arraste para mudar a proporção (duplo clique volta ao meio)" />}
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
            <button className="redacao-so-copy btn-icone" onClick={() => setSoCopy((v) => !v)} title={soCopy ? 'Mostrar a tabela (⌘B)' : 'Esconder a tabela (⌘B)'}>{soCopy ? '⇥' : '⇤'}</button>
          </nav>
          <PainelNota key={`${aberta.raiz}/${aberta.nome}`} alvo={aberta} fixo versao={versao} avisar={avisar}
            prod={est?.producoes.find((x) => x.raiz === aberta.raiz && x.nome === aberta.nome)}
            onLink={(nome) => { const p = est?.producoes.find((x) => x.nome === nome); if (p) abrirEm({ raiz: p.raiz, nome: p.nome }, true) }}
            onMudou={(novo) => { if (novo) setAberta(novo); recarregar(); setCalVersao((v) => v + 1) }} />
        </aside>
      ) : null}
    </div>
  )
}
