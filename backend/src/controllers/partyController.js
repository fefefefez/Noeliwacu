const Party = require('../models/Party');
const { generatePartyCode } = require('../utils/validators');
const { hashPin } = require('../utils/helpers');
const logger = require('../../logs/logger');

/**
 * Créer une nouvelle party Secret Santa
 * @route POST /api/parties
 */
async function createParty(req, res) {
    const { name, budget, date, families, preferCrossFamily, adminPin } = req.body;

    logger.info('POST /api/parties - Tentative de création de party');

    // ✅ AJOUTÉ : Validation avec logs
    if (!name || !adminPin) {
        logger.warn('❌ Validation échouée : Nom ou PIN manquant');
        return res.status(400).json({
            success: false,
            message: 'Nom et PIN administrateur sont obligatoires.'
        });
    }

    if (!families || families.length < 2) {
        logger.warn('❌ Validation échouée : Moins de 2 familles fournies');
        return res.status(400).json({
            success: false,
            message: 'Il faut au moins 2 familles.'
        });
    }

    try {
        let code = generatePartyCode();

        // Vérifier que le code est unique
        let existingParty = await Party.findOne({ code });

        while (existingParty) {
            code = generatePartyCode();
            existingParty = await Party.findOne({ code });
        }

        const party = new Party({
            code,
            name,
            budget: budget || null,
            date: date || null,
            families,
            preferCrossFamily: preferCrossFamily !== false,
            adminPinHash: await hashPin(adminPin)
        });

        await party.save();

        logger.info(`✅ Party créée avec succès : ${code} - "${name}" - Familles: ${families.join(', ')}`);

        res.status(201).json({
            success: true,
            party: {
                code,
                name,
                budget: party.budget,
                date: party.date,
                families: party.families,
                preferCrossFamily: party.preferCrossFamily
            }
        });
    } catch (error) {
        logger.error(`❌ Erreur lors de la création de la party: ${error.message}`);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la création de la party.'
        });
    }
}

/**
 * Récupérer les détails d'une party
 * @route GET /api/parties/:code
 */
async function getParty(req, res) {
    const { code } = req.params;

    logger.info(`GET /api/parties/${code}`);

    try {
        const party = await Party.findOne({ code });

        if (!party) {
            logger.warn(`❌ Party non trouvée : ${code}`);
            return res.status(404).json({
                success: false,
                message: 'Party non trouvée.'
            });
        }

        logger.info(`✅ Party trouvée : ${code} - "${party.name}"`);

        res.json({
            success: true,
            party: {
                code: party.code,
                name: party.name,
                budget: party.budget,
                date: party.date,
                families: party.families,
                drawDone: party.drawDone,
                preferCrossFamily: party.preferCrossFamily
            }
        });
    } catch (error) {
        logger.error(`❌ Erreur lors de la récupération de la party ${code}: ${error.message}`);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération de la party.'
        });
    }
}

module.exports = {
    createParty,
    getParty
};