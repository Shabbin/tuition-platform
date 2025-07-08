function isProbablyGibberish(word) {
  if (!/[aeiou]/i.test(word)) return true; // No vowels
  if (/([a-z])\1{3,}/i.test(word)) return true; // Repeated letters like "aaaaa"
  if (/[^a-z]/i.test(word)) return true; // Symbols or numbers
  return false;
}

const isMeaningfulText = (text) => {
  if (!text || typeof text !== 'string') return false;

  const cleaned = text.trim();

  // Minimum character check (you can raise/lower the 30 if needed)
  if (cleaned.length < 30) return false;

  // Check that it contains at least 5 words (any Unicode word)
  const words = cleaned.match(/[\p{L}\p{N}]{2,}/gu);  // \p{L} = any letter, \p{N} = number
  return words && words.length >= 5;
};

function isValidTitle(title, tags = []) {
  if (!title || typeof title !== 'string') return false;

  const cleanedTitle = title.trim().toLowerCase();

  if (cleanedTitle.length < 5) return false;

  const normalizedTitle = cleanedTitle.replace(/\s+/g, '');

  // Normalize each tag the same way and check
  const hasMatchingTag = tags.some(tag => {
    const normalizedTag = tag.toString().trim().toLowerCase().replace(/\s+/g, '');
    return normalizedTitle.includes(normalizedTag);
  });

  // If no match or title is all symbols/numbers, it's invalid
  if (!hasMatchingTag || /^[^a-zA-Z]+$/.test(cleanedTitle)) {
    return false;
  }

  return true;
}

module.exports = {
  isMeaningfulText,
  isValidTitle,
  isProbablyGibberish
};
