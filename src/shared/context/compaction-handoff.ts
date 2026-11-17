/**
 * Model-facing wording that frames a compaction summary inside a request.
 *
 * - `resume`: the summary is followed by retained assistant/tool turns of an
 *   unfinished run, so it carries the task forward.
 * - `reference`: a user turn follows, so the summary is background only.
 * - `history`: the summary is input for a new summary and carries no directive.
 */
export type CompactionHandoffMode = 'resume' | 'reference' | 'history'

interface HandoffCopy {
  resume: string
  reference: string
  history: string
  historyStart: string
}

const EN: HandoffCopy = {
  resume:
    'Continue the unfinished task from the earlier conversation, using the summary below as retained context. It is not a new request; follow any newer user instructions after it.',
  reference:
    "Summary of the earlier conversation, provided as background context. It is not a new request; respond to the user's message that follows.",
  history: 'Summary of the earlier conversation:',
  historyStart: 'Earlier messages of this conversation are not included. The conversation continues below.',
}

/** Keyed by the app language code (`Settings['language']`). */
const COPY: Record<string, HandoffCopy> = {
  en: EN,
  'zh-Hans': {
    resume:
      '请以下方的早前对话摘要作为保留上下文，继续完成尚未完成的任务。这不是新的请求；如果之后有更新的用户指示，请以其为准。',
    reference: '以下是早前对话的摘要，仅作为背景上下文，不是新的请求；请回应其后的用户消息。',
    history: '早前对话的摘要：',
    historyStart: '此前的部分对话未包含在内，对话从下方继续。',
  },
  'zh-Hant': {
    resume:
      '請以下方的先前對話摘要作為保留的上下文，繼續完成尚未完成的任務。這不是新的請求；若之後有更新的使用者指示，請以其為準。',
    reference: '以下是先前對話的摘要，僅作為背景上下文，不是新的請求；請回應其後的使用者訊息。',
    history: '先前對話的摘要：',
    historyStart: '先前的部分對話未包含在內，對話從下方繼續。',
  },
  ja: {
    resume:
      '以下の以前の会話の要約を保持されたコンテキストとして使い、未完了のタスクを続けてください。これは新しい依頼ではありません。この後に新しいユーザーの指示があれば、そちらに従ってください。',
    reference:
      '以下は以前の会話の要約で、背景情報としてのみ提供されています。新しい依頼ではありません。続くユーザーのメッセージに応答してください。',
    history: '以前の会話の要約：',
    historyStart: 'この会話の以前のメッセージは含まれていません。会話は以下から続きます。',
  },
  ko: {
    resume:
      '아래의 이전 대화 요약을 유지된 맥락으로 사용하여 완료되지 않은 작업을 계속하세요. 새로운 요청이 아니며, 이후에 더 새로운 사용자 지시가 있으면 그것을 따르세요.',
    reference:
      '다음은 이전 대화의 요약으로, 배경 맥락으로만 제공됩니다. 새로운 요청이 아니며, 뒤따르는 사용자 메시지에 응답하세요.',
    history: '이전 대화 요약:',
    historyStart: '이 대화의 이전 메시지는 포함되어 있지 않습니다. 대화는 아래에서 이어집니다.',
  },
  ru: {
    resume:
      'Продолжите незавершённую задачу из предыдущего разговора, используя приведённое ниже резюме как сохранённый контекст. Это не новый запрос; следуйте более новым указаниям пользователя, если они идут после него.',
    reference:
      'Ниже приведено резюме предыдущего разговора в качестве фонового контекста. Это не новый запрос; ответьте на следующее за ним сообщение пользователя.',
    history: 'Резюме предыдущего разговора:',
    historyStart: 'Более ранние сообщения этого разговора не включены. Разговор продолжается ниже.',
  },
  de: {
    resume:
      'Setze die unvollendete Aufgabe aus dem früheren Gespräch fort und nutze die folgende Zusammenfassung als beibehaltenen Kontext. Sie ist keine neue Anfrage; befolge neuere Anweisungen des Nutzers, die danach folgen.',
    reference:
      'Zusammenfassung des früheren Gesprächs, nur als Hintergrundkontext. Sie ist keine neue Anfrage; antworte auf die folgende Nachricht des Nutzers.',
    history: 'Zusammenfassung des früheren Gesprächs:',
    historyStart: 'Frühere Nachrichten dieses Gesprächs sind nicht enthalten. Das Gespräch wird unten fortgesetzt.',
  },
  fr: {
    resume:
      "Poursuis la tâche inachevée de la conversation précédente en utilisant le résumé ci-dessous comme contexte conservé. Ce n'est pas une nouvelle demande ; suis les instructions plus récentes de l'utilisateur qui le suivent.",
    reference:
      "Résumé de la conversation précédente, fourni uniquement comme contexte. Ce n'est pas une nouvelle demande ; réponds au message de l'utilisateur qui suit.",
    history: 'Résumé de la conversation précédente :',
    historyStart:
      'Les messages antérieurs de cette conversation ne sont pas inclus. La conversation continue ci-dessous.',
  },
  'pt-PT': {
    resume:
      'Continua a tarefa inacabada da conversa anterior, usando o resumo abaixo como contexto retido. Não é um novo pedido; segue as instruções mais recentes do utilizador que surjam depois dele.',
    reference:
      'Resumo da conversa anterior, fornecido apenas como contexto. Não é um novo pedido; responde à mensagem do utilizador que se segue.',
    history: 'Resumo da conversa anterior:',
    historyStart: 'As mensagens anteriores desta conversa não estão incluídas. A conversa continua abaixo.',
  },
  es: {
    resume:
      'Continúa la tarea inacabada de la conversación anterior usando el resumen de abajo como contexto conservado. No es una nueva solicitud; sigue las instrucciones más recientes del usuario que vengan después.',
    reference:
      'Resumen de la conversación anterior, proporcionado solo como contexto. No es una nueva solicitud; responde al mensaje del usuario que sigue.',
    history: 'Resumen de la conversación anterior:',
    historyStart: 'Los mensajes anteriores de esta conversación no están incluidos. La conversación continúa abajo.',
  },
  ar: {
    resume:
      'تابع المهمة غير المكتملة من المحادثة السابقة مستخدمًا الملخص أدناه كسياق محفوظ. هذا ليس طلبًا جديدًا؛ اتبع أي تعليمات أحدث من المستخدم تأتي بعده.',
    reference: 'ملخص المحادثة السابقة، مقدَّم كسياق خلفي فقط. هذا ليس طلبًا جديدًا؛ أجب عن رسالة المستخدم التالية.',
    history: 'ملخص المحادثة السابقة:',
    historyStart: 'الرسائل الأقدم من هذه المحادثة غير مضمّنة. تستمر المحادثة أدناه.',
  },
  'it-IT': {
    resume:
      "Continua l'attività non completata della conversazione precedente usando il riepilogo qui sotto come contesto conservato. Non è una nuova richiesta; segui le istruzioni più recenti dell'utente che lo seguono.",
    reference:
      "Riepilogo della conversazione precedente, fornito solo come contesto. Non è una nuova richiesta; rispondi al messaggio dell'utente che segue.",
    history: 'Riepilogo della conversazione precedente:',
    historyStart:
      'I messaggi precedenti di questa conversazione non sono inclusi. La conversazione continua qui sotto.',
  },
  sv: {
    resume:
      'Fortsätt den ofullbordade uppgiften från det tidigare samtalet och använd sammanfattningen nedan som bevarad kontext. Det är ingen ny begäran; följ nyare instruktioner från användaren som kommer efter den.',
    reference:
      'Sammanfattning av det tidigare samtalet, endast som bakgrundskontext. Det är ingen ny begäran; svara på användarens efterföljande meddelande.',
    history: 'Sammanfattning av det tidigare samtalet:',
    historyStart: 'Tidigare meddelanden i samtalet ingår inte. Samtalet fortsätter nedan.',
  },
  'nb-NO': {
    resume:
      'Fortsett den uferdige oppgaven fra den tidligere samtalen, og bruk sammendraget nedenfor som bevart kontekst. Det er ikke en ny forespørsel; følg nyere instruksjoner fra brukeren som kommer etter det.',
    reference:
      'Sammendrag av den tidligere samtalen, kun som bakgrunnskontekst. Det er ikke en ny forespørsel; svar på brukerens påfølgende melding.',
    history: 'Sammendrag av den tidligere samtalen:',
    historyStart: 'Tidligere meldinger i denne samtalen er ikke inkludert. Samtalen fortsetter nedenfor.',
  },
  tr: {
    resume:
      'Önceki konuşmadaki tamamlanmamış görevi, aşağıdaki özeti korunan bağlam olarak kullanarak sürdür. Bu yeni bir istek değildir; ardından gelen daha yeni kullanıcı talimatlarına uy.',
    reference:
      'Önceki konuşmanın özeti, yalnızca arka plan bağlamı olarak verilmiştir. Bu yeni bir istek değildir; ardından gelen kullanıcı mesajına yanıt ver.',
    history: 'Önceki konuşmanın özeti:',
    historyStart: 'Bu konuşmanın önceki mesajları dahil edilmemiştir. Konuşma aşağıda devam ediyor.',
  },
}

function copyFor(language: string | undefined): HandoffCopy {
  return (language && COPY[language]) || EN
}

/** The mode implied by the role of the message that follows the summary. */
export function getCompactionHandoffMode(nextRole: string | undefined): Exclude<CompactionHandoffMode, 'history'> {
  return nextRole === undefined || nextRole === 'user' ? 'reference' : 'resume'
}

export interface CompactionHandoff {
  /** The wording added around the summary; token estimation counts it separately. */
  instruction: string
  text: string
}

export function buildCompactionHandoff(
  summary: string,
  mode: CompactionHandoffMode,
  language?: string
): CompactionHandoff {
  const instruction = copyFor(language)[mode]
  return { instruction, text: `${instruction}\n\n${summary}` }
}

/** Opens a request whose retained history would otherwise start with an assistant or tool turn. */
export function getContextHistoryStartNote(language?: string): string {
  return copyFor(language).historyStart
}
