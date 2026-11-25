const { randomUUID } = require('node:crypto');
const { Types } = require('mongoose');
const Participant = require('../models/Participant');
const Party = require('../models/Party');
const { isValidEmail, isValidName, MAX_WISH_LENGTH } = require('../utils/validators');
const logger = require('../../logs/logger');
const { withPartyTransaction, hasDrawState, PartyOperationError, TransactionResultUnknownError,
    findCommitted } = require('../utils/partyTransaction');

function normalizeParticipant(body, partial = false) {
    const { name, email, familyGroup, wishList } = body || {};
    const values = {};

    if (!partial || name !== undefined) {
        if (typeof name !== 'string' || !name.trim()) {
            throw new PartyOperationError(400, 'Le nom est obligatoire.');
        }
        values.name = name.trim().toUpperCase();
        if (!isValidName(values.name)) {
            throw new PartyOperationError(400, 'Le nom doit contenir uniquement des lettres, espaces, accents et traits d’union.');
        }
    }
    if (!partial || email !== undefined) {
        if (typeof email !== 'string' || !isValidEmail(email.trim())) {
            throw new PartyOperationError(400, 'L’adresse email n’est pas valide.');
        }
        values.email = email.trim().toLowerCase();
    }
    if (!partial || familyGroup !== undefined) {
        if (typeof familyGroup !== 'string' || !familyGroup.trim()) {
            throw new PartyOperationError(400, 'Le groupe familial est obligatoire.');
        }
        values.familyGroup = familyGroup.trim();
    }
    if (!partial || wishList !== undefined) {
        const wishes = wishList ?? [];
        if (!Array.isArray(wishes) || wishes.some(item => typeof item !== 'string')) {
            throw new PartyOperationError(400, 'La liste de souhaits doit être un tableau de textes.');
        }
        values.wishList = wishes.map(item => item.trim()).filter(Boolean).slice(0, 3);
        if (values.wishList.some(wish => wish.length > MAX_WISH_LENGTH)) {
            throw new PartyOperationError(400, `Chaque souhait est limité à ${MAX_WISH_LENGTH} caractères. Raccourcissez-le ou laissez le champ vide.`, 'WISH_TOO_LONG');
        }
    }
    if (partial && !Object.keys(values).length) {
        throw new PartyOperationError(400, 'Indiquez au moins un champ à modifier.');
    }
    return values;
}

function assertOpen(party) {
    if (hasDrawState(party)) {
        throw new PartyOperationError(403, 'Le tirage a déjà été enregistré. Les inscriptions sont clôturées.', 'DRAW_ALREADY_EXISTS');
    }
}

function assertFamily(party, familyGroup) {
    if (!party.families.includes(familyGroup)) throw new PartyOperationError(400, 'Choisissez une famille définie pour cette fête.');
}

async function assertUnique(partyId, name, email, session, exceptId) {
    const filter = { partyId, name, email };
    if (exceptId) filter._id = { $ne: exceptId };
    if (await Participant.findOne(filter).session(session)) {
        throw new PartyOperationError(409, 'Une inscription avec ce nom et cette adresse email existe déjà.');
    }
}

function participantResponse(participant, admin) {
    const { name, email, familyGroup } = participant;
    if (!admin) return { name, email, familyGroup };
    return { _id: participant._id, name, email, familyGroup, wishList: participant.wishList };
}

function mutationError(res, error, admin) {
    if (error instanceof TransactionResultUnknownError) {
        return res.status(error.status).json({ success: false, outcome: 'unknown', code: error.code,
            operationId: error.operationId, verificationRequired: true, retryable: false,
            message: 'Résultat de l’opération inconnu. Relisez les inscriptions avant toute nouvelle tentative.' });
    }
    if (error instanceof PartyOperationError) {
        return res.status(error.status).json({ success: false, outcome: 'rejected', code: error.code, message: error.message });
    }
    if (error.code === 11000) {
        return res.status(409).json({ success: false, outcome: 'rejected',
            message: 'Une inscription avec ce nom et cette adresse email existe déjà.' });
    }
    if (admin && error.name === 'ValidationError') {
        return res.status(400).json({ success: false, outcome: 'rejected',
            message: `Inscription invalide. Chaque souhait est limité à ${MAX_WISH_LENGTH} caractères.` });
    }
    logger.error('Erreur lors de la mise à jour des inscriptions.');
    return res.status(500).json({ success: false, outcome: 'rejected',
        message: 'La modification des inscriptions n’a pas été enregistrée.' });
}

