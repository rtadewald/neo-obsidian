import { lembrarAberta } from './Paleta'
import { exportarPdf } from './exportarPdf'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EditorView } from '@codemirror/view'
import { Sumario } from './Sumario'
import { Editor } from './Editor'
import type { Extra } from './propriedades'
import { Icone } from './Icone'
import { alternarPin, idDoCard, pinavel, usePins } from './pins'
import { mudarStatus as statusComDesfazer } from './desfazer'
import { PASTA, obsidian, type Raiz } from './notas'
import { STATUS, onde, carregarTudo, tudoEmCache, porFormato, post, type Alvo, type EstadoCanvas, type Voltar, type Producao, type Formato } from './canvasApi'

/** Modal estilo Notion de uma nota (e o PainelNota, que a Redação usa embutido). */
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

export function ModalNota({ alvo, onFechar, onMudou, versao, voltar }: {
  alvo: Alvo; onFechar: () => void
  voltar?: Voltar                              // aberta da tabela das pastas: botão para voltar a ela
  onMudou?: () => void                        // algo mudou no vault (o canvas recarrega)
  versao?: number                             // o chat terminou de responder
}) {
  // todas as notas (não só as do canvas aberto: a copy pode viver em outro); começa do que já está em memória
  const [est, setEst] = useState<EstadoCanvas | null>(tudoEmCache)
  const [ativa, setAtiva] = useState<Alvo>(alvo)
  onde.nota = ativa   // GET /api/onde mostra a aba aberta (não só a nota com que o modal abriu)
  useEffect(() => () => { onde.nota = null }, [])
  const [mais, setMais] = useState(false)
  const pins = usePins()
  const [posMais, setPosMais] = useState({ left: 0, top: 0 })
  useEffect(() => {
    if (!mais) return
    const fora = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.menu-ctx, .is-mais')) setMais(false) }
    window.addEventListener('mousedown', fora)
    return () => window.removeEventListener('mousedown', fora)
  }, [mais])
  const [aviso, setAviso] = useState<string | null>(null)
  const avisar = (m: string) => { setAviso(m); window.setTimeout(() => setAviso((a) => (a === m ? null : a)), 2600) }

  const recarregar = useCallback(() => carregarTudo().then(setEst).catch(() => {}), [])
  useEffect(() => { recarregar() }, [recarregar, versao])
  useEffect(() => setAtiva(alvo), [alvo])
  useEffect(() => { if (ativa.raiz !== 'entradas') lembrarAberta(ativa.raiz, ativa.nome) }, [ativa])   // entra nas últimas abertas da ⌘P
  // copy com o selo NOVO: abrir conta como ver
  useEffect(() => {
    if (ativa.raiz !== 'ideias' && est?.novas?.includes(ativa.nome)) post('vista', { nomes: [ativa.nome] }).then(() => onMudou?.()).catch(() => {})
  }, [ativa, est?.novas])  // eslint-disable-line react-hooks/exhaustive-deps

  // o grupo: a ideia da nota ativa e todas as saídas dela
  const grupo = useMemo(() => {
    if (!est) return null
    const prod = est.producoes.find((p) => p.raiz === ativa.raiz && p.nome === ativa.nome)
    const nomeIdeia = ativa.raiz === 'ideias' ? ativa.nome : prod?.ideia ?? null
    const ideia = nomeIdeia ? est.ideias.find((i) => i.nome === nomeIdeia) ?? null : null
    // as saídas são as notas com o mesmo `ideia:`, exista ou não a nota 💡 (o grupo 🎬 do canvas é só essa propriedade)
    // copy de uma produção dentro de uma ideia maior (`producao:`): as abas são só as versões dela
    const saidas = nomeIdeia ? est.producoes.filter((p) => p.ideia === nomeIdeia && (!prod?.producao || p.producao === prod.producao)).sort(porFormato) : prod ? [prod] : []
    const entradas = ideia ? est.entradas.filter((e) => ideia.fontes.includes(e.nome)) : []
    const usadaEm = ativa.raiz === 'entradas' ? est.ideias.filter((i) => i.fontes.includes(ativa.nome)) : []
    // ligações de copy para copy (`origem:`): a copy de onde esta nasceu e as que nasceram dela
    const origem = prod?.origem ? est.producoes.find((p) => p.nome === prod.origem) ?? null : null
    const filhas = prod ? est.producoes.filter((p) => p.origem === prod.nome) : []
    return { ideia, chave: nomeIdeia, saidas, entradas, usadaEm, prod, origem, filhas }
  }, [est, ativa])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.menu-ctx, .modal-apagar')) { e.preventDefault(); onFechar() } }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])

  // ⌘1 vai para a 💡 ideia e ⌘2…⌘9 para os filhos dela (as saídas, na ordem das tabs). Vale também com o cursor no editor.
  const navRef = useRef(grupo)
  navRef.current = grupo
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || !/^[0-9]$/.test(e.key)) return
      const g = navRef.current
      if (!g) return
      // a ordem é a da ideia: ⌘1 = a 💡 ideia original, ⌘2, ⌘3… = os filhos (as saídas, na ordem das tabs); ⌘0 também volta à ideia
      const lista: Alvo[] = [
        ...(g.ideia ? [{ raiz: 'ideias' as Raiz, nome: g.ideia.nome }] : []),
        ...g.saidas.map((p) => ({ raiz: p.raiz as Raiz, nome: p.nome })),
      ]
      const n = Number(e.key)
      const destino = n === 0 ? (g.ideia ? lista[0] : null) : lista[n - 1] ?? null
      e.preventDefault(); e.stopPropagation()
      if (destino) setAtiva(destino)
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [])

  // deletar a nota aberta: botão da lixeira ou ⌘⌫ (fora do editor, onde ⌘⌫ apaga a linha), sempre com confirmação
  const [apagar, setApagar] = useState(false)
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'Backspace' || e.shiftKey || e.altKey) return
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable="true"], .cm-editor')) return
      e.preventDefault()
      setApagar(true)
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [])
  async function deletar() {
    try {
      const r = await fetch(`/api/notas/${ativa.raiz}/${encodeURIComponent(ativa.nome)}/acao`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'lixeira' }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Não consegui deletar.')
      setApagar(false)
      onMudou?.()
      // outra saída da mesma produção continua aberta; senão volta para a tabela (ou fecha)
      const outra = grupo?.saidas.find((p) => !(p.raiz === ativa.raiz && p.nome === ativa.nome))
      if (outra && ativa.raiz !== 'ideias') { setAtiva({ raiz: outra.raiz, nome: outra.nome }); recarregar(); avisar('Foi para a lixeira do vault (.trash)') }
      else if (voltar) voltar.fn()
      else onFechar()
    } catch (e) { setApagar(false); avisar((e as Error).message) }
  }

  async function novaSaida(formato: string, _nomeFormato?: string) {
    setMais(false)
    if (!grupo) return
    try {
      let ideia = grupo.ideia?.nome ?? grupo.chave ?? undefined
      if (!ideia && grupo.prod) {   // card solto: vira ideia primeiro, com o nome da copy
        const base = grupo.prod.nome.replace(/^[^\p{L}\p{N}]+/u, '').trim() || grupo.prod.nome
        ideia = (await post<Alvo>('agrupar', { titulo: base, producoes: [{ raiz: grupo.prod.raiz, nome: grupo.prod.nome }] })).nome
      }
      if (!ideia) return
      const d = await post<Alvo>('saida', { ideia, formato })
      await recarregar()
      onMudou?.()
      setAtiva(d)
      avisar('Nota criada')
    } catch (e) { avisar((e as Error).message) }
  }

  // tamanho da nota: arrastar uma borda ou um canto muda largura/altura (a nota fica no meio, então cresce dos dois lados).
  // O tamanho fica guardado e vale para todas as notas; duplo clique numa alça volta ao padrão (70vw).
  const [tam, setTam] = useState<{ w: number; h: number } | null>(() => { try { return JSON.parse(localStorage.getItem('nota-tamanho') || 'null') } catch { return null } })
  const caixaNota = useRef<HTMLDivElement>(null)
  const redimensionar = (e: React.PointerEvent, dx: -1 | 0 | 1, dy: -1 | 0 | 1) => {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const r = caixaNota.current!.getBoundingClientRect()
    const x0 = e.clientX, y0 = e.clientY, w0 = r.width, h0 = r.height
    let ult = { w: w0, h: h0 }
    const mover = (ev: PointerEvent) => {
      ult = {
        w: Math.round(Math.min(window.innerWidth - 16, Math.max(480, w0 + dx * 2 * (ev.clientX - x0)))),
        h: Math.round(Math.min(window.innerHeight - 16, Math.max(320, h0 + dy * 2 * (ev.clientY - y0)))),
      }
      setTam(ult)
    }
    const soltar = () => {
      window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar)
      document.body.classList.remove('redimensionando')
      try { localStorage.setItem('nota-tamanho', JSON.stringify(ult)) } catch { /* sem storage */ }
    }
    document.body.classList.add('redimensionando')
    window.addEventListener('pointermove', mover); window.addEventListener('pointerup', soltar)
  }
  const padrao = () => { setTam(null); try { localStorage.removeItem('nota-tamanho') } catch { /* sem storage */ } }
  const ALCAS: [string, -1 | 0 | 1, -1 | 0 | 1][] = [['n', 0, -1], ['s', 0, 1], ['e', 1, 0], ['w', -1, 0], ['ne', 1, -1], ['nw', -1, -1], ['se', 1, 1], ['sw', -1, 1]]

  // [[link]] (nas propriedades ou ⌘clique no texto): abre a nota aqui mesmo quando o app a conhece; senão, no Obsidian
  const abrirLink = (nome: string) => {
    const n = nome.split('/').pop()!.replace(/\.md$/, '')
    const achada: Alvo | null = !est ? null
      : est.ideias.some((i) => i.nome === n) ? { raiz: 'ideias', nome: n }
      : est.entradas.some((e) => e.nome === n) ? { raiz: 'entradas', nome: n }
      : (() => { const p = est.producoes.find((x) => x.nome === n); return p ? { raiz: p.raiz as Raiz, nome: p.nome } : null })()
    if (achada) setAtiva(achada)
    else window.location.href = `obsidian://open?vault=${encodeURIComponent('Obsidian Notes')}&file=${encodeURIComponent(nome)}`
  }


  const tabs: { alvo: Alvo; rotulo: string; prod?: Producao }[] = grupo
    ? [
        // a ideia abre sozinha (mostra os filhos); a produção abre com uma tab por formato
        ...(ativa.raiz === 'ideias' && grupo.ideia ? [{ alvo: { raiz: 'ideias' as Raiz, nome: grupo.ideia.nome }, rotulo: '💡 Ideia' }] : []),
        ...(ativa.raiz !== 'ideias' && ativa.raiz !== 'entradas' ? grupo.saidas.map((p) => ({ alvo: { raiz: p.raiz as Raiz, nome: p.nome }, rotulo: p.nome, prod: p })) : []),
        ...(ativa.raiz === 'entradas' ? [{ alvo: ativa, rotulo: ativa.nome }] : []),
      ]
    : [{ alvo: ativa, rotulo: ativa.nome }]

  return (
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div ref={caixaNota} className="modal-nota glass glass--light" role="dialog" aria-label={ativa.nome}
        style={{
          ...(tam ? { width: Math.min(tam.w, window.innerWidth - 16), height: Math.min(tam.h, window.innerHeight - 16) } : {}),
        }}>
        {ALCAS.map(([k, dx, dy]) => <div key={k} className={`modal-alca modal-alca--${k}`} onPointerDown={(e) => redimensionar(e, dx, dy)} onDoubleClick={padrao}
          title="Arraste para mudar o tamanho da nota (duplo clique volta ao padrão)" />)}
        <header className="modal-tabs">
          {voltar && (
            <button className="modal-volta modal-volta--tabela" onClick={voltar.fn} title={`Voltar para a tabela ${voltar.rotulo}`}>
              <span className="modal-volta-seta">←</span> {voltar.rotulo}
            </button>
          )}
          {ativa.raiz !== 'ideias' && ativa.raiz !== 'entradas' && grupo?.ideia && (
            <button className="modal-volta" onClick={() => setAtiva({ raiz: 'ideias', nome: grupo.ideia!.nome })} title="Voltar para a ideia desta produção">
              <Icone n="seta" t={12} /> 💡 {grupo.ideia.nome.replace(/^💡\s*/, '')}
            </button>
          )}
          {grupo?.origem && (
            <button className="modal-volta modal-volta--origem" onClick={() => setAtiva({ raiz: grupo.origem!.raiz as Raiz, nome: grupo.origem!.nome })} title={`Copy de origem: ${grupo.origem.nome}`}>
              <Icone n="seta" t={12} /> {grupo.origem.nome}
            </button>
          )}
          <nav role="tablist">
            {tabs.map((t) => (
              <button key={`${t.alvo.raiz}/${t.alvo.nome}`} role="tab" aria-selected={t.alvo.nome === ativa.nome && t.alvo.raiz === ativa.raiz}
                className={`modal-tab ${t.alvo.nome === ativa.nome && t.alvo.raiz === ativa.raiz ? 'is-ativa' : ''}`} onClick={() => setAtiva(t.alvo)} title={t.alvo.nome}>
                {t.prod && <i className={`ponto is-${t.prod.status}`} />}
                <span>{t.prod ? rotuloSaida(t.prod, grupo?.chave ?? undefined) : t.rotulo}</span>
              </button>
            ))}
            {ativa.raiz !== 'entradas' && est && (
              <span className="modal-mais">
                <button className="modal-tab is-mais" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPosMais({ left: r.left, top: r.bottom + 4 }); setMais((v) => !v) }} title="Nova saída desta ideia"><Icone n="mais" t={14} /> Saída</button>
                {mais && createPortal(
                  <div className="menu-ctx glass glass--light" role="menu" style={posMais}>
                    <p className="menu-ctx-t"><span className="orb orb--msg" />Nova saída (o Claude escreve)</p>
                    {est.formatos.map((f) => <button key={f.emoji} role="menuitem" onClick={() => novaSaida(f.emoji, f.nome)}><span className="menu-emoji">{f.emoji}</span>{f.nome}</button>)}
                  </div>, document.body)}
              </span>
            )}
          </nav>
          {est && (() => { const id = idDoCard(est, ativa), sim = pins.includes(id); if (!pinavel(id)) return null
            return <button className={`btn-icone modal-pin ${sim ? 'is-on' : ''}`} onClick={() => { alternarPin(id, !sim); avisar(sim ? 'Despinado' : 'Pinado na barra da esquerda') }}
              aria-pressed={sim} aria-label={sim ? 'Despinar' : 'Pinar'} title={sim ? 'Despinar' : 'Pinar na barra da esquerda'}><Icone n="pin" t={15} /></button> })()}
          <button className="btn-icone modal-lixeira" onClick={() => setApagar(true)} aria-label="Deletar nota" title="Deletar esta nota (⌘⌫)"><Icone n="lixeira" t={15} /></button>
          <button className="btn-icone" onClick={onFechar} aria-label="Fechar" title="Fechar (esc)"><Icone n="fechar" t={16} /></button>
        </header>
        {/* copies que nasceram desta (`origem:` apontando para ela): numa linha abaixo das abas, só quando houver */}
        {grupo && grupo.filhas.length > 0 && (
          <div className="modal-filhas">
            {grupo.filhas.map((f) => (
              <button key={`${f.raiz}/${f.nome}`} className="modal-volta modal-volta--filha" onClick={() => setAtiva({ raiz: f.raiz as Raiz, nome: f.nome })} title={`Nasceu desta: ${f.nome}`}>
                <span className="modal-volta-seta">↳</span> {f.nome}
              </button>
            ))}
          </div>
        )}

        {grupo?.ideia && ativa.raiz === 'ideias' && grupo.entradas.length > 0 && (
          <div className="modal-entradas">
            <span className="mudo">Entradas</span>
            {grupo.entradas.map((e) => (
              <button key={e.nome} className="modal-entrada" onClick={() => setAtiva({ raiz: 'entradas', nome: e.nome })} title={e.url || e.nome}>
                {e.thumb && <img src={e.thumb} alt="" referrerPolicy="no-referrer" />}<span>{e.nome}</span>
              </button>
            ))}
          </div>
        )}
        {ativa.raiz === 'ideias' && grupo && grupo.saidas.length > 0 && (
          <div className="modal-entradas">
            <span className="mudo">Produção</span>
            {/* cada saída da ideia com o nome da própria nota (ex.: 📺 VSL BF26 Aline) */}
            {grupo.saidas.map((p) => (
              <button key={`${p.raiz}/${p.nome}`} className="modal-entrada modal-filho" onClick={() => setAtiva({ raiz: p.raiz as Raiz, nome: p.nome })} title={`Abrir ${p.nome}`}>
                <span>{p.nome}</span>
              </button>
            ))}
          </div>
        )}
        {ativa.raiz === 'entradas' && grupo && grupo.usadaEm.length > 0 && (
          <div className="modal-entradas">
            <span className="mudo">Usada em</span>
            {grupo.usadaEm.map((i) => <button key={i.nome} className="modal-entrada" onClick={() => setAtiva({ raiz: 'ideias', nome: i.nome })}><span>{i.nome}</span></button>)}
          </div>
        )}

        <PainelNota key={`${ativa.raiz}/${ativa.nome}`} alvo={ativa} prod={grupo?.prod ?? undefined} ideia={grupo?.ideia?.nome}
          versao={versao} avisar={avisar} onLink={abrirLink} formatos={est?.formatos}
          onMudou={(novo) => { if (novo) setAtiva(novo); recarregar(); onMudou?.() }} />
        {aviso && createPortal(<div className="ideias-aviso" role="status">{aviso}</div>, document.body)}
        {apagar && (
          <div className="modal-apagar" role="alertdialog" aria-label="Confirmar exclusão" onMouseDown={(e) => e.target === e.currentTarget && setApagar(false)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setApagar(false) } }}>
            <div className="modal-apagar-caixa glass glass--light">
              <b>Deletar {ativa.nome}?</b>
              <p>A nota vai para a lixeira do vault (.trash). Dá para recuperar pelo Obsidian.</p>
              <div className="modal-apagar-botoes">
                <button onClick={() => setApagar(false)}>Cancelar</button>
                <button className="is-perigo" autoFocus onClick={deletar}>Deletar</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Na tab, a saída aparece pelo formato e pelo que sobra do nome além do nome da ideia ("💰 LP"). */
