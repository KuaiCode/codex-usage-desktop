import { getLanguage } from "./languages";

export function getReleaseNotes(notes: string, locale: string): string {
  try {
    const parsed = JSON.parse(notes);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const language = getLanguage(locale);
      if (typeof parsed[language] === "string") return parsed[language];
      if (typeof parsed.en === "string") return parsed.en;
    }
  } catch {
    // Plain-text release notes need no translation selection.
  }
  return notes;
}
