const { adminPinLimiter } = require('../middleware/rateLimit');
const express = require('express');
const router = express.Router();
const drawController = require('../controllers/drawController');
const { verifyAdminPin } = require('../middleware/auth');
const notificationController = require('../controllers/notificationController');
const { createNotificationBudget } = require('../middleware/notificationBudget');
const rateLimit = require('express-rate-limit');
const notificationSendLimiter = rateLimit({ windowMs: 60000, limit: 10,
    standardHeaders: true, legacyHeaders: false,
    message: { success: false, code: 'NOTIFICATION_RATE_LIMITED' } });


/**
 * @route   POST /api/parties/:code/draw/prepare
 * @desc    Sauvegarde le tirage officiel sans envoyer d'email
 * @access  Admin (header X-Admin-Pin requis)
 */
router.post('/:code/draw/prepare', adminPinLimiter, verifyAdminPin, drawController.prepareDraw);

// Lecture administrative et reconciliation uniquement, aucun appel SMTP.
router.get('/:code/draw/notifications', adminPinLimiter, verifyAdminPin, notificationController.getNotificationStatus);

router.post('/:code/draw/notifications/:participantId/send', createNotificationBudget(),
    notificationSendLimiter, adminPinLimiter, verifyAdminPin, notificationController.sendNotification);

/**
 * @route   POST /api/parties/:code/draw/preview
 * @desc    Génère un aperçu du tirage (stats uniquement, pas d'emails)
 * @access  Admin (PIN requis)
 */
router.post('/:code/draw/preview', adminPinLimiter, drawController.generateDrawPreview);

/**
 * @route   POST /api/parties/:code/draw/send
 * @desc    Ancien flux desactive : retourne 410 sans generer ni envoyer
 * @access  Desactive pour tous les appels
 */
router.post('/:code/draw/send', adminPinLimiter, drawController.sendDrawEmails);

/**
 * @route   GET /api/parties/:code/draw/status
 * @desc    Obtient le statut du tirage (fait ou pas)
 * @access  Public
 */
router.get('/:code/draw/status', drawController.getDrawStatus);

module.exports = router;

