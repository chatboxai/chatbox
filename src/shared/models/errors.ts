export class BaseError extends Error {
  public code = 1
  public requestId: string | undefined
  constructor(message: string, options?: { requestId?: string }) {
    super(message)
    this.requestId = options?.requestId
  }
}

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
  public code = 10006
  public ocrProvider: string
  public cause: Error
  constructor(ocrProvider: string, cause: Error) {
    super(`OCR Error (${ocrProvider}): ${cause.message}`)
    this.ocrProvider = ocrProvider
    this.cause = cause
  }
}

// Legacy shared error-code mapper. Keep entries local-first; do not add hosted
// account, billing, or hosted-service errors.
export class CodedError extends BaseError {
  static codeNameMap: { [codename: string]: CodedErrorDetail } = {
    rate_limit_exceeded: {
      name: 'rate_limit_exceeded',
      code: 20005,
      i18nKey: 'The selected provider is rate limited. Please try again later or choose a different provider.',
    },
    bad_params: {
      name: 'bad_params',
      code: 20006,
      i18nKey: 'Invalid request parameters detected. Please check your model/provider settings and try again.',
    },
    file_type_not_supported: {
      name: 'file_type_not_supported',
      code: 20007,
      i18nKey:
        'File type not supported. Supported formats vary by parser. Try PDF, modern Office files, EPUB, CSV/TSV, HTML/Markdown, or non-binary text/code files.',
    },
    file_expired: {
      name: 'file_expired',
      code: 20008,
      i18nKey:
        'The file you sent has expired. To protect your privacy, all file-related cache data has been cleared. You need to create a new conversation or refresh the context, and then send the file again.',
    },
    file_not_found: {
      name: 'file_not_found',
      code: 20009,
      i18nKey:
        'The cache data for the file was not found. Please create a new conversation or refresh the context, and then send the file again.',
    },
    file_too_large: {
      name: 'file_too_large',
      code: 20010,
      i18nKey: 'The file size exceeds the limit of 50MB. Please reduce the file size and try again.',
    },
    model_not_support_file: {
      name: 'model_not_support_file',
      code: 20011,
      i18nKey:
        "The {{model}} API doesn't support document understanding. Use a model with file support, or use local document parsing before sending the attachment.",
    },
    model_not_support_file_2: {
      name: 'model_not_support_file_2',
      code: 20012,
      i18nKey:
        "The {{model}} API doesn't support document understanding. You can download <LinkToHomePage>WorkspAIce Desktop App</LinkToHomePage> for local document analysis.",
    },
    model_not_support_image: {
      name: 'model_not_support_image',
      code: 20013,
      i18nKey:
        'Sorry, the current model {{model}} API itself does not support image understanding. Please switch to a model with vision support.',
    },
    model_not_support_image_2: {
      name: 'model_not_support_image_2',
      code: 20014,
      i18nKey:
        'Vision capability is not enabled for Model {{model}}. Please enable it or set a default OCR model in <OpenSettingButton>Settings</OpenSettingButton>',
    },
    model_not_support_non_text_file: {
      name: 'model_not_support_non_text_file',
      code: 20017,
      i18nKey:
        'The {{model}} API itself does not support sending files. WorkspAIce can only inline text-based files for this model. Use a compatible model or Knowledge Base for larger documents.',
    },
    model_not_support_non_text_file_2: {
      name: 'model_not_support_non_text_file_2',
      code: 20018,
      i18nKey:
        'The {{model}} API itself does not support sending files. Due to the complexity of file parsing locally, WorkspAIce only processes text-based files (including code).',
    },
    system_error: {
      name: 'system_error',
      code: 20019,
      i18nKey:
        'An error occurred while processing your request. Please try again later. If this error continues, please send an email to Report issues on GitHub for support.',
    },
    unknown: {
      name: 'unknown',
      code: 20020,
      i18nKey:
        'An unknown error occurred. Please try again later. If this error continues, please send an email to Report issues on GitHub for support.',
    },
    model_not_support_web_browsing: {
      name: 'model_not_support_web_browsing',
      code: 20021,
      i18nKey:
        'The {{model}} API itself does not support web browsing. Supported models: {{supported_web_browsing_models}}',
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
        'Mobile devices temporarily do not support local parsing of this file type. Please use text files (txt, markdown, etc.) or parse the file on the desktop app.',
    },
    web_not_support_local_file_parsing: {
      name: 'web_not_support_local_file_parsing',
      code: 20028,
      i18nKey:
        'The web version temporarily does not support local parsing of this file type. Please use text files (txt, markdown, etc.) or parse the file on the desktop app.',
    },
    // Document parser errors for InputBox file preprocessing
    local_parser_failed: {
      name: 'local_parser_failed',
      code: 20029,
      i18nKey:
        'Local document parsing failed. You can go to <OpenDocumentParserSettingButton>Settings</OpenDocumentParserSettingButton> and choose an available local or user-configured parser.',
    },
    third_party_parser_failed: {
      name: 'third_party_parser_failed',
      code: 20031,
      i18nKey:
        'Document parsing failed. You can go to <OpenDocumentParserSettingButton>Settings</OpenDocumentParserSettingButton> and choose a different available parser.',
    },
    third_party_parser_not_supported_in_chat: {
      name: 'third_party_parser_not_supported_in_chat',
      code: 20032,
      i18nKey:
        'Selected document parser is currently only supported in Knowledge Base. For chat file attachments, please go to <OpenDocumentParserSettingButton>Settings</OpenDocumentParserSettingButton> and switch to Local.',
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
        'This file type requires a document parser. Please go to <OpenDocumentParserSettingButton>Settings</OpenDocumentParserSettingButton> and enable an available local or user-configured parser.',
    },
    bocha_api_key_required: {
      name: 'bocha_api_key_required',
      code: 20035,
      i18nKey:
        'You have selected BoCha as the search provider, but an API key has not been entered yet. Please <OpenExtensionSettingButton>click here to open Settings</OpenExtensionSettingButton> and enter your API key, or choose a different search provider.',
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
  }
  static fromCodeName(response: string, codeName: string, requestId?: string) {
    if (!codeName) {
      return null
    }
    if (CodedError.codeNameMap[codeName]) {
      return new CodedError(response, CodedError.codeNameMap[codeName], requestId)
    }
    return null
  }
  static getDetail(code: number, preferredCodeName?: string) {
    if (!code) {
      return null
    }
    if (preferredCodeName) {
      const preferred = CodedError.codeNameMap[preferredCodeName]
      if (preferred && preferred.code === code) {
        return preferred
      }
    }
    for (const name in CodedError.codeNameMap) {
      if (CodedError.codeNameMap[name].code === code) {
        return CodedError.codeNameMap[name]
      }
    }
    return null
  }

  public detail: CodedErrorDetail
  constructor(message: string, detail: CodedErrorDetail, requestId?: string) {
    super(message, { requestId })
    this.detail = detail
    this.code = detail.code
  }
}

interface CodedErrorDetail {
  name: string
  code: number
  i18nKey: string
}
