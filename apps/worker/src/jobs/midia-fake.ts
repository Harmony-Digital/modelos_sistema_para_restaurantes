// Só para testes: completa a Meta falsa dos testes que não envolvem o cardápio (mídia é defeito ali).
import type { ProcessDeps } from './process-conversation.ts'

type WaBasico = Pick<ProcessDeps['wa'], 'sendText' | 'sendLocation' | 'sendList'>

const proibido = (nome: string) => async (): Promise<never> => { throw new Error(`${nome} não esperado neste teste`) }

/** A Meta falsa do teste + envio de mídia proibido. */
export function comMidiaProibida(wa: WaBasico): ProcessDeps['wa'] {
  return {
    sendText: wa.sendText.bind(wa),
    sendLocation: wa.sendLocation.bind(wa),
    sendList: wa.sendList.bind(wa),
    sendDocument: proibido('sendDocument'),
    sendImage: proibido('sendImage'),
    uploadMedia: proibido('uploadMedia'),
  }
}

/** Storage que nunca deveria ser lido. */
export const storageProibido: ProcessDeps['storage'] = { baixarObjeto: proibido('baixarObjeto') }
