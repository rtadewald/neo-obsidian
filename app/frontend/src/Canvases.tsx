import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { INBOX, listarCanvases, moverNaLista, ordenarCanvases, type ResumoCanvas } from './canvasApi'

/** Página inicial: os canvas (onde as notas vivem: o `grupo:` delas). O 📥 Inbox (notas sem canvas) não aparece como pasta.
 *  Cada card mostra produções, VSLs e ideias; produto é filtro dentro do canvas, não lugar. */
let ultimaLista: ResumoCanvas[] | null = null
/** Busca a lista já ao abrir o app: o clique em NEO-OBSIDIAN mostra a página na hora. */
export const preCarregarCanvases = () => {
  listarCanvases().then((l) => { ultimaLista = l }).catch(() => {})
}

/** Cores para escolher (as mesmas que o backend sorteia ao criar) + qualquer outra pelo seletor do sistema. */
const CORES = ['#f6e3b4', '#f8d3c5', '#f3c9d9', '#dccff2', '#c9daf5', '#c4e6e0', '#d3ecc4', '#e6e1d8']

function EscolherCor({ cor, onCor }: { cor: string; onCor: (c: string) => void }) {
  return (
    <div className="canvases-cores" role="radiogroup" aria-label="Cor">
      {CORES.map((c) => <button key={c} type="button" role="radio" aria-checked={c === cor} className={`canvases-cor ${c === cor ? 'is-on' : ''}`} style={{ background: c }} onClick={() => onCor(c)} title={c} />)}
      <label className={`canvases-cor canvases-cor--livre ${CORES.includes(cor) ? '' : 'is-on'}`} title="Outra cor" style={CORES.includes(cor) ? undefined : { background: cor }}>
        <input type="color" value={cor} onChange={(e) => onCor(e.target.value)} />＋</label>
    </div>
  )
}

