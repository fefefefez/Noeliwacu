const { adminPinLimiter } = require('../middleware/rateLimit');
const express = require('express');
const router = express.Router();
const drawController = require('../controllers/drawController');


/**
 * @route   POST /api/parties/:code/draw/preview
 * @desc    Génère un aperçu du tirage (stats uniquement, pas d'emails)
 * @access  Admin (PIN requis)
 */
router.post('/:code/draw/preview', adminPinLimiter, drawController.generateDrawPreview);

/**
 * @route   POST /api/parties/:code/draw/send
 * @desc    Effectue le tirage et envoie les emails
 * @access  Admin (PIN requis)
 */
router.post('/:code/draw/send', adminPinLimiter, drawController.sendDrawEmails);

/**
 * @route   GET /api/parties/:code/draw/status
 * @desc    Obtient le statut du tirage (fait ou pas)
 * @access  Public
 */
router.get('/:code/draw/status', drawController.getDrawStatus);

module.exports = router;

