export const pdfExts = ['.pdf']

export function isPdfFilePath(filePath: string) {
  return pdfExts.some((ext) => filePath.toLowerCase().endsWith(ext))
}

export const officeExts = [...pdfExts, '.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods']

export function isOfficeFilePath(filePath: string) {
  return officeExts.some((ext) => filePath.toLowerCase().endsWith(ext))
}

export const legacyOfficeExts = ['.doc', '.xls', '.ppt']

export function isLegacyOfficeFilePath(filePath: string) {
  return legacyOfficeExts.some((ext) => filePath.toLowerCase().endsWith(ext))
}

export const textExts = [
  '.txt', // Plain text file
  '.md', // Markdown file
  '.mdx', // Markdown file
  '.html', // HTML file
  '.htm', // HTML file (alternative extension)
  '.xml', // XML file
  '.json', // JSON file
  '.yaml', // YAML file
  '.yml', // YAML file (alternative extension)
  '.csv', // Comma-separated values file
  '.tsv', // Tab-separated values file
  '.ini', // Configuration file
  '.log', // Log file
  '.rtf', // Rich text format file
  '.tex', // LaTeX file
  '.srt', // Subtitle file
  '.xhtml', // XHTML file
  '.nfo', // Info file (mainly used for scene releases)
  '.conf', // Configuration file
  '.config', // Configuration file
  '.env', // Environment variables file
  '.rst', // reStructuredText file
  '.php', // PHP script file with embedded HTML
  '.js', // JavaScript file
  '.ts', // TypeScript file
  '.jsp', // JavaServer Pages file
  '.aspx', // ASP.NET file
  '.bat', // Windows batch file
  '.sh', // Unix/Linux shell script file
  '.py', // Python script file
  '.rb', // Ruby script file
  '.pl', // Perl script file
  '.sql', // SQL script file
  '.css', // Cascading Style Sheets file
  '.less', // Less CSS preprocessor file
  '.scss', // Sass CSS preprocessor file
  '.sass', // Sass file
  '.styl', // Stylus CSS preprocessor file
  '.coffee', // CoffeeScript file
  '.ino', // Arduino code file
  '.asm', // Assembly language file
  '.go', // Go language file
  '.scala', // Scala language file
  '.swift', // Swift language file
  '.kt', // Kotlin language file
  '.rs', // Rust language file
  '.lua', // Lua language file
  '.groovy', // Groovy language file
  '.dart', // Dart language file
  '.hs', // Haskell language file
  '.clj', // Clojure language file
  '.cljs', // ClojureScript language file
  '.elm', // Elm language file
  '.erl', // Erlang language file
  '.ex', // Elixir language file
  '.exs', // Elixir script file
  '.pug', // Pug (formerly Jade) template file
  '.haml', // Haml template file
  '.slim', // Slim template file
  '.tpl', // Template file (generic)
  '.ejs', // Embedded JavaScript template file
  '.hbs', // Handlebars template file
  '.mustache', // Mustache template file
  '.jade', // Jade template file (renamed to Pug)
  '.twig', // Twig template file
  '.blade', // Blade template file (Laravel)
  '.vue', // Vue.js single file component
  '.jsx', // React JSX file
  '.tsx', // React TSX file
  '.graphql', // GraphQL query language file
  '.gql', // GraphQL query language file
  '.proto', // Protocol Buffers file
  '.thrift', // Thrift file
  '.toml', // TOML configuration file
  '.edn', // Clojure data representation file
  '.cake', // CakePHP configuration file
  '.ctp', // CakePHP view file
  '.cfm', // ColdFusion markup language file
  '.cfc', // ColdFusion component file
  '.m', // Objective-C source file
  '.mm', // Objective-C++ source file
  '.gradle', // Gradle build file
  '.kts', // Kotlin Script file
  '.java', // Java code file
  '.cs', // C# code file
  '.c', // C source file
  '.h', // C/C++ header file
  '.cpp', // C++ source file
  '.hpp', // C++ header file
  '.cc', // C++ source file (alternative extension)
  '.cxx', // C++ source file (alternative extension)
  '.mjs', // JavaScript ES module file
  '.typ', // Typst source file
  '.patch', // Unified diff / patch file
  '.diff', // Diff file
  '.gitpatch', // Git patch file
  '.gitignore', // Git ignore rules
]

export function isTextFilePath(filePath: string) {
  return textExts.some((ext) => filePath.toLowerCase().endsWith(ext))
}

export const sessionAttachmentRagExts = [
  '.pdf',
  '.docx',
  '.pptx',
  '.odt',
  '.odp',
  '.epub',
  '.txt',
  '.md',
  '.mdx',
  '.html',
  '.htm',
  '.xhtml',
  '.xml',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.ini',
  '.log',
]

export function isSessionAttachmentRagSupportedFilePath(filePath: string) {
  return sessionAttachmentRagExts.some((ext) => filePath.toLowerCase().endsWith(ext))
}

export const epubExts = ['.epub']

export function isEpubFilePath(filePath: string) {
  return epubExts.some((ext) => filePath.toLowerCase().endsWith(ext))
}

