const { randomUUID } = require('node:crypto');
const Party = require('../models/Party');
const Participant = require('../models/Participant');
const { generatePairs, validatePairs, generatePreview } = require('../services/drawService');
const { verifiyPin } = require('../utils/helpers');
const { isValidAdminPin } = require('../utils/validators');
const logger = require('../../logs/logger');
const { withPartyTransaction, hasDrawState, PartyOperationError, TransactionResultUnknownError,
    findCommitted } = require('../utils/partyTransaction');

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
        const { adminPin } = req.body || {};

        if (!isValidAdminPin(adminPin)) {
            logger.warn(`❌ Format de PIN administrateur invalide`);
            return res.status(400).json({
                success: false,
                message: 'Le PIN administrateur doit contenir exactement 4 chiffres.'
            });
        }

        logger.info(`🔔 Génération de l'aperçu du tirage pour la partie`);

        const party = await Party.findOne({ code });
        if (!party) {
            logger.warn(`❌ Partie non trouvée`);
            return res.status(404).json({
                success: false,
                message: 'Partie non trouvée'
            });
        }

        const isPinValid = await verifiyPin(adminPin, party.adminPinHash);
        if (!isPinValid) {
            logger.warn(`❌ Pin admin invalide pour la partie`);
            return res.status(403).json({
                success: false,
                message: 'Pin admin invalide'
            });
        }

        if (hasDrawState(party)) {
            logger.warn(`❌ Tirage déjà effectué pour la partie`);
            return res.status(400).json({
                success: false,
                message: 'Le tirage a déjà été effectué pour cette partie'
            });
        }

        const participants = await Participant.find({ partyId: party._id });
        if (participants.length < 2) {
            logger.warn(`❌ Pas assez de participants pour la partie`);
            return res.status(400).json({
                success: false,
                message: 'Pas assez de participants pour effectuer le tirage'
            });
        }

        logger.info(`🎲 Génération d'un aperçu pour la party (${participants.length} participants)`);

        const pairs = generatePairs(participants, party.preferCrossFamily);
        validatePairs(pairs);
        const preview = generatePreview(pairs);

        logger.info(`✅ Aperçu du tirage généré pour la partie`);

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
        logger.error(`❌ Erreur lors de la génération de l'aperçu du tirage`);
        return res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de la génération de l\'aperçu du tirage'
        });
    }
}

/**
 * POST /api/parties/:code/draw/prepare
 * Admin authentifie par le middleware existant (header X-Admin-Pin).
 * Aucun envoi : une seule ecriture conditionnelle fixe le tirage officiel.
 */
