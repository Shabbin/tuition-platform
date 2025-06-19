// utils/normalize.js
function flattenSubjects(subjects) {
  const flat = [];

  const flatten = (arr) => {
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

  flatten(subjects);
  return Array.from(new Set(flat)); // Remove duplicates
}

module.exports = {
  flattenSubjects,
};
