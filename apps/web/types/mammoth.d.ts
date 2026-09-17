/**
 * Mammoth ships types for its Node entry point but not for the browser bundle,
 * which is the one we import — the Node build pulls in `fs` and will not run in
 * a browser. Only the small surface we actually call is declared here.
 */
declare module 'mammoth/mammoth.browser.js' {
  export interface MammothMessage {
    type: 'warning' | 'error'
    message: string
  }

  export interface MammothResult {
    value: string
    messages: MammothMessage[]
  }

  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<MammothResult>
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<MammothResult>
}
