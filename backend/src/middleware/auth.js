const Party = require('../models/Party');
const { verifiyPin } = require('../utils/helpers');
const { isValidAdminPin } = require('../utils/validators');
const logger = require('../../logs/logger');

/**
 * Middleware pour vérifier le PIN administrateur d'une party
*/
async function verifyAdminPin(req, res, next) {
    const { code } = req.params;
    const adminPin = req.headers['x-admin-pin']; // Le pin est envoyé dans les headers

    if (!adminPin) {
        return res.status(401).json({
            success: false,
            message: 'PIN administrateur requis. Veuillez vous authentifier.'
        });
    }

    if (!isValidAdminPin(adminPin)) {
        logger.warn(`❌ Format de PIN administrateur invalide`);
        return res.status(400).json({
            success: false,
            message: 'Le PIN administrateur doit contenir exactement 4 chiffres.'
        });
    }

    try {
        // Trouver la party par son code
        const party = await Party.findOne({ code });

        if (!party) {
            return res.status(404).json({
                success: false,
                message: 'Party non trouvée.'
            });
        }

        // Vérifier le PIN
        const isPinValid = await verifiyPin(adminPin, party.adminPinHash);

        if (!isPinValid) {
            logger.warn(`Tentative d'accès administratif non autorisée`);
            return res.status(403).json({
                success: false,
                message: 'PIN administrateur incorrect.'
            });
        }

        // PIN valide, continuer vers le contrôleur
        req.party = party;
        logger.info(`Accès administrateur autorisé`);

        next(); // passer au contrôleur suivant

    } catch (error) {
        logger.error(`Erreur lors de la verification du PIN admin`);
        res.status(500).json({
            success: false,
            message: 'Erreur d\'authentification.'
        });
    }
}

module.exports = {
    verifyAdminPin
};