function rotuloSaida(p: Producao, ideia?: string) {
  const base = (ideia ?? '').replace(/^💡\s*/, '').toLowerCase()
  const resto = p.nome.replace(/^[^\p{L}\p{N}]+/u, '').trim()
  const sobra = base && resto.toLowerCase().startsWith(base) ? resto.slice(base.length).replace(/^[\s\-–·+]+/, '') : resto
  return `${p.formato} ${sobra || ({ '📱': 'Reels', '💰': 'Ad', '🏞️': 'Carrossel', '📝': 'Feed', '📺': 'VSL', '🎥': 'YouTube', '🗣️': 'Stories', '🎙️': 'Live' } as Record<string, string>)[p.formato] || ''}`.trim()
}

/** O editor de uma nota (cabeçalho, propriedades, texto e sumário). Usado no modal e na página Skills
 *  (`fixo`: o título não renomeia, para os arquivos das skills). */

export function PainelNota({ alvo, prod, ideia, versao, onMudou, avisar, onLink, fixo, formatos }: {
  alvo: Alvo; prod?: Producao; ideia?: string; versao?: number; onLink: (nome: string, nova?: boolean) => void; fixo?: boolean; formatos?: Formato[]
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

  // ideia → copy: a própria nota vai para Priorizar com o frontmatter de copy (o texto fica; o card fica no mesmo lugar)
  const [virar, setVirar] = useState<{ left: number; top: number } | null>(null)
  useEffect(() => {
    if (!virar) return
    const fora = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest?.('.menu-virar, .btn-virar')) setVirar(null) }
    window.addEventListener('mousedown', fora)
    return () => window.removeEventListener('mousedown', fora)
  }, [virar])
  async function virarCopy(formato: string) {
    setVirar(null)
    try {
      await salvar()
      const d = await post<Alvo>('virar-copy', { ideia: alvo.nome, formato })
      onMudou(d)
      avisar('Virou copy em Priorizar')
    } catch (e) { avisar((e as Error).message) }
  }

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
        {prod && ideia && (
          <button className="modal-desligar" onClick={() => executar(() => post('ligar', { producao: { raiz: prod.raiz, nome: prod.nome }, ideia: null }), 'Saiu da ideia')}
            title="Tira esta copy da ideia (a nota continua igual)">Desligar da ideia</button>
        )}
        {alvo.raiz === 'ideias' && formatos && !fixo && (
          <button className="modal-desligar btn-virar" aria-expanded={!!virar} title="Esta ideia vira uma copy em Priorizar (o texto fica igual)"
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setVirar((v) => v ? null : { left: r.left, top: r.bottom + 4 }) }}>
            🎬 Transformar em copy</button>
        )}
        {virar && formatos && createPortal(
          <div className="menu-ctx menu-virar glass glass--light" role="menu" style={virar}>
            <p className="menu-ctx-t">Transformar em copy de…</p>
            {formatos.map((f) => <button key={f.emoji} role="menuitem" onClick={() => virarCopy(f.emoji)}><span className="menu-emoji">{f.emoji}</span>{f.nome}</button>)}
          </div>, document.body)}
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
