/**
 * List of supported Right-to-Left (RTL) language codes
 * This list is used to automatically detect and set page direction (dir="rtl")
 * @see https://www.w3.org/International/articles/inline-bidi-markup/
 */
const RTL_LANGUAGES = ['fa', 'ar', 'he', 'ur', 'ps', 'ku'];

/**
 * Checks if the given language code is a Right-to-Left (RTL) language
 * @param lang Language code (e.g., 'fa-IR', 'en-US', 'ar')
 * @returns true if the language is RTL, false otherwise
 */
export function isRTL(lang: string): boolean {
  const baseLang = lang.split('-')[0].toLowerCase();
  return RTL_LANGUAGES.includes(baseLang);
}