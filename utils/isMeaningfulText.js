function isLikelyWord(word) {
  // Basic heuristic: word length >= 3, has vowels, mostly letters
  if (word.length < 3) return true; // small words like "is", "of", etc.
  if (!/[aeiou]/i.test(word)) return false; // no vowels → likely gibberish
  if (!/^[a-z]+$/i.test(word)) return false; // contains non-alpha chars
  return true;
}
function isMeaningfulText(text) {
  if (!text) return false;

  // Minimum length check
  if (text.trim().length < 20) return false;

  // Count English words present (simple dictionary of common English words)
  const commonWords = ['the', 'and', 'is', 'in', 'to', 'of', 'that', 'it', 'with', 'as', 'for', 'on', 'this', 'are'];
  const textWords = text.toLowerCase().split(/\W+/);

  const commonWordCount = textWords.filter(word => commonWords.includes(word)).length;

  // Heuristic: if common words < 2, likely gibberish
  if (commonWordCount < 2) return false;

  // Check if text has mostly letters (not all symbols or digits)
  const letterCount = (text.match(/[a-zA-Z]/g) || []).length;
  const totalLength = text.length;

  if (letterCount / totalLength < 0.6) return false; // at least 60% letters

  return true;
}

module.exports = isMeaningfulText;