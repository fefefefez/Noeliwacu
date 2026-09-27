const express = require('express');
const router = express.Router();
const { createParty, getParty } = require('../controllers/partyController');
const { verifiyPin } = require('../utils/helpers');
const Party = require('../models/Party');
const logger = require('../../logs/logger');


// POST /api/parties - créer une nouvelle party
router.post('/', createParty);

// GET /api/parties/:code - récupérer les détails d'une party
router.get('/:code', getParty);

// POST /api/parties/:code/verify-pin - Vérifier le PIN administrateur
router.post('/:code/verify-pin', async (req, res) => {
    const { code } = req.params;
    const { adminPin } = req.body;

    logger.info('POST /api/parties/verify-pin');

    try {
        const party = await Party.findOne({ code });

        if (!party) {
            logger.warn(`❌ Party non trouvée`);
            return res.status(404).json({
                success: false,
                message: 'Party non trouvée'
            });
        }

        // ✅ Utiliser la fonction verifiyPin EXISTANTE
        const isPinValid = await verifiyPin(adminPin, party.adminPinHash);

        if (!isPinValid) {
            logger.warn(`❌ PIN incorrect pour la party`);
            return res.status(403).json({
                success: false,
                message: 'PIN administrateur incorrect'
            });
        }

        logger.info(`✅ PIN vérifié avec succès pour la party`);

        return res.status(200).json({
            success: true,
            message: 'PIN administrateur correct'
        });
    } catch (error) {
        logger.error(`❌ Erreur lors de la vérification du PIN`);
        return res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

module.exports = router;