// All supported file extensions (merged office, text, epub)
export const allSupportedExts = [...officeExts, ...textExts, ...epubExts]

// Unsupported file types (for user notification)
// Includes: iWork files (except numbers), audio/video files, binary files, etc.
export const unsupportedPatterns = {
  // iWork files (except numbers)
  iwork: ['.pages', '.key'],
  // Audio files
  audio: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.aiff', '.alac', '.ape', '.opus', '.mid', '.midi'],
  // Video files
  video: ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpeg', '.mpg', '.3gp', '.ts'],
  // Binary/executable files
  binary: ['.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.dmg', '.iso', '.img', '.app', '.msi', '.deb', '.rpm'],
  // Archive files
  archive: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.tgz'],
  // Image files (images are handled separately, but these formats are not supported as attachments)
  image: ['.psd', '.ai', '.sketch', '.fig', '.xd', '.raw', '.cr2', '.nef', '.arw', '.dng', '.heic'],
}

/**
 * Check if the file is a supported type
 * @param fileName File name or file path
 * @returns Whether the file is supported
 */
export function isSupportedFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase()
  // Support numbers files
  if (lowerName.endsWith('.numbers')) {
    return true
  }
  return allSupportedExts.some((ext) => lowerName.endsWith(ext))
}

/**
 * Check if the file is an explicitly unsupported type (for displaying friendlier messages)
 * @param fileName File name or file path
 * @returns The unsupported type category, or null if supported
 */
export function getUnsupportedFileType(fileName: string): string | null {
  const lowerName = fileName.toLowerCase()

  for (const [category, exts] of Object.entries(unsupportedPatterns)) {
    if (exts.some((ext) => lowerName.endsWith(ext))) {
      return category
    }
  }
  return null
}

/**
 * Get the file upload accept attribute value
 * Used for input[type="file"] and dropzone accept configuration
 */
export function getFileAcceptString(): string {
  // Merge all supported extensions, plus .numbers
  const exts = [...allSupportedExts, '.numbers']
  return exts.join(',')
}

/**
 * Get the file upload accept configuration object
 * Used for react-dropzone accept configuration
 */
export function getFileAcceptConfig(): Record<string, string[]> {
  return {
    // Image files
    'image/*': ['.jpg', '.jpeg', '.png'],
    // Text files
    'text/plain': [
      '.txt',
      '.log',
      '.nfo',
      '.ini',
      '.conf',
      '.config',
      '.env',
      '.typ',
      '.patch',
      '.diff',
      '.gitpatch',
      '.gitignore',
    ],
    'text/markdown': ['.md', '.mdx'],
    'text/html': ['.html', '.htm', '.xhtml'],
    'text/xml': ['.xml'],
    'text/csv': ['.csv', '.tsv'],
    'text/css': ['.css', '.less', '.scss', '.sass', '.styl'],
    // Code files
    'application/json': ['.json'],
    'application/javascript': ['.js', '.jsx', '.mjs'],
    'application/typescript': ['.ts', '.tsx'],
    'text/x-python': ['.py'],
    'text/x-java': ['.java'],
    'text/x-c': ['.c', '.h'],
    'text/x-c++': ['.cpp', '.hpp', '.cc', '.cxx'],
    'text/x-csharp': ['.cs'],
    'text/x-ruby': ['.rb'],
    'text/x-go': ['.go'],
    'text/x-rust': ['.rs'],
    'text/x-swift': ['.swift'],
    'text/x-kotlin': ['.kt', '.kts'],
    'text/x-scala': ['.scala'],
    // Office files
    'application/pdf': ['.pdf'],

    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    'application/vnd.oasis.opendocument.text': ['.odt'],
    'application/vnd.oasis.opendocument.presentation': ['.odp'],
    'application/vnd.oasis.opendocument.spreadsheet': ['.ods'],
    // Numbers (iWork)
    'application/vnd.apple.numbers': ['.numbers'],
    // Epub
    'application/epub+zip': ['.epub'],
    // Other code/config files (using application/octet-stream as fallback)
    'application/octet-stream': [
      '.yaml',
      '.yml',
      '.toml',
      '.rtf',
      '.tex',
      '.srt',
      '.rst',
      '.php',
      '.sh',
      '.bat',
      '.pl',
      '.sql',
      '.coffee',
      '.ino',
      '.asm',
      '.lua',
      '.groovy',
      '.dart',
      '.hs',
      '.clj',
      '.cljs',
      '.elm',
      '.erl',
      '.ex',
      '.exs',
      '.pug',
      '.haml',
      '.slim',
      '.tpl',
      '.ejs',
      '.hbs',
      '.mustache',
      '.jade',
      '.twig',
      '.blade',
      '.vue',
      '.graphql',
      '.gql',
      '.proto',
      '.thrift',
      '.edn',
      '.cake',
      '.ctp',
      '.cfm',
      '.cfc',
      '.m',
      '.mm',
      '.gradle',
      '.jsp',
      '.aspx',
    ],
  }
}
