/**
 * Host half: keep a complete, durable index of direct user messages.
 * The browser rail can then render every node without forcing the transcript
 * to mount every historical page before first paint.
 */
const PLUGIN_NAME = 'dsh-conversation-navigator'
const PROJECTION_KEY = 'dshConversationNavigator'
const MAX_PREVIEW = 120
const identitySchema = { parse: value => value }

function textOf(content) {
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      text += block.text
    }
  }
  return text.trim().slice(0, MAX_PREVIEW)
}

const projection = {
  key: PROJECTION_KEY,
  stateSchema: identitySchema,
  init: () => ({ messages: [] }),
  apply: (state, event) => {
    if (event.type !== 'user/message') return state
    const data = event.data
    if (data?.source?.kind !== 'user') return state
    const message = {
      seq: event.seq,
      time: event.time,
      text: textOf(data.content),
      ...(typeof data.id === 'string' ? { id: data.id } : {}),
    }
    return { messages: [...state.messages, message] }
  },
  wire: {
    viewSchema: identitySchema,
    view: state => state,
  },
  stateVersion: 1,
}

export const name = PLUGIN_NAME

export function apply(ctx) {
  ctx.inject(['sessionProjections'], projectionCtx => {
    projectionCtx.sessionProjections.register(projection)
  })
}
