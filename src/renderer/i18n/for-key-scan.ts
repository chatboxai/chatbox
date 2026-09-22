/**
 * This file exists solely to help i18next-parser extract translation keys
 * that are used dynamically and therefore cannot be discovered from string
 * literals at the callsite.
 *
 * _errorI18nKeys covers keys defined in src/shared/models/errors.ts and used
 * dynamically via t(errorDetail.i18nKey) or <Trans i18nKey={errorDetail.i18nKey} />.
 *
 * Other enumerable dynamic keys should be added to _otherI18nKeys.
 *
 * Do NOT delete this file. It is not imported anywhere at runtime.
 * Error keys are generated from src/shared/models/errors.ts by script/sync-error-i18n-keys.mjs.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _errorI18nKeys(t: (key: string) => string) {
  // BEGIN GENERATED ERROR I18N KEYS
  t(
    'You have used up your monthly Chatbox AI quota. Please <OpenSettingButton>go to Settings</OpenSettingButton> to view your quota usage or upgrade your plan.'
  )
  t(
    'You have used up your daily Chatbox AI quota. Please <OpenSettingButton>go to Settings</OpenSettingButton> to view your quota usage or upgrade your plan.'
  )
  t(
    'Your current License (Chatbox AI Free/Lite) does not support the {{model}} model. To use this model, please <OpenMorePlanButton>upgrade</OpenMorePlanButton> to Chatbox AI Pro or a higher-tier package.'
  )
  t('Your license has expired. Please check your subscription or purchase a new one.')
  t(
    'Your plan has expired and has been automatically downgraded to the Free plan. Please refresh your license information and try again.'
  )
  t(
    'You have selected Chatbox AI as the model provider, but a license key has not been entered yet. Please <OpenSettingButton>click here to open Settings</OpenSettingButton> and enter your license key, or choose a different model provider.'
  )
  t('The license key you entered is invalid. Please check your license key and try again.')
  t('You have exceeded the rate limit for the Chatbox AI service. Please try again later.')
  t(
    'Invalid request parameters detected. Please try again later. Persistent failures may indicate an outdated software version. Consider upgrading to access the latest performance improvements and features.'
  )
  t(
    'File type not supported. Supported formats vary by parser. Try PDF, modern Office files, EPUB, CSV/TSV, HTML/Markdown, or non-binary text/code files. Legacy Office formats may require Chatbox AI cloud parsing.'
  )
  t(
    'The file you sent has expired. To protect your privacy, all file-related cache data has been cleared. You need to create a new conversation or refresh the context, and then send the file again.'
  )
  t(
    'The cache data for the file was not found. Please create a new conversation or refresh the context, and then send the file again.'
  )
  t('The file size exceeds the limit of 50MB. Please reduce the file size and try again.')
  t(
    "The {{model}} API doesn't support document understanding. You can use <LinkToAdvancedFileProcessing>Chatbox AI Service</LinkToAdvancedFileProcessing> for cloud-based document analysis, or download <LinkToHomePage>Chatbox Desktop App</LinkToHomePage> for local document analysis."
  )
  t(
    "The {{model}} API doesn't support document understanding. You can download <LinkToHomePage>Chatbox Desktop App</LinkToHomePage> for local document analysis."
  )
  t(
    'Sorry, the current model {{model}} API itself does not support image understanding. If you need to send images, please switch to another model or use the recommended <OpenMorePlanButton>Chatbox AI Models</OpenMorePlanButton>.'
  )
  t(
    'Vision capability is not enabled for Model {{model}}. Please enable it or set a default OCR model in <OpenSettingButton>Settings</OpenSettingButton>'
  )
  t(
    'The {{model}} API itself does not support sending files. Due to the complexity of file parsing locally, Chatbox only processes text-based files (including code). For additional file formats and enhanced document understanding capabilities, <LinkToAdvancedFileProcessing>Chatbox AI Service</LinkToAdvancedFileProcessing> is recommended.'
  )
  t(
    'The {{model}} API itself does not support sending files. Due to the complexity of file parsing locally, Chatbox only processes text-based files (including code).'
  )
  t(
    'An error occurred while processing your request. Please try again later. If this error continues, please send an email to hi@chatboxai.com for support.'
  )
  t(
    'An unknown error occurred. Please try again later. If this error continues, please send an email to hi@chatboxai.com for support.'
  )
  t(
    'The {{model}} API itself does not support web browsing. Supported models: <OpenMorePlanButton>Chatbox AI models</OpenMorePlanButton>, {{supported_web_browsing_models}}'
  )
  t('The {{model}} API itself does not support web browsing. Supported models: {{supported_web_browsing_models}}')
  t(
    'No search results found. Please use another <OpenExtensionSettingButton>search provider</OpenExtensionSettingButton> or try again later.'
  )
  t(
    'You have selected Chatbox AI as the search provider, but a license key has not been entered yet. Please <OpenSettingButton>click here to open Settings</OpenSettingButton> and enter your license key, or choose a different <OpenExtensionSettingButton>search provider</OpenExtensionSettingButton>.'
  )
  t(
    'You have selected Tavily as the search provider, but an API key has not been entered yet. Please <OpenExtensionSettingButton>click here to open Settings</OpenExtensionSettingButton> and enter your API key, or choose a different search provider.'
  )
  t(
    'Tool use is not enabled for Model {{model}}. Please enable it in <OpenSettingButton>provider settings</OpenSettingButton> or switch to a model that supports tool use.'
  )
  t(
    'Mobile devices temporarily do not support local parsing of this file type. Please use text files (txt, markdown, etc.) or use <LinkToAdvancedFileProcessing>Chatbox AI Service</LinkToAdvancedFileProcessing> for cloud-based document analysis.'
  )
  t(
    'The web version temporarily does not support local parsing of this file type. Please use text files (txt, markdown, etc.) or use <LinkToAdvancedFileProcessing>Chatbox AI Service</LinkToAdvancedFileProcessing> for cloud-based document analysis.'
  )
  t(
    'Local document parsing failed. You can go to <OpenDocumentParserSettingButton>Settings</OpenDocumentParserSettingButton> and switch to Chatbox AI for cloud-based document parsing.'
  )
  t('Chatbox AI document parsing failed. Please try again later.')
  t(
    '<OpenSettingButton>Sign in to Chatbox AI</OpenSettingButton> to use your account license, or choose a different <OpenDocumentParserSettingButton>document parser</OpenDocumentParserSettingButton>.'
  )
  t(
    'Document parsing failed. You can go to <OpenDocumentParserSettingButton>Settings</OpenDocumentParserSettingButton> and switch to Chatbox AI for cloud-based document parsing.'
  )
  t(
    'Selected document parser is currently only supported in Knowledge Base. For chat file attachments, please go to <OpenDocumentParserSettingButton>Settings</OpenDocumentParserSettingButton> and switch to Local or Chatbox AI.'
  )
  t(
    'MinerU API token is required. Please go to <OpenDocumentParserSettingButton>Settings</OpenDocumentParserSettingButton> and configure your MinerU API token.'
  )
  t(
    'This file type requires a document parser. Please go to <OpenDocumentParserSettingButton>Settings</OpenDocumentParserSettingButton> and enable Chatbox AI document parsing.'
  )
  t('Storage is full. Delete some old conversations or large attachments, or free up device space, then try again.')
  t(
    'You have selected BoCha as the search provider, but an API key has not been entered yet. Please <OpenExtensionSettingButton>click here to open Settings</OpenExtensionSettingButton> and enter your API key, or choose a different search provider.'
  )
  t(
    'You have selected SearXNG as the search provider, but an instance URL has not been entered yet. Please <OpenExtensionSettingButton>click here to open Settings</OpenExtensionSettingButton> and enter your SearXNG instance URL, or choose a different search provider.'
  )
  t('Failed to read webpage content. Please try again later or use a different URL.')
  t(
    'The current search provider does not support reading webpages. Please <OpenExtensionSettingButton>choose a different search provider</OpenExtensionSettingButton> that supports this capability.'
  )
  t('Failed to parse file. Please try again or use a different file format.')
  t('No readable content was found in this attachment. Please check the file and try again.')
  t('Your points are used up. Claim free reward quota to continue.')
  // END GENERATED ERROR I18N KEYS

  // HTTP status code errors (MessageErrTips.tsx)
  t(
    'HTTP error: Unauthorized (401). Your authentication credentials are invalid or have expired. Please check your API key or login status.'
  )
  t(
    'HTTP error: Forbidden (403). You do not have permission to access this resource. Please check your API key permissions or account status.'
  )
  t('HTTP error: Request Timeout (408). The server took too long to respond. Please try again later.')
  t(
    'HTTP error: Too Many Requests (429). The service is currently experiencing high demand or resource limitations. Please wait a moment and try again.'
  )
  t('HTTP error: Internal Server Error (500). The server encountered an unexpected error. Please try again later.')
  t(
    'HTTP error: Bad Gateway (502). The server received an invalid response from the upstream service. This is usually a temporary issue, please try again later.'
  )
  t(
    'HTTP error: Service Unavailable (503). The server is temporarily unavailable, possibly due to maintenance or overload. Please try again later.'
  )
  t(
    'HTTP error: Gateway Timeout (504). The server did not receive a timely response from the upstream service. This is usually a temporary issue, please try again later.'
  )
}

function _otherI18nKeys(t: (key: string) => string) {
  // src/renderer/routes/settings/route.tsx
  t('Model Provider')
  t('Models & services')
  t('Web Search')
  t('MCP')
  t('Knowledge Base')
  t('Skills')
  t('Document Parser')
  t('Chat Settings')
  t('Keyboard Shortcuts')
  t('General Settings')

  // src/shared/theme-colors.ts, rendered dynamically in settings/general.tsx
  t('Claude Classic')
  t('Mist Blue')

  // src/renderer/components/common/MessageLayoutPreview.tsx
  t('Left-aligned')
  t('Chat bubbles')

  // src/renderer/modals/ExportChat.tsx
  t('All threads')
  t('Current thread')

  // src/renderer/components/settings/DocumentParserSettings.tsx
  t('Local')
  t('MinerU')
  t('No points consumed')
  t(
    'Only supports basic text files (.txt, .md, .json, code files, etc.). For PDF and Office files, please switch to Chatbox AI.'
  )
  t(
    'Uses built-in document parsing feature, supports common file types. Free usage, no compute points will be consumed.'
  )
  t(
    'Cloud-based document parsing service, supports PDF, Office files, EPUB and many other file types. Consumes compute points.'
  )
  t(
    'Tries local parsing first without consuming compute points. If local parsing fails, Chatbox AI cloud parsing will be used and compute points will be consumed.'
  )
  t('Third-party cloud parsing service, supports PDF and most Office files. Requires API token.')

  // src/renderer/modals/FileParseError.tsx
  t('<OpenSettingButton>Sign in to Chatbox AI</OpenSettingButton> to use your account license.')

  // src/renderer/components/knowledge-base/KnowledgeBaseForm.tsx
  t('Parser used to process uploaded documents')

  // src/renderer/routes/settings/default-models.tsx
  t('Conversations')
  t('Default models for chats and everyday tasks.')
  t('Images & documents')
  t('Make attachments readable by your models.')
  t('Knowledge & search')
  t('Find relevant information in documents and on the web.')
  t('Image creation')
  t('Choose the model used in Image Creator.')
  t('Default chat model')
  t('Used for new chats. You can choose a different model in each chat.')
  t('Fast model')
  t('Used to automatically generate conversation titles. Choose a model with fast responses.')
  t('Image text recognition (OCR)')
  t('Extracts text from images when the chat model cannot read them directly.')
  t('Document parsing')
  t('Extracts content from uploaded files. Supported formats depend on the selected service.')
  t('Speech recognition')
  t('Convert speech to text.')
  t('Knowledge search (Embedding)')
  t('Converts text into vectors to find related content in your documents.')
  t('Search ranking (Rerank)')
  t('Ranks retrieved passages so the most relevant content is used in answers.')
  t('Web search')
  t('Searches the web when web search is enabled in a conversation.')
  t('Image generation')
  t('Used in Image Creator. Changing the model there also updates this selection.')
  t('Speech synthesis')
  t('Read replies aloud.')
  t('Built-in parser')
  t('Test connection')
  t('Check configuration')
  t('Connected')
  t('Configuration checked')
  t('Automatic selection follows the defaults for this feature.')
  t('Search requests are sent to the selected service.')
  t('Remote service')
  t('Remote \u00b7 Chatbox AI')
  t('Local service \u00b7 This device')
  t('Provider-managed service')
  t('On-device model')
  t('Check provider endpoint')
  t('Built-in parsing. Image recognition may use the selected OCR provider.')
  t('Uses local parsing where supported, with Chatbox cloud parsing as a fallback.')

  // Model configuration check messages
  t('No OCR model is available')
  t('Activate Chatbox AI, or pick a vision model of your own.')
  t('Chatbox AI is not activated')
  t('Activate Chatbox AI to use the built-in embedding model, or pick one from a provider you already configured.')
  t('Activate Chatbox AI to use the built-in rerank model, or pick one from a provider you already configured.')
  t('This provider is not configured')
  t('Check the credentials in Model Provider settings, or choose another provider.')
  t('Activate Chatbox AI for cloud parsing, or switch to local parsing on desktop.')
  t('MinerU API token is missing')
  t('Add a MinerU API token in Document Parser settings.')
  t('Activate Chatbox AI, or pick another search provider.')
  t('Tavily API key is missing')
  t('Add a Tavily API key in Web Search settings.')
  t('BoCha API key is missing')
  t('Add a BoCha API key in Web Search settings.')
  t('Querit API key is missing')
  t('Add a Querit API key in Web Search settings.')
  t('SearXNG URL is missing')
  t('Add a SearXNG instance URL in Web Search settings.')
  t('Activate Chatbox AI, or pick an image model from another provider.')
  t('Authentication failed')
  t('Check the API key in Model Provider settings, or choose another model.')
  t('Connection timed out')
  t('Check the network and the provider endpoint, or choose another model.')
  t('Activate Chatbox AI in Chatbox AI settings, or use your own model.')
  t('This configuration could not be verified')
  t('Check the selected model and provider settings.')
  t('Needs attention')
  t('Suggested action')
  t('This feature is not available yet')
  t('No setup is needed.')

  // src/renderer/components/ModelList.tsx
  t('Embedding')
  t('Rerank')
}
