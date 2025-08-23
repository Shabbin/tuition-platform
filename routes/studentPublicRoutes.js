const router = require('express').Router();
const User = require('../models/user');
router.get('/students/:id/credits', async (req, res) => {
  const s = await User.findById(req.params.id).select('_id topicCredits');
  if (!s) return res.status(404).json({ error: 'Student not found' });
  res.json({ studentId: s._id, topicCredits: s.topicCredits || 0 });
});
module.exports = router;
