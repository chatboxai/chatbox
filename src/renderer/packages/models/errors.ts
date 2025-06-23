export class BaseError extends Error {
  public code = 1
  constructor(message: string) {
    super(message)
  }
}

// 10000 - 19999 为通用网络接口错误

export class ApiError extends BaseError {
  public code = 10001
  public responseBody: string | undefined
  constructor(message: string, responseBody?: string) {
    super('API Error: ' + message)
    this.responseBody = responseBody
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

// 20000 - 29999 为 Chatbox AI 服务错误

// Chatbox AI 服务错误
// 注意，在开发时 i18nKey 中的标签和参数，都需要在 MessageErrTips 中定义
export class ChatboxAIAPIError extends BaseError {
  static codeNameMap: { [codename: string]: ChatboxAIAPIErrorDetail } = {
    // 超出配额
    token_quota_exhausted: {
      name: 'token_quota_exhausted',
      code: 10004, // 小于 20000 是为了兼容旧版本
      i18nKey:
        'You have reached your monthly quota for the {{model}} model. Please <OpenSettingButton>go to Settings</OpenSettingButton> to switch to a different model, view your quota usage, or upgrade your plan.',
    },
    // 当前套餐不支持该模型
    license_upgrade_required: {
      name: 'license_upgrade_required',
      code: 20001,
      i18nKey:
        'Your current License (Chatbox AI Lite) does not support the {{model}} model. To use this model, please <OpenMorePlanButton>upgrade</OpenMorePlanButton> to Chatbox AI Pro or a higher-tier package. Alternatively, you can switch to a different model by <OpenSettingButton>accessing the settings</OpenSettingButton>.',
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
    // 文件类型不支持。支持的类型有 txt、md、html、doc、docx、pdf、excel、pptx、csv 以及所有文本类型的文件，包括代码文件
    file_type_not_supported: {
      name: 'file_type_not_supported',
      code: 20007,
      i18nKey:
        'File type not supported. Supported types include txt, md, html, doc, docx, pdf, excel, pptx, csv, and all text-based files, including code files.',
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
        'Vision capability is not enabled for Model {{model}}. Please enable it in <OpenSettingButton>provider settings</OpenSettingButton> or switch to a model that supports vision.',
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
  }
  static fromCodeName(response: string, codeName: string) {
    if (!codeName) {
      return null
    }
    if (ChatboxAIAPIError.codeNameMap[codeName]) {
      return new ChatboxAIAPIError(response, ChatboxAIAPIError.codeNameMap[codeName])
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
  constructor(message: string, detail: ChatboxAIAPIErrorDetail) {
    super(message)
    this.detail = detail
    this.code = detail.code
  }
}

interface ChatboxAIAPIErrorDetail {
  name: string
  code: number
  i18nKey: string
}
