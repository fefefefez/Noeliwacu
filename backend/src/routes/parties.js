const express = require('express');
const router = express.Router();
const { createParty, getParty } = require('../controllers/partyController');
const logger = require('../../logs/logger');
const Party = require('../models/Party');
const crypto = require('crypto');  // ✅ CHANGÉ : crypto au lieu de bcrypt


// POST /api/parties - créer une nouvelle party
router.post('/', createParty);

// GET /api/parties/:code - récupérer les détails d'une party
router.get('/:code', getParty);

// POST /api/parties/:code/verify-pin - Vérifier le PIN administrateur
router.post('/:code/verify-pin', async (req, res) => {
    try {
        const { code } = req.params;
        const { adminPin } = req.body;

        logger.info(`POST /api/parties/${code}/verify-pin`);

        // Vérifier que le PIN est fourni
        if (!adminPin) {
            logger.warn(`❌ PIN administrateur manquant pour la party ${code}`);
            return res.status(400).json({
                success: false,
                message: 'Le PIN admin est requis.'
            });
        }

        // Trouver la party
        const party = await Party.findOne({ code });
        if (!party) {
            logger.warn(`❌ Party non trouvée: ${code}`);
            return res.status(404).json({
                success: false,
                message: 'Fête non trouvée.'
            });
        }

        // ✅ NOUVEAU : Hasher le PIN avec SHA-256 pour comparer
        const hashedInputPin = crypto
            .createHash('sha256')
            .update(adminPin)
            .digest('hex');

        // ✅ NOUVEAU : Comparer avec le hash stocké dans la DB
        if (hashedInputPin !== party.adminPinHash) {
            logger.warn(`❌ PIN admin invalide pour la party ${code}`);
            return res.status(403).json({
                success: false,
                message: 'PIN administrateur incorrect.'
            });
        }

        logger.info(`✅ PIN admin validé pour la party ${code}`);
        res.json({
            success: true,
            message: 'PIN validé',
            drawDone: party.drawDone
        });

    } catch (error) {
        logger.error(`❌ Erreur lors de la vérification du PIN pour la party ${req.params.code}: ${error.message}`);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;