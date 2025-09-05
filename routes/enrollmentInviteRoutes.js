// server/routes/enrollmentInviteRoutes.js
const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth'); // keep your auth as-is
const ctrl = require('../controllers/enrollmentInviteController'); // <- ensure this path is correct

// Wrap every route so Express always receives a function.
// If a controller export is missing/misnamed, you'll get a clear 501 response
// telling you which one instead of “argument handler must be a function”.
const wrap = (fnName) => {
  return (req, res, next) => {
    const fn = ctrl && ctrl[fnName];
    if (typeof fn !== 'function') {
      return res
        .status(501)
        .json({ error: 'Not implemented', missingExport: fnName, hint: 'Check controller export name/path' });
    }
    return fn(req, res, next);
  };
};

// Teacher creates an invite
router.post('/', auth('teacher'), wrap('createEnrollmentInvite'));

// Student lists invites sent to them
router.get('/incoming', auth('student'), wrap('listIncomingEnrollmentInvites'));

// Teacher lists invites they sent
router.get('/outgoing', auth('teacher'), wrap('listOutgoingEnrollmentInvites'));

// Student starts payment for an invite
router.post('/:inviteId/initiate', auth('student'), wrap('initiateInvitePayment'));

// (Teacher/admin) mark invite as paid (test/simulation)
router.post('/:inviteId/mark-paid', auth('teacher'), wrap('markInvitePaid'));

// Teacher cancels an invite
router.post('/:inviteId/cancel', auth('teacher'), wrap('cancelEnrollmentInvite'));

// Student declines an invite
router.post('/:inviteId/decline', auth('student'), wrap('declineEnrollmentInvite'));

module.exports = router;