async function addParticipant(req, res) {
    const admin = Boolean(req.party);
    try {
        const values = normalizeParticipant(req.body);
        // Stable entre retries du driver et vérification, sans recherche par email.
        const participantId = new Types.ObjectId();
        const filter = admin ? { _id: req.party._id } : { code: req.params.code };
        const participant = await withPartyTransaction(filter, async (party, session) => {
            assertOpen(party);
            assertFamily(party, values.familyGroup);
            const count = await Participant.countDocuments({ partyId: party._id }).session(session);
            if (count >= 100) throw new PartyOperationError(400, 'Limite de participants atteinte (100 maximum).');
            await assertUnique(party._id, values.name, values.email, session);
            const entry = new Participant({ _id: participantId, partyId: party._id, ...values });
            await entry.save({ session });
            return entry;
        }, {
            operationId: String(participantId),
            verify: async candidate => Boolean(await findCommitted(Participant,
                { _id: participantId, partyId: candidate.partyId }, '_id'))
        });

        return res.status(201).json({ success: true, outcome: 'confirmed', message: 'Inscription réussie ! 🎉',
            participant: participantResponse(participant, admin) });
    } catch (error) {
        return mutationError(res, error, admin);
    }
}

function mutateParticipant(remove) {
    return async (req, res) => {
        try {
            const { participantId } = req.params;
            if (!/^[a-f0-9]{24}$/i.test(participantId)) throw new PartyOperationError(400, 'Identifiant de participant invalide.');
            const changes = remove ? null : normalizeParticipant(req.body, true);

            const participant = await withPartyTransaction({ _id: req.party._id }, async (party, session) => {
                assertOpen(party);
                const filter = { _id: participantId, partyId: party._id };
                const entry = await Participant.findOne(filter).session(session);
                if (!entry) throw new PartyOperationError(404, 'Participant introuvable dans cette fête.');
                if (remove) {
                    await Participant.deleteOne(filter, { session });
                    return entry;
                }
                entry.set(changes);
                assertFamily(party, entry.familyGroup);
                await assertUnique(party._id, entry.name, entry.email, session, entry._id);
                await entry.save({ session });
                return entry;
            }, {
                // Un document absent ou des valeurs identiques ne prouvent pas
                // que cette opération précise a été validée.
                operationId: randomUUID()
            });

            return res.json({ success: true, outcome: 'confirmed',
                ...(remove ? { participantId: String(participant._id) } : { participant: participantResponse(participant, true) }) });
        } catch (error) {
            return mutationError(res, error, true);
        }
    };
}

const updateParticipant = mutateParticipant(false);
const deleteParticipant = mutateParticipant(true);

async function getParticipants(req, res) {
    const { code } = req.params;

    logger.info(`GET /api/participants/party`);

    try {
        const party = await Party.findOne({ code });

        if (!party) {
            logger.warn(`❌ Party non trouvée`);
            return res.status(404).json({
                success: false,
                message: 'Party non trouvée.'
            });
        }

        const participants = await Participant.find({ partyId: party._id })
            .select('name email familyGroup wishList')
            .sort({ createdAt: 1 });

        logger.info(`✅ ${participants.length} participants récupérés`);

        res.json({
            success: true,
            participants,
            count: participants.length
        });

    } catch (error) {
        logger.error(`❌ Erreur lors de la récupération des participants`);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur.'
        });
    }
}

module.exports = {
    addParticipant,
    updateParticipant,
    deleteParticipant,
    getParticipants
};
