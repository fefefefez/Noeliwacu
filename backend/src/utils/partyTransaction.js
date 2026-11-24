const Party = require('../models/Party');

class PartyOperationError extends Error {
    constructor(status, message, code) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

class TransactionResultUnknownError extends PartyOperationError {
    constructor(operationId) {
        super(503, 'Résultat de l\'opération inconnu. Vérifiez son état avant toute nouvelle tentative. Ne relancez pas automatiquement la création.',
            'TRANSACTION_RESULT_UNKNOWN');
        this.operationId = operationId;
    }
}

// Nouvelle lecture hors transaction : seul un resultat positif confirme le commit.
// Une absence peut preceder un commit encore en cours, donc ne prouve pas un refus.
function findCommitted(model, filter, projection) {
    // Ne pas ajouter le delai de buffering Mongoose au budget de lecture.
    if (model.collection.buffer) throw new Error('Connexion indisponible pour la vérification.');
    return model.findOne(filter).select(projection).session(null).read('primary')
        .readConcern('majority').setOptions({ timeoutMS: 5000, maxTimeMS: 5000 }).lean();
}

function hasDrawState(party) {
    return Boolean(party.drawDone) || party.drawDate != null || party.drawId != null ||
        [party.pairsGenerated, party.drawParticipantIds, party.notifications]
            .some(items => items != null && (!Array.isArray(items) || items.length > 0));
}

// Les deux chemins doivent passer ici AVANT toute lecture de Participant.
// Une vraie ecriture sur Party force un conflit entre transactions concurrentes.
// __v existe deja dans Mongoose ; aucune migration des anciennes fetes requise.
async function withPartyTransaction(filter, operation, { operationId, verify } = {}) {
    let callbackCompleted = false;
    let candidate;
    try {
        return await Party.db.transaction(async session => {
            // Le driver peut rejouer le callback apres un conflit confirme.
            callbackCompleted = false;
            candidate = undefined;
            const party = await Party.findOneAndUpdate(filter, { $inc: { __v: 1 } }, {
                session, new: true, upsert: false, maxTimeMS: 10000
            });
            if (!party) throw new PartyOperationError(404, 'Fête non trouvée.');
            // Aucun effet externe/reponse HTTP dans ce callback : il peut etre rejoue.
            candidate = await operation(party, session);
            callbackCompleted = true;
            return candidate;
        }, {
            readPreference: 'primary',
            readConcern: { level: 'snapshot' },
            writeConcern: { w: 'majority' },
            timeoutMS: 10000
        });
    } catch (error) {
        // Une erreur de selection/timeout pendant commit peut perdre le label
        // UnknownTransactionCommitResult. La phase completee reste determinante.
        if (!callbackCompleted && !error.hasErrorLabel?.('UnknownTransactionCommitResult')) throw error;
        if (callbackCompleted && verify) {
            try {
                if (await verify(candidate)) return candidate;
            } catch {
                // La verification est inaccessible : ne rien recreer, ne pas
                // transformer une confirmation inconnue en echec affirme.
            }
        }
        throw new TransactionResultUnknownError(operationId);
    }
}

module.exports = { withPartyTransaction, hasDrawState, PartyOperationError, TransactionResultUnknownError, findCommitted };
