const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { Types } = require('mongoose');
const Party = require('../models/Party');

const finalStatuses = new Set(['accepted', 'failed', 'uncertain', 'simulated']);
const errorCodes = new Set(['EAUTH', 'EENVELOPE', 'EMESSAGE', 'ETIMEDOUT', 'ECONNECTION', 'ESOCKET',
    'ECONNRESET', 'ECONNREFUSED', 'EDNS', 'ENOTFOUND', 'EAI_AGAIN', 'ESTREAM', 'EPROTOCOL', 'ETLS',
    'ECONFIG', 'EINPUT', 'ESHUTDOWN', 'ESMTPRESULT', 'SMTP_ERROR', 'LEASE_EXPIRED', 'EABORT']);
const commands = new Set(['AUTH', 'MAIL FROM', 'RCPT TO', 'EHLO', 'HELO', 'STARTTLS', 'DATA', 'CONN', 'API']);
const opaqueId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const messageIdFor = attemptId => `<${attemptId}@noeliwacu.invalid>`;

class NotificationPersistenceError extends Error {
    constructor(operation, attemptId) {
        super('Le résultat du stockage des notifications doit être vérifié. Aucun envoi ne doit être déclenché sur cette erreur.');
        this.code = 'NOTIFICATION_STORAGE_UNCONFIRMED';
        this.operation = operation;
        this.attemptId = attemptId;
        this.retryable = false;
    }
}

function objectId(value) {
    if (value instanceof Types.ObjectId) return value;
    if (typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value)) return new Types.ObjectId(value);
    throw new TypeError('Identifiant MongoDB invalide.');
}

function scope({ partyId, drawId }) {
    if (typeof drawId !== 'string' || !drawId.trim()) throw new TypeError('Identifiant du tirage requis.');
    return { _id: objectId(partyId), drawId, drawDone: true };
}

function technicalError(error, status) {
    const code = errorCodes.has(error?.code) ? error.code : 'SMTP_ERROR';
    return {
        code,
        message: code === 'LEASE_EXPIRED' ? 'Réservation expirée : transmission potentiellement commencée.' :
            status === 'failed' ? 'Échec confirmé de la tentative SMTP.' : 'Transmission SMTP non confirmée.',
        ...(commands.has(error?.command) ? { command: error.command } : {}),
        ...(Number.isInteger(error?.responseCode) && error.responseCode >= 400 && error.responseCode <= 599
            ? { responseCode: error.responseCode } : {}),
        retryable: status === 'failed' && error?.retryable === true
    };
}

/**
 * Service interne, sans SMTP, timer ou boucle permanente. Les futures routes
 * administrateur devront authentifier l'appelant. null = aucune transition,
 * jamais une autorisation d'envoyer. Une erreur de stockage ne doit pas conduire
 * a recreer une reservation : relire l'etat et attendre l'expiration si besoin.
 */
