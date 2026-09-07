export class BaseError extends Error {
  public code = 1
  public requestId: string | undefined
  constructor(message: string, options?: { requestId?: string }) {
    super(message)
    this.requestId = options?.requestId
  }
}

export const MESSAGE_ERROR_CODES = {
  CHATBOX_AI_QUOTA_EXHAUSTED: 10004,
  OCR_FAILED: 10006,
  CHATBOX_AI_FREE_QUOTA_EXHAUSTED: 20039,
  CHATBOX_AI_FREE_AGENT_MODE_QUOTA_EXHAUSTED: 20040,
  FILE_PREPROCESS_FAILED: 20041,
  FILE_STORAGE_QUOTA_EXCEEDED: 20042,
  EMPTY_ATTACHMENT_CONTENT: 20043,
  CHATBOX_AI_OCR_QUOTA_EXHAUSTED: 20044,
  CHATBOX_AI_FREE_OCR_QUOTA_EXHAUSTED: 20045,
} as const

// 10000 - 19999 为通用网络接口错误

export class ApiError extends BaseError {
  public code = 10001
  public responseBody: string | undefined
  public statusCode: number | undefined
  constructor(message: string, responseBody?: string, statusCode?: number, requestId?: string) {
    super('API Error: ' + message, { requestId })
    this.responseBody = responseBody
    this.statusCode = statusCode
  }
}

// Upstream failed after part of the response had already streamed. Never safe
// to auto-retry: the provider may have billed the partial generation, and the
// partial text has already reached the UI, so a silent retry would duplicate it.
export class MidStreamApiError extends ApiError {}

export class NetworkError extends BaseError {
  public code = 10002
  public host: string
  constructor(message: string, host: string) {
    super('Network Error: ' + message)
    this.host = host
  }
}

export class AIProviderNoImplementedPaintError extends BaseError {
  public code = 10003
  constructor(aiProvider: string) {
    super(`Current AI Provider ${aiProvider} Does Not Support Painting`)
  }
}

export class AIProviderNoImplementedChatError extends BaseError {
  public code = 10005
  constructor(aiProvider: string) {
    super(`Current AI Provider ${aiProvider} Does Not Support Chat Completions API`)
  }
}

export class OCRError extends BaseError {
  public code: number
  public ocrProvider: string
  public cause: Error
  constructor(ocrProvider: string, cause: Error) {
    super(`OCR Error (${ocrProvider}): ${cause.message}`)
    this.ocrProvider = ocrProvider
    this.cause = cause
    if (cause instanceof BaseError && cause.code === MESSAGE_ERROR_CODES.CHATBOX_AI_QUOTA_EXHAUSTED) {
      this.code = MESSAGE_ERROR_CODES.CHATBOX_AI_OCR_QUOTA_EXHAUSTED
    } else if (cause instanceof BaseError && cause.code === MESSAGE_ERROR_CODES.CHATBOX_AI_FREE_QUOTA_EXHAUSTED) {
      this.code = MESSAGE_ERROR_CODES.CHATBOX_AI_FREE_OCR_QUOTA_EXHAUSTED
    } else {
      this.code = MESSAGE_ERROR_CODES.OCR_FAILED
    }
  }
}

// 20000 - 29999 为 Chatbox AI 服务错误

