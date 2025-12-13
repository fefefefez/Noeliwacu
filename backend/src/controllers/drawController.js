const Party = require('../models/Party');
const Participant = require('../models/Participant');
const { generatePairs, validatePairs, generatePreview } = require('../services/drawService');
const { sendAllEmails } = require('../services/emailService');
const { verifiyPin } = require('../utils/helpers');
const logger = require('../../logs/logger');

/**
 * Genere un aperçu du tirage sans envoyer les emails
 * Permet à l'admin de voir les stats avant de valider
 * 
 * POST /api/parties/:code/draw/preview
 * Body: { adminPin: "1234" }
 */
async function generateDrawPreview(req, res) {
    try {
        const { code } = req.params;
        const { adminPin } = req.body;

        logger.info(`🔔 Génération de l'aperçu du tirage pour la partie ${code}`);

        const party = await Party.findOne({ code });
        if (!party) {
            logger.warn(`❌ Partie non trouvée : ${code}`);
            return res.status(404).json({
                success: false,
                message: 'Partie non trouvée'
            });
        }

        const isPinValid = await verifiyPin(adminPin, party.adminPinHash);
        if (!isPinValid) {
            logger.warn(`❌ Pin admin invalide pour la partie ${code}`);
            return res.status(403).json({
                success: false,
                message: 'Pin admin invalide'
            });
        }

        if (party.drawDone) {
            logger.warn(`❌ Tirage déjà effectué pour la partie ${code}`);
            return res.status(400).json({
                success: false,
                message: 'Le tirage a déjà été effectué pour cette partie'
            });
        }

        const participants = await Participant.find({ partyId: party._id });
        if (participants.length < 2) {
            logger.warn(`❌ Pas assez de participants pour la partie ${code}`);
            return res.status(400).json({
                success: false,
                message: 'Pas assez de participants pour effectuer le tirage'
            });
        }

        logger.info(`🎲 Génération d'un aperçu pour la party ${code} (${participants.length} participants)`);

        const pairs = generatePairs(participants, party.preferCrossFamily);
        validatePairs(pairs);
        const preview = generatePreview(pairs);

        logger.info(`✅ Aperçu du tirage généré pour la partie ${code}`);

        // ✅ Retourner seulement les stats
        return res.status(200).json({
            success: true,
            message: 'Tirage généré avec succès',
            preview: {
                totalParticipants: participants.length,
                totalPairs: preview.totalPairs,
                crossFamily: preview.crossFamily,
                intraFamily: preview.intraFamily,
                percentage: preview.percentage,
                quality: preview.quality
            }
        });
    } catch (error) {
        logger.error(`❌ Erreur lors de la génération de l'aperçu du tirage : ${error.message}`);
        return res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de la génération de l\'aperçu du tirage',
            error: error.message
        });
    }
}

/**
* Effectue le tirage et envoie les emails
* POST /api/parties/:code/draw/send
* Body: { adminPin: "1234" }
*/
async function sendDrawEmails(req, res) {
    try {
        const { code } = req.params;
        const { adminPin } = req.body;

        logger.info(`🔔 Démarrage du tirage pour la partie ${code}`);

        const party = await Party.findOne({ code });
        if (!party) {
            logger.warn(`❌ Partie non trouvée : ${code}`);
            return res.status(404).json({
                success: false,
                message: 'Partie non trouvée'
            });
        }

        const isPinValid = await verifiyPin(adminPin, party.adminPinHash);
        if (!isPinValid) {
            logger.warn(`❌ Pin admin invalide pour la partie ${code}`);
            return res.status(403).json({
                success: false,
                message: 'Pin admin invalide'
            });
        }

        if (party.drawDone) {
            logger.warn(`❌ Tirage déjà effectué pour la partie ${code}`);
            return res.status(400).json({
                success: false,
                message: 'Le tirage a déjà été effectué pour cette partie'
            });
        }

        const participants = await Participant.find({ partyId: party._id });
        if (participants.length < 2) {
            logger.warn(`❌ Pas assez de participants pour la partie ${code}`);
            return res.status(400).json({
                success: false,
                message: 'Pas assez de participants pour effectuer le tirage'
            });
        }

        logger.info(`🎲 Génération des paires pour la party ${code} (${participants.length} participants)`);

        // generer les paires
        const pairs = generatePairs(participants, party.preferCrossFamily);
        validatePairs(pairs);

        // ✅ SAUVEGARDER les paires dans la DB
        party.pairsGenerated = pairs.map(pair => ({
            giverId: pair.giver._id,
            receiverId: pair.receiver._id
        }));

        const stats = generatePreview(pairs);
        logger.info(`📧 Envoi des emails...`);

        // envoyer les emails
        const emailResults = await sendAllEmails(pairs, party);

        // marquer le tirage comme fait
        party.drawDone = true;
        party.drawDate = new Date();
        await party.save();

        logger.info(`✅ Tirage effectué et emails envoyés pour la partie ${code}`);

        return res.status(200).json({
            success: true,
            message: 'Tirage effectué et emails envoyés avec succès',
            emailsSent: emailResults.sent,  // ✅ Simplifié pour AdminDashboard
            results: {
                totalParticipants: participants.length,
                emailsSent: emailResults.sent,
                emailsFailed: emailResults.failed,
                errors: emailResults.errors,
                stats: {
                    quality: stats.quality,
                    crossFamily: stats.crossFamily,
                    intraFamily: stats.intraFamily,
                    percentage: stats.percentage
                }
            }
        });
    } catch (error) {
        logger.error(`❌ Erreur lors du tirage ou de l'envoi des emails : ${error.message}`);
        return res.status(500).json({
            success: false,
            message: 'Erreur serveur lors du tirage ou de l\'envoi des emails',
            error: error.message
        });
    }
}

/**
 * Obtenir le statut du tirage pour une partie
 * 
 * GET /api/parties/:code/draw/status
 */
async function getDrawStatus(req, res) {
    try {
        const { code } = req.params;

        logger.info(`📊 Demande du statut du tirage pour la partie ${code}`);

        // verifier que la partie existe
        const party = await Party.findOne({ code });
        if (!party) {
            logger.warn(`❌ Partie non trouvée : ${code}`);
            return res.status(404).json({
                success: false,
                message: 'Partie non trouvée'
            });
        }

        // compter les participants
        const participantCount = await Participant.countDocuments({ partyId: party._id });

        res.status(200).json({
            success: true,
            status: {
                drawDone: party.drawDone,
                drawDate: party.drawDate,
                participantCount,
                canDraw: participantCount >= 2 && !party.drawDone
            }
        });
    } catch (error) {
        logger.error(`❌ Erreur lors de la récupération du statut du tirage : ${error.message}`);
        return res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de la récupération du statut du tirage',
            error: error.message
        });
    }
}

module.exports = {
    generateDrawPreview,
    sendDrawEmails,
    getDrawStatus
};
