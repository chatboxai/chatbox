const DEFAULT_CHATBOX_API_ORIGIN = 'https://api.chatboxai.app'

type ChatboxAPIOriginEnvironment = Readonly<Record<string, string | undefined>>

let dynamicChatboxAPIOrigin = DEFAULT_CHATBOX_API_ORIGIN

export function getChatboxAPIOrigin(environment: ChatboxAPIOriginEnvironment = process.env): string {
  if (environment.USE_LOCAL_API) return 'http://localhost:8002'
  if (environment.USE_BETA_API) return 'https://api-beta.chatboxai.app'
  if (environment.USE_NEWDB_API) return 'https://beta-new-db.chatboxai.app'
  return dynamicChatboxAPIOrigin
}

export function setDynamicChatboxAPIOrigin(origin: string): void {
  dynamicChatboxAPIOrigin = origin
}
