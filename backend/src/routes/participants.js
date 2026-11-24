const { adminPinLimiter } = require('../middleware/rateLimit');
const express = require('express');
const router = express.Router();
const { addParticipant, getParticipants, updateParticipant, deleteParticipant } = require('../controllers/participantController');
const { verifyAdminPin } = require('../middleware/auth');

// Post  /api/participants/party/:code - ajouter un nouveau participant
router.post('/party/:code', addParticipant);

// Get  /api/participants/:code - recuperer les participants d'une party
router.get('/party/:code', adminPinLimiter, verifyAdminPin, getParticipants);

router.post('/party/:code/admin', adminPinLimiter, verifyAdminPin, addParticipant);
router.patch('/party/:code/admin/:participantId', adminPinLimiter, verifyAdminPin, updateParticipant);
router.delete('/party/:code/admin/:participantId', adminPinLimiter, verifyAdminPin, deleteParticipant);

module.exports = router;
