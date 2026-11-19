// S821e: walks with Chrome's translator in Punjabi, Hindi, Arabic and Chinese
// showed the app reads well translated, but a fresh page load drops back to
// English unless the landlord picked "Always translate". The language names
// are written in their own script so a reader who cannot read English still
// finds the line; they are marked not to translate.
export const TRANSLATE_LANGUAGE_NAMES = ["ਪੰਜਾਬੀ", "हिन्दी", "العربية", "中文", "Tagalog"] as const;
export const TRANSLATE_HINT = "In Chrome, open the menu and choose Translate. Then choose Always translate.";
/** One plain line for emails. */
export const TRANSLATE_HINT_EMAIL = `${TRANSLATE_LANGUAGE_NAMES.join(", ")}: you can read Vacantless in your language. ${TRANSLATE_HINT}`;
