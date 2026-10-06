/** Endereços da sub-aba Importar (módulo comum: usado por Server Components e por componentes de cliente). */
export const URL_IMPORTAR = '/conteudo?aba=cardapio&sub=importar'
export const urlImportacao = (id: string) => `${URL_IMPORTAR}&imp=${id}`