async function salvar(corpo: Record<string, string | boolean>) {
  const r = await fetch('/api/canvases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.detail || 'Não deu certo.')
  return d as ResumoCanvas
}

export function Canvases({ onAbrir }: { onAbrir: (slug: string) => void }) {
  // mostra na hora a última lista conhecida e atualiza por trás (as contagens leem o vault inteiro)
  const [lista, setLista] = useState<ResumoCanvas[] | null>(ultimaLista)
  const [novo, setNovo] = useState(false)
  const [corNovo, setCorNovo] = useState(CORES[0])
  const [erro, setErro] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; c: ResumoCanvas } | null>(null)   // botão direito num card
  // arrastar um card muda a ordem dos canvas (a mesma das pastas da esquerda do canvas)
  const [arrasta, setArrasta] = useState<string | null>(null)
  const [alvo, setAlvo] = useState<string | null>(null)
  const soltar = (de: string, para: string) => {
    if (!lista) return
    const slugs = moverNaLista(lista.filter((c) => c.slug !== INBOX).map((c) => c.slug), de, para)
    const porSlug = new Map(lista.map((c) => [c.slug, c]))
    const nova = [...slugs.map((sl) => porSlug.get(sl)!), ...lista.filter((c) => c.slug === INBOX)]
    ultimaLista = nova; setLista(nova); setArrasta(null); setAlvo(null)
    ordenarCanvases(slugs).then(carregar).catch(() => {})
  }
  const carregar = () => listarCanvases().then((l) => { ultimaLista = l; setLista(l) }).catch(() => setErro('Não consegui ler os canvas.'))
  useEffect(() => {
    carregar()
  }, [])

  async function criar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    try {
      const d = await salvar({ nome: String(f.get('nome') || '').trim(), icone: String(f.get('icone') || '').trim() || '🗂️', cor: corNovo })
      setNovo(false); setErro(''); onAbrir(d.slug)
    } catch (x) { setErro((x as Error).message) }
  }
  // um card: a pasta do canvas; botão direito abre o menu (Renomear, Cor, Arquivar, Excluir)
  const card = (c: ResumoCanvas) => (
    <div key={c.slug} className={`canvases-item ${c.arquivado ? 'is-arquivado' : ''} ${arrasta && alvo === c.slug && arrasta !== c.slug ? 'is-alvo' : ''} ${arrasta === c.slug ? 'is-arrastando' : ''}`}
      draggable={c.slug !== INBOX} onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setArrasta(c.slug) }}
      onDragOver={(e) => { if (!arrasta || c.slug === INBOX) return; e.preventDefault(); setAlvo(c.slug) }}
      onDragEnd={() => { setArrasta(null); setAlvo(null) }}
      onDrop={(e) => { e.preventDefault(); if (arrasta && c.slug !== INBOX) soltar(arrasta, c.slug) }}>
      <button type="button" className={`pastao ${c.slug === INBOX ? 'is-inbox' : ''}`} onClick={() => onAbrir(c.slug)}
        onContextMenu={(e) => { if (c.slug === INBOX) return; e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, c }) }}
        title={c.slug === INBOX ? `Abrir o ${c.nome}` : `Abrir o canvas ${c.nome} (botão direito: renomear, cor, arquivar, excluir)`}
        style={{ '--cor': c.cor } as React.CSSProperties}>
        {/* pasta: fundo com a aba, folhas aparecendo e a frente com o nome e os números */}
        <span className="pastao-fundo" />
        <span className="pastao-folhas"><i /><i /><i /></span>
        <span className="pastao-frente">
          <span className="pastao-nome">{c.icone !== '🗂️' && <span className="pastao-ic">{c.icone}</span>}{c.nome}</span>
          <span className="pastao-numeros">
            <span><b>{c.producoes}</b> produções</span><span><b>{c.vsls}</b> VSLs</span><span><b>{c.ideias}</b> ideias</span>
          </span>
        </span>
      </button>
    </div>
  )
  const ativos = lista?.filter((c) => !c.arquivado && c.slug !== INBOX) ?? []   // o Inbox não aparece como pasta
  const arquivados = lista?.filter((c) => c.arquivado) ?? []

  return (
    <div className="canvases">
      <header className="canvases-topo">
        <h1>Canvas</h1>
        <p className="mudo">Cada nota vive num canvas (a propriedade grupo). Produto (FIA, FID…) é filtro dentro do canvas. Botão direito num card renomeia, muda a cor, arquiva ou exclui.</p>
      </header>
      {erro && <p className="canvases-erro">{erro}</p>}
      <div className="canvases-grade">
        {ativos.map(card)}
        {lista && !novo && (
          <button type="button" className="pastao pastao--novo" onClick={() => setNovo(true)}>
            <span className="pastao-fundo" />
            <span className="pastao-frente"><span className="pastao-mais">＋</span><span className="pastao-nome">Novo canvas</span></span>
          </button>
        )}
        {novo && (
          <form className="canvases-card canvases-form glass glass--light" onSubmit={criar} style={{ '--cor': corNovo } as React.CSSProperties}>
            <div className="canvases-linha">
              <input name="icone" className="canvases-campo canvases-campo--icone" placeholder="🗂️" maxLength={4} aria-label="Ícone" />
              <input name="nome" className="canvases-campo" placeholder="Nome (ex.: Hacks e Dicas)" autoFocus required aria-label="Nome" />
            </div>
            <EscolherCor cor={corNovo} onCor={setCorNovo} />
            <p className="mudo">Nota criada dentro dele já nasce com o grupo dele.</p>
            <div className="canvases-linha">
              <button type="button" className="pilula" onClick={() => setNovo(false)}>Cancelar</button>
              <button type="submit" className="pilula pilula--escura">Criar</button>
            </div>
          </form>
        )}
      </div>
      {arquivados.length > 0 && <>
        <h2 className="canvases-secao">Arquivados <em>{arquivados.length}</em></h2>
        <div className="canvases-grade">{arquivados.map(card)}</div>
      </>}
      {menu && <MenuDoCanvas m={menu} onFechar={() => setMenu(null)} onMudou={carregar} onExcluido={() => carregar()} />}
    </div>
  )
}

/** Botão direito num canvas (na página Todos os canvas e nas pastas da esquerda): Renomear (modal com nome e ícone),
 *  Cor (as cores no próprio menu), Arquivar ou Reativar, Excluir (com confirmação). Resolve tudo sozinho:
 *  `onMudou` recarrega quem chamou; `onExcluido` diz qual canvas saiu. */
