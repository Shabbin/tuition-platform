const educationTree = require('../full_syllabus_all_subjects.json');

function getAllBanglaMediumSubjects(levelData, group) {
  if (!levelData || !group || !levelData[group]) return [];

  // Check if Departmental_Subjects or subjects exist (HSC cases)
  if (levelData[group].Departmental_Subjects) {
    return Object.keys(levelData[group].Departmental_Subjects);
  } else if (levelData[group].subjects) {
    return Object.keys(levelData[group].subjects);
  } 

  // Else, for SSC-like structure, return direct keys
  return Object.keys(levelData[group]);
}
function validateEducationPath({ educationSystem, board, level, group, subjects, subLevel }) {
  console.log(subjects);
  if (!Array.isArray(subjects)) {
    return { valid: false, message: 'Subjects must be an array' };
  }

  if (subjects.length > 5) {
    return { valid: false, message: 'You can select a maximum of 5 subjects' };
  }

  try {
    if (educationSystem === 'Bangla-Medium') {
      const levelData = educationTree[educationSystem]?.[level];

      if (!levelData) {
        return { valid: false, message: `Invalid level "${level}" for Bangla-Medium` };
      }

      if (!group || !['Science', 'Commerce', 'Arts'].includes(group)) {
        return { valid: false, message: `Invalid or missing group for Bangla-Medium ${level}` };
      }

      const availableSubjects = getAllBanglaMediumSubjects(levelData, group);
console.log("available subjects",availableSubjects)
      const invalidSubjects = subjects.filter(sub => !availableSubjects.includes(sub));
      if (invalidSubjects.length > 0) {
        return {
          valid: false,
          message: `Invalid subject(s) for Bangla-Medium ${level} - ${group}: ${invalidSubjects.join(', ')}`,
        };
      }

      return { valid: true };
    }

    if (educationSystem === 'GED') {
      const gedSubjects = Object.keys(educationTree['GED']);
      const invalidSubjects = subjects.filter(sub => !gedSubjects.includes(sub));

      if (invalidSubjects.length > 0) {
        return {
          valid: false,
          message: `Invalid GED subject(s): ${invalidSubjects.join(', ')}`,
        };
      }

      return { valid: true };
    }

    if (educationSystem === 'University-Admission') {
      const trackTree = educationTree['University-Admission']?.[board];
      if (!trackTree) {
        return { valid: false, message: `Invalid university admission track: ${board}` };
      }

      if (board === 'IBA') {
        const ibaSubjects = Object.keys(trackTree);
        const invalidSubjects = subjects.filter(sub => !ibaSubjects.includes(sub));
        if (invalidSubjects.length > 0) {
          return {
            valid: false,
            message: `Invalid IBA subject(s): ${invalidSubjects.join(', ')}`,
          };
        }
        return { valid: true };
      }

      if (board === 'Engineering' || board === 'Medical') {
        const validSubjects = trackTree.Subjects || [];
        const invalidSubjects = subjects.filter(sub => !validSubjects.includes(sub));
        if (invalidSubjects.length > 0) {
          return {
            valid: false,
            message: `Invalid subject(s) for ${board}: ${invalidSubjects.join(', ')}`,
          };
        }
        return { valid: true };
      }

      if (board === 'Public-University') {
        const validUnits = trackTree.Units;
        const invalidSubjects = subjects.filter(sub => !validUnits.includes(sub));
        if (invalidSubjects.length > 0) {
          return {
            valid: false,
            message: `Invalid public university unit(s): ${invalidSubjects.join(', ')}`,
          };
        }
        return { valid: true };
      }

      return { valid: false, message: 'Invalid university admission structure' };
    }

if (educationSystem === 'Entrance-Exams') {
  const exams = educationTree['Entrance-Exams'];
  if (!exams[board]) {
    return { valid: false, message: `Invalid exam '${board}' for Entrance-Exams` };
  }

  const validParts = Object.keys(exams[board].Parts);
  const invalidParts = subjects.filter(s => !validParts.includes(s));

  if (invalidParts.length > 0) {
    return {
      valid: false,
      message: `Invalid parts for ${board}: ${invalidParts.join(', ')}`,
    };
  }
  return { valid: true };
}
if (educationSystem === 'BCS') {
  const bcsTree = educationTree['BCS'];
  const cadre = group;

  if (!['General', 'Technical', 'Both'].includes(cadre)) {
    return { valid: false, message: `Invalid BCS group/cadre: ${cadre}` };
  }

  const phaseTree = bcsTree[cadre]?.[board];
  if (!phaseTree || !phaseTree.Parts) {
    return { valid: false, message: `Invalid BCS board "${board}" for group "${cadre}"` };
  }

  const validSubjects = Object.keys(phaseTree.Parts || {});
  const invalidSubjects = subjects.filter(sub => !validSubjects.includes(sub));

  if (invalidSubjects.length > 0) {
    return {
      valid: false,
      message: `Invalid subject(s) for BCS - ${cadre} - ${board}: ${invalidSubjects.join(', ')}`
    };
  }

  return { valid: true };
}
    
    // English-Medium and other standard flows
    const boardTree = educationTree[educationSystem]?.[board]?.[level];
    if (!boardTree) {
      return { valid: false, message: `Invalid board or level for ${educationSystem}` };
    }

    if (subLevel && subLevel.trim() !== '') {
  // boardTree is { "Chemistry-9701": {...}, "Physics-9702": {...}, ... }

  // Check each selected subject:
  for (const sub of subjects) {
    if (!boardTree[sub]) {
      return { valid: false, message: `Subject "${sub}" not found in ${educationSystem} - ${board} - ${level}` };
    }
    if (!boardTree[sub][subLevel]) {
      return { valid: false, message: `Invalid subLevel "${subLevel}" for subject "${sub}" in ${educationSystem} - ${board} - ${level}` };
    }
  }

  return { valid: true };
}else {
      const availableSubjects = Object.keys(boardTree);
      const invalidSubjects = subjects.filter(sub => !availableSubjects.includes(sub));
      if (invalidSubjects.length > 0) {
        return {
          valid: false,
          message: `Invalid subject(s): ${invalidSubjects.join(', ')} under ${level}`,
        };
      }

      return { valid: true };
    }
  } catch (err) {
    console.error('Education path validation error:', err);
    return { valid: false, message: 'Error validating education path' };
  }
}

module.exports = {
  validateEducationPath,
};
