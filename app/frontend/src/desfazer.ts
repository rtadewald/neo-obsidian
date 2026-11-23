import { post } from './canvasApi'

/** Pilha única de ⌘Z / ⌘⇧Z do app: movimentos de cards e mudanças nas notas (status). Cada ação sabe se desfazer e
 *  se refazer; depois de cada uma sai o evento `notas-desfeitas` (o canvas recarrega). */
export type Acao = { rotulo: string; desfazer: () => Promise<unknown> | void; refazer: () => Promise<unknown> | void }
export const EVENTO_DESFEITO = 'notas-desfeitas'

let pilha: Acao[] = []
let refeitas: Acao[] = []
let ocupado = false

export function registrarAcao(a: Acao) {
  pilha = [...pilha.slice(-49), a]
  refeitas = []
}

/** Desfaz (ou refaz) a última ação. Devolve o aviso para mostrar. */
export async function desfazerUltima(refazer: boolean): Promise<string> {
  if (ocupado) return 'Aguarde…'
  const de = refazer ? refeitas : pilha
  const a = de.at(-1)
  if (!a) return refazer ? 'Nada para refazer' : 'Nada para desfazer'
  ocupado = true
  try {
    await (refazer ? a.refazer() : a.desfazer())
    if (refazer) { refeitas = refeitas.slice(0, -1); pilha = [...pilha, a] }
    else { pilha = pilha.slice(0, -1); refeitas = [...refeitas, a] }
    return `${refazer ? 'Refeito' : 'Desfeito'}: ${a.rotulo}`
  } catch (e) {
    return `Não deu para ${refazer ? 'refazer' : 'desfazer'}: ${(e as Error).message}`
  } finally {
    ocupado = false
    window.dispatchEvent(new Event(EVENTO_DESFEITO))
  }
}

const NOMES: Record<string, string> = { ideia: 'Ideia', referencia: 'Referência', gravar: 'Gravar', edicao: 'Em edição', agendado: 'Agendado', publicado: 'Publicado', ativo: 'Ativo', inativo: 'Inativo', arquivado: 'Arquivado' }

/** Muda o status de várias copies e deixa a mudança no ⌘Z. `antes` é o status de cada uma antes da mudança.
 *  A nota pode trocar de nome ao mudar de status (marcador no nome, pasta Publicados): a ação segue o nome novo. */
export async function mudarStatus(alvos: { nome: string; status: string }[], status: string) {
  const r = await post<{ notas: { raiz: string; nome: string }[] }>('status', { notas: alvos.map((a) => a.nome), status })
  const mudou = alvos.map((a, i) => ({ antes: a.status, nome: r.notas[i]?.nome ?? a.nome })).filter((x) => x.antes !== status)
  if (!mudou.length) return r
  registrarAcao({
    rotulo: `${mudou.length === 1 ? "1 copy" : `${mudou.length} copies`} → ${NOMES[status] ?? status}`,
    desfazer: async () => {
      for (const st of new Set(mudou.map((x) => x.antes))) {
        const grupo = mudou.filter((x) => x.antes === st)
        const d = await post<{ notas: { nome: string }[] }>('status', { notas: grupo.map((x) => x.nome), status: st })
        grupo.forEach((x, i) => { x.nome = d.notas[i]?.nome ?? x.nome })
      }
    },
    refazer: async () => {
      const d = await post<{ notas: { nome: string }[] }>('status', { notas: mudou.map((x) => x.nome), status })
      mudou.forEach((x, i) => { x.nome = d.notas[i]?.nome ?? x.nome })
    },
  })
  return r
}