export function MenuDoCanvas({ m, onFechar, onMudou, onExcluido }: {
  m: { x: number; y: number; c: ResumoCanvas }; onFechar: () => void; onMudou: () => void; onExcluido: (slug: string) => void
}) {
  const [etapa, setEtapa] = useState<'menu' | 'renomear' | 'excluir'>('menu')
  const [corAberta, setCorAberta] = useState<false | 'dir' | 'esq'>(false)   // caixinha de cores ao lado (hover)
  const [cor, setCor] = useState(m.c.cor)
  const [iconeAberto, setIconeAberto] = useState<false | 'dir' | 'esq'>(false)   // caixinha de ícones ao lado (hover)
  const [icone, setIcone] = useState(m.c.icone)
  const trocarIcone = (i: string) => { setIcone(i); tentar(() => salvar({ slug: m.c.slug, icone: i }), false) }
  const [erro, setErro] = useState('')
  const caixa = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: m.x, y: m.y })
  const tentar = async (f: () => Promise<unknown>, fechar = true) => {
    try { await f(); setErro(''); onMudou(); if (fechar) onFechar() } catch (x) { setErro((x as Error).message) }
  }
  useEffect(() => {
    const r = caixa.current?.getBoundingClientRect()
    if (r) setPos({ x: Math.min(m.x, window.innerWidth - r.width - 8), y: Math.min(m.y, window.innerHeight - r.height - 8) })
  }, [m, etapa])
  useEffect(() => {
    const fora = (e: PointerEvent) => { if (etapa !== 'renomear' && etapa !== 'excluir' && !caixa.current?.contains(e.target as HTMLElement)) onFechar() }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onFechar()
    window.addEventListener('pointerdown', fora, true); window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('pointerdown', fora, true); window.removeEventListener('keydown', esc) }
  }, [etapa, onFechar])

  if (etapa === 'renomear' || etapa === 'excluir') return createPortal(
    <div className="paleta-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      {etapa === 'renomear' ? (
        <form className="paleta glass glass--light perguntar" onSubmit={(e) => {
          e.preventDefault(); const f = new FormData(e.currentTarget)
          tentar(() => salvar({ slug: m.c.slug, nome: String(f.get('nome') || '').trim(), icone: String(f.get('icone') || '').trim() }))
        }}>
          <p className="perguntar-t">Renomear canvas</p>
          <div className="canvases-linha">
            <input name="icone" className="canvases-campo canvases-campo--icone" defaultValue={m.c.icone} maxLength={4} aria-label="Ícone" />
            <input name="nome" className="canvases-campo" defaultValue={m.c.nome} autoFocus required aria-label="Nome" />
          </div>
          <p className="perguntar-dica">As notas deste canvas mudam o grupo junto.</p>
          {erro && <p className="canvases-erro">{erro}</p>}
          <div className="perguntar-botoes">
            <button type="button" className="pilula" onClick={onFechar}>Cancelar</button>
            <button type="submit" className="pilula pilula--escura">Salvar</button>
          </div>
        </form>
      ) : (
        <div className="paleta glass glass--light perguntar">
          <p className="perguntar-t">Excluir {m.c.icone} {m.c.nome}?</p>
          <p className="perguntar-dica">As notas dele voltam para o Inbox (perdem o grupo). O layout vai para o histórico.</p>
          {erro && <p className="canvases-erro">{erro}</p>}
          <div className="perguntar-botoes">
            <button type="button" className="pilula" onClick={onFechar} autoFocus>Cancelar</button>
            <button type="button" className="pilula is-perigo" onClick={async () => {
              const r = await fetch(`/api/canvases/${m.c.slug}`, { method: 'DELETE' })
              if (!r.ok) { setErro((await r.json().catch(() => ({}))).detail || 'Não deu para excluir.'); return }
              onFechar(); onExcluido(m.c.slug)
            }}>Excluir</button>
          </div>
        </div>
      )}
    </div>, document.body)

  return createPortal(
    <div ref={caixa} className="menu-ctx glass glass--light" role="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      <p className="menu-titulo">{m.c.icone} {m.c.nome}</p>
      <button role="menuitem" onClick={() => setEtapa('renomear')}><span className="menu-emoji">✏️</span>Renomear</button>
      <div className="menu-sub-caixa" onMouseLeave={() => setCorAberta(false)}
        onMouseEnter={(e) => setCorAberta(e.currentTarget.getBoundingClientRect().right + 250 > window.innerWidth ? 'esq' : 'dir')}>
        <button role="menuitem" className={`menu-sub ${corAberta ? 'is-aberto' : ''}`} onClick={() => setCorAberta((v) => (v ? false : 'dir'))}>
          <span className="menu-emoji"><i className="menu-cor" style={{ background: cor }} /></span>Cor<span className="menu-seta">›</span></button>
        {corAberta && <div className={`menu-lateral menu-cores is-${corAberta}`} role="menu">
          <EscolherCor cor={cor} onCor={(c) => { setCor(c); tentar(() => salvar({ slug: m.c.slug, cor: c }), false) }} />
        </div>}
      </div>
      <div className="menu-sub-caixa" onMouseLeave={() => setIconeAberto(false)}
        onMouseEnter={(e) => setIconeAberto(e.currentTarget.getBoundingClientRect().right + 280 > window.innerWidth ? 'esq' : 'dir')}>
        <button role="menuitem" className={`menu-sub ${iconeAberto ? 'is-aberto' : ''}`} onClick={() => setIconeAberto((v) => (v ? false : 'dir'))}>
          <span className="menu-emoji">{icone !== '🗂️' ? icone : '🙂'}</span>Ícone<span className="menu-seta">›</span></button>
        {iconeAberto && <div className={`menu-lateral menu-icones is-${iconeAberto}`} role="menu">
          <EscolherIcone icone={icone} onIcone={trocarIcone} />
        </div>}
      </div>
      <button role="menuitem" onClick={() => tentar(() => salvar({ slug: m.c.slug, arquivado: !m.c.arquivado }))}>
        <span className="menu-emoji">{m.c.arquivado ? '📤' : '🗄️'}</span>{m.c.arquivado ? 'Reativar' : 'Arquivar'}</button>
      <hr />
      <button role="menuitem" className="is-perigo" onClick={() => setEtapa('excluir')}><span className="menu-emoji">🗑️</span>Excluir</button>
      {erro && <p className="menu-aviso is-erro">{erro}</p>}
    </div>, document.body)
}

