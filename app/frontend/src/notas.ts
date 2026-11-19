/** Onde moram as notas que o app abre: as pastas do vault e o link para abrir no Obsidian. */
export type Raiz = 'priorizar' | 'publicados' | 'skills' | 'ideias' | 'entradas'

export const PASTA: Record<Raiz, string> = { priorizar: '1 Copies/1 Priorizar', publicados: '1 Copies/2 Publicados', skills: '3 Skills', ideias: '1 Copies/0 Ideias', entradas: '1 Copies/0 Ideias/Entradas' }
export const ROTULO: Record<Raiz, string> = { priorizar: 'Priorizar', publicados: 'Publicados', skills: 'Skills', ideias: 'Ideias', entradas: 'Entradas' }
const caminhoVault = (r: Raiz, n: string) => (r === 'skills' ? (n.endsWith('.md') ? `${PASTA[r]}/${n.slice(0, -3)}` : `${PASTA[r]}/${n}/SKILL`) : `${PASTA[r]}/${n}`)
export const obsidian = (r: Raiz, n: string) => `obsidian://open?vault=${encodeURIComponent('Obsidian Notes')}&file=${encodeURIComponent(caminhoVault(r, n))}`