// Chatbox AI 服务错误
// 注意，在开发时 i18nKey 中的标签和参数，都需要在 MessageErrTips 中定义
// NOTE： 这个文件不会被 translate script 扫描到，`pnpm translate` 会先同步这里的 key 到 `src/renderer/i18n/for-key-scan.ts`
export class ChatboxAIAPIError extends BaseError {
  static codeNameMap: { [codename: string]: ChatboxAIAPIErrorDetail } = {
    // 超出配额
    token_quota_exhausted: {
      name: 'token_quota_exhausted',
      code: MESSAGE_ERROR_CODES.CHATBOX_AI_QUOTA_EXHAUSTED, // 小于 20000 是为了兼容旧版本
      i18nKey:
        'You have used up your monthly Chatbox AI quota. Please <OpenSettingButton>go to Settings</OpenSettingButton> to view your quota usage or upgrade your plan.',
    },
    // 超出每日免费配额
    free_token_quota_exhausted: {
      name: 'free_token_quota_exhausted',
      code: MESSAGE_ERROR_CODES.CHATBOX_AI_FREE_QUOTA_EXHAUSTED,
      i18nKey:
        'You have used up your daily Chatbox AI quota. Please <OpenSettingButton>go to Settings</OpenSettingButton> to view your quota usage or upgrade your plan.',
    },
    token_quota_exhausted_free: {
      name: 'token_quota_exhausted_free',
      code: MESSAGE_ERROR_CODES.CHATBOX_AI_FREE_QUOTA_EXHAUSTED,
      i18nKey:
        'You have used up your daily Chatbox AI quota. Please <OpenSettingButton>go to Settings</OpenSettingButton> to view your quota usage or upgrade your plan.',
    },
    // 当前套餐不支持该模型
    license_upgrade_required: {
      name: 'license_upgrade_required',
      code: 20001,
      i18nKey:
        'Your current License (Chatbox AI Free/Lite) does not support the {{model}} model. To use this model, please <OpenMorePlanButton>upgrade</OpenMorePlanButton> to Chatbox AI Pro or a higher-tier package. Alternatively, you can switch to a different model by <OpenSettingButton>accessing the settings</OpenSettingButton>.',
    },
    // license 过期
    expired_license: {
      name: 'expired_license',
      code: 20002,
      i18nKey: 'Your license has expired. Please check your subscription or purchase a new one.',
    },
    // 未输入 license
    license_key_required: {
      name: 'license_key_required',
      code: 20003,
      i18nKey:
        'You have selected Chatbox AI as the model provider, but a license key has not been entered yet. Please <OpenSettingButton>click here to open Settings</OpenSettingButton> and enter your license key, or choose a different model provider.',
    },
    // 输入的 license 未找到
    license_not_found: {
      name: 'license_not_found',
      code: 20004,
      i18nKey: 'The license key you entered is invalid. Please check your license key and try again.',
    },
    // 超出配额
    rate_limit_exceeded: {
      name: 'rate_limit_exceeded',
      code: 20005,
      i18nKey: 'You have exceeded the rate limit for the Chatbox AI service. Please try again later.',
    },
    // 参数错误
    bad_params: {
      name: 'bad_params',
      code: 20006,
      i18nKey:
        'Invalid request parameters detected. Please try again later. Persistent failures may indicate an outdated software version. Consider upgrading to access the latest performance improvements and features.',
    },
    // 文件类型不支持。不同解析器支持的格式不同；旧版 Office 格式可能需要 Chatbox AI 云端解析。
    file_type_not_supported: {
      name: 'file_type_not_supported',
      code: 20007,
      i18nKey:
        'File type not supported. Supported formats vary by parser. Try PDF, modern Office files, EPUB, CSV/TSV, HTML/Markdown, or non-binary text/code files. Legacy Office formats may require Chatbox AI cloud parsing.',
    },
    // 发送的文件已经超过七天，为了保护您的隐私，所有文件相关的缓存数据已经清理。您需要重新创建对话或刷新上下文，然后再次发送文件。
    file_expired: {
      name: 'file_expired',
      code: 20008,
      i18nKey:
        'The file you sent has expired. To protect your privacy, all file-related cache data has been cleared. You need to create a new conversation or refresh the context, and then send the file again.',
    },
    // 未找到文件的缓存数据。请重新创建对话或刷新上下文，然后再次发送文件。
    file_not_found: {
      name: 'file_not_found',
      code: 20009,
      i18nKey:
        'The cache data for the file was not found. Please create a new conversation or refresh the context, and then send the file again.',
    },
    // 文件大小超过 50MB
    file_too_large: {
      name: 'file_too_large',
      code: 20010,
      i18nKey: 'The file size exceeds the limit of 50MB. Please reduce the file size and try again.',
    },
    // 当前模型不支持发送文件。目前支持的模型有 Chatbox AI 4
    model_not_support_file: {
      name: 'model_not_support_file',
      code: 20011,
      i18nKey:
        "The {{model}} API doesn't support document understanding. You can use <LinkToAdvancedFileProcessing>Chatbox AI Service</LinkToAdvancedFileProcessing> for cloud-based document analysis, or download <LinkToHomePage>Chatbox Desktop App</LinkToHomePage> for local document analysis.",
    },
    model_not_support_file_2: {
      name: 'model_not_support_file_2',
      code: 20012,
      i18nKey:
        "The {{model}} API doesn't support document understanding. You can download <LinkToHomePage>Chatbox Desktop App</LinkToHomePage> for local document analysis.",
    },
    // 当前模型不支持发送图片，推荐模型：Chatbox AI 4
    model_not_support_image: {
      name: 'model_not_support_image',
      code: 20013,
      i18nKey:
        'Sorry, the current model {{model}} API itself does not support image understanding. If you need to send images, please switch to another model or use the recommended <OpenMorePlanButton>Chatbox AI Models</OpenMorePlanButton>.',
    },
    model_not_support_image_2: {
      name: 'model_not_support_image_2',
      code: 20014,
      i18nKey:
        'Vision capability is not enabled for Model {{model}}. Please enable it or set a default OCR model in <OpenSettingButton>Settings</OpenSettingButton>',
    },
    // 当前模型不支持发送链接
    // 'model_not_support_link': {
    //     name: 'model_not_support_link',
    //     code: 20015,
    //     i18nKey: 'The {{model}} API does not support links. Please use <LinkToAdvancedUrlProcessing>Chatbox AI models</LinkToAdvancedUrlProcessing> instead, or download <LinkToHomePage>the desktop app</LinkToHomePage> for local processing.'
    // },
    // 'model_not_support_link_2': {
    //     name: 'model_not_support_link_2',
    //     code: 20016,
    //     i18nKey: 'The {{model}} API does not support links. Please download <LinkToHomePage>the desktop app</LinkToHomePage> for local processing.'
    // },
    model_not_support_non_text_file: {
      name: 'model_not_support_non_text_file',
      code: 20017,
      i18nKey:
        'The {{model}} API itself does not support sending files. Due to the complexity of file parsing locally, Chatbox only processes text-based files (including code). For additional file formats and enhanced document understanding capabilities, <LinkToAdvancedFileProcessing>Chatbox AI Service</LinkToAdvancedFileProcessing> is recommended.',
    },
    model_not_support_non_text_file_2: {
      name: 'model_not_support_non_text_file_2',
      code: 20018,
      i18nKey:
        'The {{model}} API itself does not support sending files. Due to the complexity of file parsing locally, Chatbox only processes text-based files (including code).',
    },
    system_error: {
      name: 'system_error',
      code: 20019,
      i18nKey:
        'An error occurred while processing your request. Please try again later. If this error continues, please send an email to hi@chatboxai.com for support.',
    },
    unknown: {
      name: 'unknown',
      code: 20020,
      i18nKey:
        'An unknown error occurred. Please try again later. If this error continues, please send an email to hi@chatboxai.com for support.',
    },
    model_not_support_web_browsing: {
      name: 'model_not_support_web_browsing',
      code: 20021,
      i18nKey:
        'The {{model}} API itself does not support web browsing. Supported models: <OpenMorePlanButton>Chatbox AI models</OpenMorePlanButton>, {{supported_web_browsing_models}}',
    },
    model_not_support_web_browsing_2: {
      name: 'model_not_support_web_browsing_2',
      code: 20022,
      i18nKey:
        'The {{model}} API itself does not support web browsing. Supported models: {{supported_web_browsing_models}}',
    },
    no_search_result: {
      name: 'no_search_result',
      code: 20023,
      i18nKey:
        'No search results found. Please use another <OpenExtensionSettingButton>search provider</OpenExtensionSettingButton> or try again later.',
    },
    chatbox_search_license_key_required: {
      name: 'chatbox_search_license_key_required',
      code: 20024,
      i18nKey:
        'You have selected Chatbox AI as the search provider, but a license key has not been entered yet. Please <OpenSettingButton>click here to open Settings</OpenSettingButton> and enter your license key, or choose a different <OpenExtensionSettingButton>search provider</OpenExtensionSettingButton>.',
    },
    tavily_api_key_required: {
      name: 'tavily_api_key_required',
      code: 20025,
      i18nKey:
        'You have selected Tavily as the search provider, but an API key has not been entered yet. Please <OpenExtensionSettingButton>click here to open Settings</OpenExtensionSettingButton> and enter your API key, or choose a different search provider.',
    },
    model_not_support_tool_use: {
      name: 'model_not_support_tool_use',
      code: 20026,
      i18nKey:
        'Tool use is not enabled for Model {{model}}. Please enable it in <OpenSettingButton>provider settings</OpenSettingButton> or switch to a model that supports tool use.',
    },
    mobile_not_support_local_file_parsing: {
      name: 'mobile_not_support_local_file_parsing',
      code: 20027,
      i18nKey:
        'Mobile devices temporarily do not support local parsing of this file type. Please use text files (txt, markdown, etc.) or use <LinkToAdvancedFileProcessing>Chatbox AI Service</LinkToAdvancedFileProcessing> for cloud-based document analysis.',
    },
    web_not_support_local_file_parsing: {
      name: 'web_not_support_local_file_parsing',
      code: 20028,
      i18nKey:
        'The web version temporarily does not support local parsing of this file type. Please use text files (txt, markdown, etc.) or use <LinkToAdvancedFileProcessing>Chatbox AI Service</LinkToAdvancedFileProcessing> for cloud-based document analysis.',
    },
    // Document parser errors for InputBox file preprocessing
    local_parser_failed: {
      name: 'local_parser_failed',
      code: 20029,
      i18nKey:
        'Local document parsing failed. You can go to <OpenDocumentParserSettingButton>Settings</OpenDocumentParserSettingButton> and switch to Chatbox AI for cloud-based document parsing.',
    },
    chatbox_ai_parser_failed: {
      name: 'chatbox_ai_parser_failed',
      code: 20030,
      i18nKey: 'Chatbox AI document parsing failed. Please try again later.',
    },
    chatbox_ai_parser_license_key_required: {
      name: 'chatbox_ai_parser_license_key_required',
      code: 20046,
      i18nKey:
        '<OpenSettingButton>Sign in to Chatbox AI</OpenSettingButton> to use your account license, or choose a different <OpenDocumentParserSettingButton>document parser</OpenDocumentParserSettingButton>.',
    },
    third_party_parser_failed: {
      name: 'third_party_parser_failed',
      code: 20031,
      i18nKey:
        'Document parsing failed. You can go to <OpenDocumentParserSettingButton>Settings</OpenDocumentParserSettingButton> and switch to Chatbox AI for cloud-based document parsing.',
    },
    third_party_parser_not_supported_in_chat: {
      name: 'third_party_parser_not_supported_in_chat',
      code: 20032,
      i18nKey:
        'Selected document parser is currently only supported in Knowledge Base. For chat file attachments, please go to <OpenDocumentParserSettingButton>Settings</OpenDocumentParserSettingButton> and switch to Local or Chatbox AI.',
    },
    mineru_api_token_required: {
      name: 'mineru_api_token_required',
      code: 20033,
      i18nKey:
        'MinerU API token is required. Please go to <OpenDocumentParserSettingButton>Settings</OpenDocumentParserSettingButton> and configure your MinerU API token.',
    },
    document_parser_not_configured: {
      name: 'document_parser_not_configured',
      code: 20034,
      i18nKey:
        'This file type requires a document parser. Please go to <OpenDocumentParserSettingButton>Settings</OpenDocumentParserSettingButton> and enable Chatbox AI document parsing.',
    },
    file_storage_quota_exceeded: {
      name: 'file_storage_quota_exceeded',
      code: MESSAGE_ERROR_CODES.FILE_STORAGE_QUOTA_EXCEEDED,
      i18nKey:
        'Storage is full. Delete some old conversations or large attachments, or free up device space, then try again.',
    },
    bocha_api_key_required: {
      name: 'bocha_api_key_required',
      code: 20035,
      i18nKey:
        'You have selected BoCha as the search provider, but an API key has not been entered yet. Please <OpenExtensionSettingButton>click here to open Settings</OpenExtensionSettingButton> and enter your API key, or choose a different search provider.',
    },
    searxng_base_url_required: {
      name: 'searxng_base_url_required',
      code: 20036,
      i18nKey:
        'You have selected SearXNG as the search provider, but an instance URL has not been entered yet. Please <OpenExtensionSettingButton>click here to open Settings</OpenExtensionSettingButton> and enter your SearXNG instance URL, or choose a different search provider.',
    },
    parse_link_failed: {
      name: 'parse_link_failed',
      code: 20037,
      i18nKey: 'Failed to read webpage content. Please try again later or use a different URL.',
    },
    parse_link_not_supported: {
      name: 'parse_link_not_supported',
      code: 20038,
      i18nKey:
        'The current search provider does not support reading webpages. Please <OpenExtensionSettingButton>choose a different search provider</OpenExtensionSettingButton> that supports this capability.',
    },
    file_preprocess_failed: {
      name: 'file_preprocess_failed',
      code: MESSAGE_ERROR_CODES.FILE_PREPROCESS_FAILED,
      i18nKey: 'Failed to parse file. Please try again or use a different file format.',
    },
    empty_attachment_content: {
      name: 'empty_attachment_content',
      code: MESSAGE_ERROR_CODES.EMPTY_ATTACHMENT_CONTENT,
      i18nKey: 'No readable content was found in this attachment. Please check the file and try again.',
    },
    // Free 用户在工作模式中点数耗尽，但仍可领取一次奖励额度继续当前任务
    free_agent_mode_token_quota_exhausted: {
      name: 'free_agent_mode_token_quota_exhausted',
      code: MESSAGE_ERROR_CODES.CHATBOX_AI_FREE_AGENT_MODE_QUOTA_EXHAUSTED,
      i18nKey: 'Your points are used up. Claim free reward quota to continue.',
    },
  }
  static fromCodeName(response: string, codeName: string, requestId?: string) {
    if (!codeName) {
      return null
    }
    if (ChatboxAIAPIError.codeNameMap[codeName]) {
      return new ChatboxAIAPIError(response, ChatboxAIAPIError.codeNameMap[codeName], requestId)
    }
    return null
  }
  static getDetail(code: number) {
    if (!code) {
      return null
    }
    for (const name in ChatboxAIAPIError.codeNameMap) {
      if (ChatboxAIAPIError.codeNameMap[name].code === code) {
        return ChatboxAIAPIError.codeNameMap[name]
      }
    }
    return null
  }

  public detail: ChatboxAIAPIErrorDetail
  constructor(message: string, detail: ChatboxAIAPIErrorDetail, requestId?: string) {
    super(message, { requestId })
    this.detail = detail
    this.code = detail.code
  }
}

interface ChatboxAIAPIErrorDetail {
  name: string
  code: number
  i18nKey: string
}
