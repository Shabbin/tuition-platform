// utils/normalize.js
function flattenSubjects(subjects) {
  const flat = [];

  const flatten = (arr) => {
    if (!Array.isArray(arr)) return; // prevent crash on non-arrays
    arr.forEach((item) => {
      if (typeof item === 'string') {
        try {
          const parsed = JSON.parse(item);
          if (Array.isArray(parsed)) flatten(parsed);
          else flat.push(parsed);
        } catch {
          flat.push(item.trim());
        }
      } else if (Array.isArray(item)) {
        flatten(item);
      } else if (item) {
        flat.push(String(item).trim());
      }
    });
  };

  if (subjects) flatten(subjects); // protect against null/undefined
  return Array.from(new Set(flat)); // Remove duplicates
}

module.exports = {
  flattenSubjects,
};
