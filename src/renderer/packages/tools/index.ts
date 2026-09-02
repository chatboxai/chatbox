import { t } from 'i18next'
import { parseChatboxCliInput } from '@/packages/chatbox-cli/parser'
import type { ChatboxCliInput } from '@/packages/chatbox-cli/types'

function getChatboxCliToolName(input: unknown): string {
  if (!input || typeof input !== 'object') return t('Chatbox')
  const value = input as Record<string, unknown>
  const cliInput: ChatboxCliInput = {
    ...(typeof value.command === 'string' ? { command: value.command } : {}),
    ...(Array.isArray(value.argv) && value.argv.every((item) => typeof item === 'string') ? { argv: value.argv } : {}),
  }

  let argv: string[]
  try {
    argv = parseChatboxCliInput(cliInput).argv.map((item) => item.toLowerCase())
  } catch {
    return t('Chatbox')
  }

  const [first, second] = argv
  if (first === 'version') return t('Chatbox Version')
  if (first === 'status' || first === 'whoami' || (first === 'account' && !second)) return t('Account Status')
  if (first === 'quota' || first === 'usage' || (first === 'account' && second === 'quota')) return t('Quota Details')
  if (first === 'license' && (second === 'refresh' || second === 'sync')) return t('Refresh Account Status')
  if (first === 'refresh' || first === 'sync' || (first === 'account' && second === 'refresh')) {
    return t('Refresh Account Status')
  }
  if (first === 'license' || (first === 'account' && second === 'license')) return t('License Details')
  if (first === 'account' && second === 'status') return t('Account Status')
  if (first === 'settings' && second === 'list') return t('List Settings')
  if (first === 'settings' && second === 'get') return t('Read Setting')
  if (first === 'chats' && second === 'list') return t('Conversation List')
  if (first === 'chats' && second === 'search') return t('Search All Conversations')
  if (first === 'chats' && second === 'read') return t('Read Conversation')
  if (first === 'image' && second === 'models') return t('List Image Models')
  if (first === 'image' && second === 'generate') return t('Generate images')
  if (first === 'image' && second === 'status') return t('Image Generation Status')
  if (first === 'image' && second === 'history') return t('Image History')
  return t('Chatbox')
}

export function getToolName(toolName: string, input?: unknown): string {
  if (toolName === 'chatbox_cli') return getChatboxCliToolName(input)
  // Use translation keys that i18next cli can detect
  const toolNames: Record<string, string> = {
    query_knowledge_base: t('Query Knowledge Base'),
    get_files_meta: t('Get Files Meta'),
    read_file_chunks: t('Read File Chunks'),
    list_files: t('List Files'),
    web_search: t('Web Search'),
    file_search: t('File Search'),
    code_search: t('Code Search'),
    terminal: t('Terminal'),
    create_file: t('Create File'),
    edit_file: t('Edit File'),
    delete_file: t('Delete File'),
    read_file: t('Read File'),
    write_file: t('Write File'),
    search_files: t('Search Files'),
    parse_link: t('Parse Link'),
    code_execution: t('Code Execution'),
    create_download: t('Create Download'),
    search_file_content: t('Search File Content'),
    sandbox_bash: t('Terminal'),
    sandbox_read: t('Read File'),
    sandbox_write: t('Write File'),
    sandbox_edit: t('Edit File'),
    sandbox_grep: t('Search File Content'),
    sandbox_ls: t('List Directory'),
    sandbox_find: t('Find Files'),
    load_skill: t('Load Skill'),
    install_skill: t('Install Skill'),
    run_command: t('Run Command'),
    user_exec: t('Run Command'),
    parse_file: t('Parse File'),
    view_image: t('View Image'),
  }

  return toolNames[toolName] || toolName
}