async function prepareDraw(req, res) {
    try {
        const drawId = randomUUID();
        const drawDate = new Date();
        // Le document du middleware sert a identifier la fete, pas de snapshot
        // pour le tirage. Relire sous verrou transactionnel avant les participants.
        const prepared = await withPartyTransaction({ _id: req.party._id }, async (party, session) => {
            if (hasDrawState(party)) {
                throw new PartyOperationError(409,
                    'Un tirage existe déjà pour cette fête. Il ne sera pas remplacé.', 'DRAW_ALREADY_EXISTS');
            }

            const participants = await Participant.find({ partyId: party._id })
                .select('_id name email familyGroup').session(session);
            if (participants.length < 2) {
                throw new PartyOperationError(400, 'Pas assez de participants pour effectuer le tirage');
            }

            const pairs = generatePairs(participants, party.preferCrossFamily);
            validatePairs(pairs);

            // validatePairs assure unicite et absence d'auto-attribution. On verifie
            // aussi la couverture exacte de la liste chargee, sans identifiant etranger.
            const participantIds = new Set(participants.map(participant => String(participant._id)));
            if (participantIds.size !== participants.length || pairs.length !== participants.length ||
                !pairs.every(pair => participantIds.has(String(pair.giver._id)) &&
                    participantIds.has(String(pair.receiver._id)))) {
                throw new Error('Le tirage ne couvre pas exactement les participants inclus.');
            }

            // Ne pas utiliser document.save() : deux requetes peuvent avoir lu le
            // meme etat initial. MongoDB doit verifier les gardes au moment d'ecrire.
            // Les tableaux null/malformes sont refuses par precaution.
            const savedDraw = await Party.findOneAndUpdate({
                _id: party._id,
                drawDone: { $ne: true },
                drawDate: null,
                drawId: null,
                $and: ['pairsGenerated', 'drawParticipantIds', 'notifications'].map(field => ({
                    $or: [{ [field]: { $exists: false } }, { [field]: { $size: 0 } }]
                }))
            }, {
                $set: {
                    drawId,
                    drawDate,
                    drawDone: true,
                    drawParticipantIds: participants.map(participant => participant._id),
                    pairsGenerated: pairs.map(pair => ({ giverId: pair.giver._id, receiverId: pair.receiver._id })),
                    notifications: participants.map(participant => ({
                        participantId: participant._id,
                        recipientEmail: participant.email,
                        status: 'pending'
                    }))
                }
            }, {
                session,
                new: true,
                upsert: false,
                runValidators: true,
                projection: { _id: 0, drawId: 1, drawDate: 1 },
                maxTimeMS: 10000
            });

            if (!savedDraw) {
                throw new PartyOperationError(409,
                    'La fête ne permet plus la création du tirage. Actualisez son statut.', 'DRAW_ALREADY_EXISTS');
            }

            return { drawId: savedDraw.drawId, drawDate: savedDraw.drawDate, participantCount: participants.length };
        }, {
            operationId: drawId,
            verify: async () => Boolean(await findCommitted(Party,
                { _id: req.party._id, drawId, drawDone: true }, '_id'))
        });

        logger.info('Tirage officiel sauvegardé sans envoi d\'email.');
        return res.status(201).json({
            success: true,
            outcome: 'confirmed',
            message: 'Tirage sauvegardé. Aucun email n\'a été envoyé.',
            draw: prepared
        });
    } catch (error) {
        if (error instanceof TransactionResultUnknownError) {
            return res.status(error.status).json({ success: false, outcome: 'unknown', code: error.code,
                operationId: error.operationId, verificationRequired: true, retryable: false, message: error.message });
        }
        if (error instanceof PartyOperationError) {
            return res.status(error.status).json({ success: false, outcome: 'rejected', code: error.code, message: error.message });
        }
        // Un timeout reseau peut masquer une ecriture deja confirmee par MongoDB.
        // Ne jamais annuler/reinitialiser le tirage ni lancer d'envoi ici.
        logger.error('Erreur lors de la préparation du tirage.');
        return res.status(500).json({
            success: false,
            outcome: 'rejected',
            code: 'DRAW_PREPARATION_FAILED',
            message: 'La préparation du tirage a été refusée. Aucun nouveau tirage n\'a été enregistré.'
        });
    }
}

// V2.1 en cours : supprimer tout chemin vers l'ancien flux tirage + SMTP.
function sendDrawEmails(req, res) {
    return res.status(410).json({
        success: false,
        code: 'DRAW_SEND_DISABLED',
        message: 'L\'ancien envoi est désactivé. Utilisez la préparation du tirage ; aucun email ne sera envoyé.'
    });
}

/**
 * Obtenir le statut du tirage pour une partie
 * 
 * GET /api/parties/:code/draw/status
 */
async function getDrawStatus(req, res) {
    try {
        const { code } = req.params;

        logger.info(`📊 Demande du statut du tirage pour la partie`);

        // verifier que la partie existe
        const party = await Party.findOne({ code });
        if (!party) {
            logger.warn(`❌ Partie non trouvée`);
            return res.status(404).json({
                success: false,
                message: 'Partie non trouvée'
            });
        }

        // compter les participants
        const participantCount = await Participant.countDocuments({ partyId: party._id });
        const drawLocked = hasDrawState(party);

        res.status(200).json({
            success: true,
            status: {
                drawDone: party.drawDone,
                drawDate: party.drawDate,
                participantCount,
                drawLocked,
                canDraw: participantCount >= 2 && !drawLocked
            }
        });
    } catch (error) {
        logger.error(`❌ Erreur lors de la récupération du statut du tirage`);
        return res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de la récupération du statut du tirage'
        });
    }
}

module.exports = {
    prepareDraw,
    generateDrawPreview,
    sendDrawEmails,
    getDrawStatus
};
