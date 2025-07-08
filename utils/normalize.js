function flattenSubjects(subjects) {
  if (!subjects || !Array.isArray(subjects)) return [];

  const flat = [];

  const flatten = (arr) => {
    for (const item of arr) {
      if (!item) continue;

      if (typeof item === 'string') {
        try {
          const parsed = JSON.parse(item);
          if (Array.isArray(parsed)) {
            flatten(parsed);
          } else {
            flat.push(parsed.toString().trim());
          }
        } catch {
          flat.push(item.trim());
        }
      } else if (Array.isArray(item)) {
        flatten(item);
      } else {
        flat.push(item.toString().trim());
      }
    }
  };

  flatten(subjects);
  return Array.from(new Set(flat)); // Remove duplicates and ensure consistent array
}

module.exports = {
  flattenSubjects
};


module.exports = {
  flattenSubjects,
};