/** Ícone que aparece dentro da pastinha: busca por palavra (em português), grade com os resultados e "sem ícone".
 *  Colar ou digitar um emoji direto também vale (Enter usa o que estiver no campo). */
const EMOJIS: [string, string][] = [
  ['🤖', 'robo ia agente bot automacao'], ['🧠', 'cerebro mente ia pensar ideia'], ['💡', 'ideia lampada luz insight'], ['✨', 'brilho magia novo destaque'],
  ['🎨', 'arte design pintura cor paleta'], ['🖼️', 'imagem quadro foto arte design'], ['📷', 'foto camera fotografia'], ['📸', 'foto camera flash fotografia'],
  ['🎬', 'video filme cinema producao gravar'], ['🎥', 'video camera youtube filmar'], ['📺', 'tv vsl video televisao'], ['📹', 'video camera gravar'],
  ['🎞️', 'filme video edicao'], ['📱', 'celular reels instagram mobile app'], ['💻', 'computador notebook codigo programacao dev'], ['🖥️', 'computador tela desktop'],
  ['⌨️', 'teclado digitar codigo'], ['🐍', 'python cobra codigo programacao'], ['🧑‍💻', 'programador dev codigo'], ['⚙️', 'engrenagem config automacao sistema'],
  ['🛠️', 'ferramentas ferramenta construir'], ['🔧', 'chave ferramenta ajuste'], ['🧪', 'teste experimento laboratorio ciencia'], ['🔬', 'ciencia pesquisa microscopio'],
  ['📊', 'grafico dados dashboard analise'], ['📈', 'grafico crescimento dados vendas subir'], ['📉', 'grafico queda dados'], ['🧮', 'calculo matematica numeros'],
  ['💰', 'dinheiro venda ads trafego pago grana'], ['💸', 'dinheiro gasto pagar'], ['💳', 'cartao pagamento compra'], ['🛍️', 'compras loja venda black friday'],
  ['🛒', 'carrinho compra loja'], ['🏷️', 'etiqueta preco oferta promocao'], ['🎁', 'presente bonus oferta'], ['🖤', 'preto black friday coracao'],
  ['🔥', 'fogo quente viral winner destaque'], ['⭐', 'estrela favorito destaque'], ['🌟', 'estrela brilho destaque'], ['🏆', 'trofeu vitoria premio winner'],
  ['🥇', 'medalha primeiro ouro'], ['🎯', 'alvo meta objetivo foco'], ['🚀', 'foguete lancamento crescer rapido'], ['⚡', 'raio rapido energia'],
  ['📚', 'livros estudo curso aula'], ['📖', 'livro leitura estudo'], ['🎓', 'formatura curso formacao aula escola'], ['🧑‍🏫', 'professor aula ensino'],
  ['✏️', 'lapis escrever editar'], ['✍️', 'escrever copy texto roteiro'], ['📝', 'nota anotacao texto copy'], ['🗒️', 'notas bloco lista'],
  ['📣', 'megafone anuncio marketing divulgar'], ['📢', 'alto falante anuncio aviso'], ['🎙️', 'microfone podcast live audio'], ['🎧', 'fone audio musica podcast'],
  ['🎵', 'musica som audio'], ['🗓️', 'calendario agenda data'], ['⏰', 'relogio alarme prazo tempo'], ['⏳', 'ampulheta tempo espera'],
  ['📌', 'pin fixar alfinete'], ['📎', 'clipe anexo'], ['🗂️', 'pastas arquivo organizar'], ['📁', 'pasta arquivo'], ['📦', 'caixa pacote produto entrega'],
  ['📥', 'inbox entrada caixa'], ['📤', 'saida enviar'], ['✉️', 'email carta mensagem'], ['💬', 'chat conversa mensagem comentario'],
  ['❤️', 'coracao amor favorito vermelho'], ['💚', 'coracao verde'], ['💙', 'coracao azul'], ['💛', 'coracao amarelo'], ['💜', 'coracao roxo'],
  ['🌱', 'planta crescer comeco semente'], ['🌳', 'arvore natureza'], ['🌎', 'mundo terra global'], ['🌙', 'lua noite'], ['☀️', 'sol dia'],
  ['🏠', 'casa lar pessoal'], ['🏢', 'empresa escritorio negocio'], ['🤝', 'parceria acordo negocio cliente'], ['👥', 'pessoas equipe time comunidade'],
  ['👤', 'pessoa perfil usuario'], ['👩', 'mulher aline esposa'], ['👨', 'homem'], ['👶', 'bebe filho crianca'], ['🧒', 'crianca'],
  ['💼', 'trabalho negocio maleta'], ['🧾', 'recibo nota fiscal conta'], ['🔒', 'cadeado seguranca privado'], ['🔑', 'chave acesso senha'],
  ['🎮', 'jogo game'], ['🎲', 'dado jogo sorte'], ['🍕', 'pizza comida'], ['☕', 'cafe'], ['✅', 'feito pronto check ok'], ['❌', 'erro nao cancelado'],
  ['⚠️', 'aviso atencao cuidado'], ['❓', 'pergunta duvida'], ['🔍', 'busca lupa pesquisa'], ['🧭', 'bussola direcao estrategia'], ['🗺️', 'mapa plano estrategia'],
  ['🎭', 'teatro drama storytelling historia'], ['📰', 'jornal noticia news'], ['🌐', 'web site internet'], ['🔗', 'link corrente'], ['🐦', 'passaro twitter x'],
  ['🦄', 'unicornio startup'], ['🐙', 'polvo github'], ['🤗', 'hugging face abraco'], ['🅰️', 'asimov a letra'], ['🏞️', 'paisagem carrossel imagem estatico'],
]
const sem = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
/** Últimos ícones usados (mais recente primeiro), guardados no navegador; sobem para o topo da grade. */
const RECENTES_KEY = 'neo-icones-recentes'
const lerRecentes = (): string[] => { try { const v = JSON.parse(localStorage.getItem(RECENTES_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [] } catch { return [] } }
const gravarRecente = (i: string) => {
  if (i === '🗂️') return
  try { localStorage.setItem(RECENTES_KEY, JSON.stringify([i, ...lerRecentes().filter((x) => x !== i)].slice(0, 18))) } catch { /* sem storage: só não lembra */ }
}
function EscolherIcone({ icone, onIcone: onIconeBase }: { icone: string; onIcone: (i: string) => void }) {
  const [busca, setBusca] = useState('')
  const onIcone = (i: string) => { gravarRecente(i); onIconeBase(i) }
  const q = sem(busca.trim())
  const ehEmoji = /\p{Extended_Pictographic}/u.test(busca)
  const recentes = lerRecentes()
  const todos: [string, string][] = [
    ...recentes.map((r): [string, string] => EMOJIS.find(([e]) => e === r) ?? [r, 'recente']),
    ...EMOJIS.filter(([e]) => !recentes.includes(e)),
  ]
  const lista = q && !ehEmoji ? todos.filter(([, p]) => q.split(/\s+/).every((w) => p.includes(w))) : todos
  return (
    <div className="escolher-icone">
      <form className="escolher-icone-livre" onSubmit={(e) => { e.preventDefault(); const v = ehEmoji ? busca.trim() : lista[0]?.[0]; if (v) { onIcone(v); setBusca('') } }}>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar ícone (fogo, dinheiro, foto…)" autoFocus aria-label="Buscar ícone" />
        <button type="button" className="escolher-icone-sem" onClick={() => onIcone('🗂️')} disabled={icone === '🗂️'}>Sem ícone</button>
      </form>
      <div className="escolher-icone-grade">
        {lista.map(([i, p]) => <button key={i} type="button" className={i === icone ? 'is-on' : ''} onClick={() => onIcone(i)} title={p.split(' ')[0]}>{i}</button>)}
        {!lista.length && <p className="escolher-icone-vazio">Nada com “{busca}”. Cole um emoji ou tente outra palavra.</p>}
      </div>
    </div>
  )
}
