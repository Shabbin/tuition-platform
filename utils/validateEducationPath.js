// utils/validateEducationPath.js
const educationTree = require('../full_syllabus_all_subjects.json');

const norm = (s) => (s ?? '').toString().trim().toLowerCase();
const normArr = (arr) => (Array.isArray(arr) ? arr.map(norm) : []);

function getAllBanglaMediumSubjects(levelData, group) {
  if (!levelData || !group || !levelData[group]) return [];
  if (levelData[group].Departmental_Subjects) {
    return Object.keys(levelData[group].Departmental_Subjects || {});
  }
  if (levelData[group].subjects) {
    return Object.keys(levelData[group].subjects || {});
  }
  return Object.keys(levelData[group] || {});
}

function validateEducationPath({ educationSystem, board, level, group, subjects, subLevel }) {
  if (!Array.isArray(subjects)) {
    return { valid: false, message: 'Subjects must be an array' };
  }
  if (subjects.length > 5) {
    return { valid: false, message: 'You can select a maximum of 5 subjects' };
  }

  const selected = normArr(subjects);

  try {
    // Bangla-Medium
    if (educationSystem === 'Bangla-Medium') {
      const levelData = educationTree['Bangla-Medium']?.[level];
      if (!levelData) return { valid: false, message: `Invalid level "${level}" for Bangla-Medium` };
      if (!group || !['Science', 'Commerce', 'Arts'].includes(group)) {
        return { valid: false, message: `Invalid or missing group for Bangla-Medium ${level}` };
      }
      const available = getAllBanglaMediumSubjects(levelData, group);
      const validSet = new Set(normArr(available));
      const bad = subjects.filter((s) => !validSet.has(norm(s)));
      if (bad.length) {
        return { valid: false, message: `Invalid subject(s) for Bangla-Medium ${level} - ${group}: ${bad.join(', ')}` };
      }
      return { valid: true };
    }

    // GED
    if (educationSystem === 'GED') {
      const ged = Object.keys(educationTree['GED'] || {});
      const validSet = new Set(normArr(ged));
      const bad = subjects.filter((s) => !validSet.has(norm(s)));
      if (bad.length) return { valid: false, message: `Invalid GED subject(s): ${bad.join(', ')}` };
      return { valid: true };
    }

    // University-Admission (no level)
    if (educationSystem === 'University-Admission') {
      const ua = educationTree['University-Admission'] || {};
      const track = ua?.[board];
      if (!track) return { valid: false, message: `Invalid university admission track: ${board}` };

      if (board === 'IBA') {
        const parts = Object.keys(track || {});
        const validSet = new Set(normArr(parts));
        const bad = subjects.filter((s) => !validSet.has(norm(s)));
        if (bad.length) return { valid: false, message: `Invalid IBA subject(s): ${bad.join(', ')}` };
        return { valid: true };
      }

      if (board === 'Engineering' || board === 'Medical') {
        const parts = track?.Subjects || [];
        const validSet = new Set(normArr(parts));
        const bad = subjects.filter((s) => !validSet.has(norm(s)));
        if (bad.length) return { valid: false, message: `Invalid subject(s) for ${board}: ${bad.join(', ')}` };
        return { valid: true };
      }

      if (board === 'Public-University') {
        const units = track?.Units || [];
        const validSet = new Set(normArr(units));
        const bad = subjects.filter((s) => !validSet.has(norm(s)));
        if (bad.length) return { valid: false, message: `Invalid public university unit(s): ${bad.join(', ')}` };
        return { valid: true };
      }

      return { valid: false, message: 'Invalid university admission structure' };
    }

    // Entrance-Exams — accept both shapes:
    // 1) { IELTS: { Listening:[], ... } }  OR
    // 2) { IELTS: { Parts: { Listening:[], ... } } }
    if (educationSystem === 'Entrance-Exams') {
      const exams = educationTree['Entrance-Exams'] || {};
      const examNode = exams?.[board];
      if (!examNode || typeof examNode !== 'object') {
        return { valid: false, message: `Invalid exam '${board}' for Entrance-Exams` };
      }
      const partsObj = (examNode.Parts && typeof examNode.Parts === 'object') ? examNode.Parts : examNode;
      const parts = Object.keys(partsObj || {});
      const validSet = new Set(normArr(parts));
      const bad = subjects.filter((s) => !validSet.has(norm(s)));
      if (bad.length) return { valid: false, message: `Invalid parts for ${board}: ${bad.join(', ')}` };
      return { valid: true };
    }

    // BCS — stage-only (Preliminary/Written/Viva). Subjects optional; if given, must exist under stage.Parts
    if (educationSystem === 'BCS') {
      const bcs = educationTree['BCS'] || {};
      if (!['Preliminary', 'Written', 'Viva'].includes(board)) {
        return { valid: false, message: `Invalid BCS stage: ${board}` };
      }
      const stage = bcs?.[board];
      const partsObj = (stage && typeof stage.Parts === 'object' && stage.Parts) || {};
      if (!subjects || subjects.length === 0) return { valid: true }; // allow zero
      const parts = Object.keys(partsObj);
      const validSet = new Set(normArr(parts));
      const bad = subjects.filter((s) => !validSet.has(norm(s)));
      if (bad.length) return { valid: false, message: `Invalid subject(s) for BCS - ${board}: ${bad.join(', ')}` };
      return { valid: true };
    }

    // English-Medium / others with board+level (+ optional subLevel)
    const boardTree = educationTree?.[educationSystem]?.[board]?.[level];
    if (!boardTree) return { valid: false, message: `Invalid board or level for ${educationSystem}` };

    if (subLevel && subLevel.trim() !== '') {
      for (const sub of subjects) {
        const subKey = Object.keys(boardTree).find((k) => norm(k) === norm(sub));
        if (!subKey) {
          return { valid: false, message: `Subject "${sub}" not found in ${educationSystem} - ${board} - ${level}` };
        }
        if (!boardTree[subKey]?.[subLevel]) {
          return {
            valid: false,
            message: `Invalid subLevel "${subLevel}" for subject "${sub}" in ${educationSystem} - ${board} - ${level}`,
          };
        }
      }
      return { valid: true };
    } else {
      const available = Object.keys(boardTree || {});
      const validSet = new Set(normArr(available));
      const bad = subjects.filter((s) => !validSet.has(norm(s)));
      if (bad.length) return { valid: false, message: `Invalid subject(s): ${bad.join(', ')} under ${level}` };
      return { valid: true };
    }
  } catch (err) {
    console.error('Education path validation error (guarded):', err);
    return { valid: false, message: 'Error validating education path' };
  }
}

module.exports = { validateEducationPath };
