function isProbablyGibberish(word) {
  if (!/[aeiou]/i.test(word)) return true; // No vowels → gibberish
  if (/([a-z])\1{2,}/i.test(word)) return true; // Repeated chars like "aaaa"
  if (/[^a-z]/i.test(word)) return true; // Symbols/numbers
  return false;
}
function isMeaningfulText(text) {
  if (!text || typeof text !== 'string') return false;

  const cleaned = text.trim();
  if (cleaned.length < 30) return false;  // lowered from 50

  const words = cleaned.split(/\s+/);
  if (words.length < 10) return false;  // lowered from 15

  const filteredWords = words.filter(w => w.length >= 3 && !isProbablyGibberish(w));
  const uniqueWords = new Set(filteredWords.map(w => w.toLowerCase()));

  return uniqueWords.size >= 5;  // lowered from 10
}
module.exports = isMeaningfulText;