function createNotificationService({ PartyModel = Party, now = () => new Date(), newAttemptId = randomUUID } = {}) {
    function timestamp() {
        const value = now();
        if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError('Horloge invalide.');
        return new Date(value);
    }

    function ready() {
        if (PartyModel.collection.buffer) throw new NotificationPersistenceError('connection');
    }

    async function update(filter, changes, arrayFilters, operation, attemptId, timeoutMS = 5000) {
        try {
            ready();
            return await PartyModel.findOneAndUpdate(filter, changes, {
                arrayFilters, new: true, upsert: false, runValidators: true,
                writeConcern: { w: 'majority' }, timeoutMS, maxTimeMS: timeoutMS,
                projection: { _id: 0, drawId: 1, notifications: 1 }
            }).lean();
        } catch {
            // Pas d'erreur MongoDB brute (elle peut contenir un payload prive).
            throw new NotificationPersistenceError(operation, attemptId);
        }
    }

    async function getNotifications(target) {
        const filter = scope(target);
        try {
            ready();
            return await PartyModel.findOne(filter).select('-_id drawId notifications')
                .session(null).read('primary').readConcern('majority')
                .setOptions({ timeoutMS: 5000, maxTimeMS: 5000 }).lean();
        } catch {
            throw new NotificationPersistenceError('read');
        }
    }

    async function reserveNotification(target) {
        const filter = scope(target);
        const participantId = objectId(target.participantId);
        const leaseDurationMs = target.leaseDurationMs ?? 120000;
        if (!Number.isInteger(leaseDurationMs) || leaseDurationMs < 1000 || leaseDurationMs > 300000) {
            throw new TypeError('La réservation doit durer entre 1 et 300 secondes.');
        }
        const attemptId = newAttemptId();
        if (!opaqueId(attemptId)) throw new TypeError('Identifiant de tentative invalide.');
        const at = timestamp();
        const expiresAt = new Date(at.getTime() + leaseDurationMs);
        const eligible = {
            participantId, status: 'pending',
            $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: at } }]
        };
        // L'echeance est verifiee dans le $elemMatch atomique. Eviter un $or
        // dans arrayFilters : Mongoose 8.24.4 le caste comme un sous-document.
        const document = await update({
            ...filter, drawParticipantIds: participantId,
            notifications: { $elemMatch: eligible },
            // Unicite de la tentative dans toute la fete, meme si un generateur
            // defectueux reutilise un identifiant apres redemarrage.
            'notifications.attempts.attemptId': { $ne: attemptId }
        }, {
            $set: {
                'notifications.$[n].status': 'sending',
                'notifications.$[n].leaseToken': attemptId,
                'notifications.$[n].leaseExpiresAt': expiresAt,
                'notifications.$[n].lastAttemptAt': at,
                'notifications.$[n].messageId': messageIdFor(attemptId)
            },
            $inc: { 'notifications.$[n].attemptCount': 1 },
            $push: { 'notifications.$[n].attempts': {
                attemptId, status: 'sending', startedAt: at, messageId: messageIdFor(attemptId)
            } },
            $unset: { 'notifications.$[n].nextAttemptAt': '', 'notifications.$[n].lastError': '', 'notifications.$[n].acceptedAt': '' }
        }, [{ 'n.participantId': participantId, 'n.status': 'pending' }], 'reserve', attemptId);
        if (!document) return null;
        const notification = document.notifications.find(item => String(item.participantId) === String(participantId));
        return { drawId: document.drawId, participantId: String(participantId), attemptId,
            messageId: notification.messageId, recipientEmail: notification.recipientEmail,
            startedAt: notification.lastAttemptAt, leaseExpiresAt: notification.leaseExpiresAt, status: notification.status };
    }

    async function complete(target, status, error, at, expired = false, timeoutMS = 5000) {
        const filter = scope(target);
        const participantId = objectId(target.participantId);
        const { attemptId } = target;
        if (!opaqueId(attemptId)) throw new TypeError('Identifiant de tentative requis.');
        const lease = expired ? { $lte: at } : { $gt: at };
        const active = { participantId, status: 'sending', leaseToken: attemptId, leaseExpiresAt: lease,
            attempts: { $elemMatch: { attemptId, status: 'sending' } } };
        const set = {
            'notifications.$[n].status': status,
            'notifications.$[n].attempts.$[a].status': status,
            'notifications.$[n].attempts.$[a].completedAt': at
        };
        const unset = { 'notifications.$[n].leaseToken': '', 'notifications.$[n].leaseExpiresAt': '',
            'notifications.$[n].nextAttemptAt': '' };
        if (status === 'accepted') set['notifications.$[n].acceptedAt'] = at;
        else unset['notifications.$[n].acceptedAt'] = '';
        if (status === 'failed' || status === 'uncertain') {
            set['notifications.$[n].lastError'] = technicalError(error, status);
            set['notifications.$[n].attempts.$[a].error'] = technicalError(error, status);
        } else unset['notifications.$[n].lastError'] = '';
        const document = await update({ ...filter, notifications: { $elemMatch: active } }, {
            $set: set, $unset: unset
        }, [
            { 'n.participantId': participantId, 'n.status': 'sending', 'n.leaseToken': attemptId, 'n.leaseExpiresAt': lease },
            { 'a.attemptId': attemptId, 'a.status': 'sending' }
        ], expired ? 'expire' : 'complete', attemptId, timeoutMS);
        return document ? document.notifications.find(item => String(item.participantId) === String(participantId)) : null;
    }

    async function recordResult(target) {
        scope(target);
        const participantId = objectId(target.participantId);
        const result = target.result;
        if (!opaqueId(target.attemptId) || !finalStatuses.has(result?.status) ||
            result.attemptId !== target.attemptId || result.participantId !== String(participantId) ||
            result.messageId !== messageIdFor(target.attemptId)) {
            throw new TypeError('Le résultat doit correspondre exactement à la tentative et au participant réservés.');
        }
        return complete(target, result.status, result.error, timestamp());
    }

    async function expireReservations(target) {
        const limit = target.limit ?? 5;
        if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new TypeError('Limite entre 1 et 20 requise.');
        const deadline = performance.now() + 5000;
        const at = timestamp();
        const snapshot = await getNotifications(target);
        const expired = (snapshot?.notifications ?? []).filter(item => item.status === 'sending' &&
            item.leaseToken && item.leaseExpiresAt instanceof Date && item.leaseExpiresAt <= at);
        let count = 0;
        let examined = 0;
        for (const notification of expired.slice(0, limit)) {
            const remaining = Math.floor(deadline - performance.now());
            if (remaining <= 0) break;
            examined++;
            if (await complete({ ...target, participantId: notification.participantId, attemptId: notification.leaseToken },
                'uncertain', { code: 'LEASE_EXPIRED' }, at, true, remaining)) count++;
        }
        return { expired: count, examined, hasMore: expired.length > examined };
    }

    // Action explicite uniquement : les futures routes devront verifier le PIN.
    // uncertain et accepted sont intentionnellement exclus de cette API.
    async function requeueNotification(target) {
        const filter = scope(target);
        const participantId = objectId(target.participantId);
        if (target.confirmed !== true || !['failed', 'simulated'].includes(target.expectedStatus) || !opaqueId(target.expectedAttemptId)) {
            throw new TypeError('Reprise explicite limitée à failed/simulated avec la dernière tentative attendue.');
        }
        const active = { participantId, status: target.expectedStatus, messageId: messageIdFor(target.expectedAttemptId),
            attempts: { $elemMatch: { attemptId: target.expectedAttemptId, status: target.expectedStatus } } };
        const document = await update({ ...filter, notifications: { $elemMatch: active } }, {
            $set: { 'notifications.$[n].status': 'pending' },
            $unset: { 'notifications.$[n].leaseToken': '', 'notifications.$[n].leaseExpiresAt': '',
                'notifications.$[n].nextAttemptAt': '', 'notifications.$[n].lastError': '', 'notifications.$[n].acceptedAt': '' }
        }, [{ 'n.participantId': participantId, 'n.status': target.expectedStatus,
            'n.messageId': messageIdFor(target.expectedAttemptId) }], 'requeue', target.expectedAttemptId);
        return document ? document.notifications.find(item => String(item.participantId) === String(participantId)) : null;
    }

    return { reserveNotification, recordResult, expireReservations, requeueNotification, getNotifications };
}

const service = createNotificationService();
module.exports = { ...service, createNotificationService, NotificationPersistenceError };
