const Participant = require('../models/Participant');
const notificationService = require('../services/notificationService');

const statuses = ['pending', 'sending', 'accepted', 'failed', 'uncertain', 'simulated'];
const safeCodes = new Set(['EAUTH', 'EENVELOPE', 'EMESSAGE', 'ETIMEDOUT', 'ECONNECTION', 'ESOCKET',
    'ECONNRESET', 'ECONNREFUSED', 'EDNS', 'ENOTFOUND', 'EAI_AGAIN', 'ESTREAM', 'EPROTOCOL', 'ETLS',
    'ECONFIG', 'EINPUT', 'ESHUTDOWN', 'ESMTPRESULT', 'SMTP_ERROR', 'LEASE_EXPIRED', 'EABORT']);
const safeCommands = new Set(['AUTH', 'MAIL FROM', 'RCPT TO', 'EHLO', 'HELO', 'STARTTLS', 'DATA', 'CONN', 'API']);
const publicDate = value => value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;

function publicError(error, status) {
    if (!error || !['failed', 'uncertain'].includes(status)) return null;
    const code = safeCodes.has(error.code) ? error.code : 'SMTP_ERROR';
    return {
        code,
        message: code === 'LEASE_EXPIRED' ? 'Réservation expirée : résultat de transmission inconnu.' :
            status === 'failed' ? 'Échec confirmé de la tentative SMTP.' : 'Transmission SMTP non confirmée.',
        retryable: status === 'failed' && error.retryable === true,
        ...(safeCommands.has(error.command) ? { command: error.command } : {}),
        ...(Number.isInteger(error.responseCode) && error.responseCode >= 400 && error.responseCode <= 599
            ? { responseCode: error.responseCode } : {})
    };
}

function createNotificationController({ notifications = notificationService, ParticipantModel = Participant,
    sendEmail = (...args) => require('../services/emailService').sendSecretSantaEmail(...args), smtpBudgetMs = 15000 } = {}) {
    async function sendNotification(req, res) {
        const reply = (status, body) => { if (!res.headersSent && !res.destroyed) res.status(status).json(body); };
        const budget = req.notificationBudget;
        if (!budget) return reply(503, { success: false, code: 'NOTIFICATION_BUDGET_REQUIRED' });
        if (budget.signal.aborted) return;
        let reservation;
        let result;
        try {
            const party = req.party;
            const { participantId } = req.params;
            if (!/^[a-f0-9]{24}$/i.test(participantId ?? '')) {
                return reply(400, { success: false, code: 'INVALID_PARTICIPANT' });
            }
            if (!party.drawDone || !party.drawId) {
                return reply(409, { success: false, code: 'DRAW_NOT_PREPARED' });
            }
            // Exclusivement les attributions definitives. Aucun algorithme de tirage ici.
            const pairs = party.pairsGenerated.filter(pair => String(pair.giverId) === participantId);
            if (pairs.length !== 1 || String(pairs[0].receiverId) === participantId ||
                !party.drawParticipantIds.some(id => String(id) === participantId) ||
                !party.drawParticipantIds.some(id => String(id) === String(pairs[0].receiverId))) {
                return reply(409, { success: false, code: 'NOTIFICATION_DATA_INCONSISTENT' });
            }
            const target = { partyId: party._id, drawId: party.drawId, participantId };
            await notifications.expireReservations({ ...target, limit: 20 });
            if (budget.signal.aborted) return;
            const people = await ParticipantModel.find({ partyId: party._id,
                _id: { $in: [participantId, pairs[0].receiverId] } })
                .select('_id name wishList').setOptions({ timeoutMS: 5000, maxTimeMS: 5000 }).lean();
            const giver = people.find(person => String(person._id) === participantId);
            const receiver = people.find(person => String(person._id) === String(pairs[0].receiverId));
            if (!giver || !receiver) return reply(409, { success: false, code: 'NOTIFICATION_DATA_INCONSISTENT' });
            // Garder 5 s pour la reservation et 5 s pour la confirmation finale.
            if (budget.remaining() < 11000 || budget.signal.aborted) {
                return reply(503, { success: false, code: 'NOTIFICATION_BUDGET_EXHAUSTED', smtpInvoked: false });
            }
            reservation = await notifications.reserveNotification(target);
            if (!reservation) return reply(409, { success: false, code: 'NOTIFICATION_NOT_PENDING' });
            // Une confirmation recue trop tard ne doit jamais declencher SMTP.
            if (budget.signal.aborted || budget.remaining() <= 5500) {
                result = { ...reservation, status: 'failed', error: { code: 'EABORT', retryable: false } };
            } else {
                const controller = new AbortController();
                const abort = () => controller.abort();
                budget.signal.addEventListener('abort', abort, { once: true });
                const timer = setTimeout(abort, Math.min(smtpBudgetMs, budget.remaining() - 5500));
                try {
                    result = await sendEmail({ ...giver, email: reservation.recipientEmail }, receiver, party,
                        { attemptId: reservation.attemptId, signal: controller.signal });
                } finally {
                    clearTimeout(timer);
                    budget.signal.removeEventListener('abort', abort);
                }
            }
            const stored = await notifications.recordResult({ ...target, attemptId: reservation.attemptId, result });
            if (!stored) throw new Error('Unconfirmed');
            return reply(200, { success: true, participantId, status: stored.status,
                accepted: stored.status === 'accepted', simulated: stored.status === 'simulated',
                lastError: publicError(stored.lastError, stored.status) });
        } catch {
            // Ni nouvelle reservation, ni nouvel appel SMTP, meme si le commit a reussi.
            return reply(503, { success: false, code: 'NOTIFICATION_RESULT_UNCONFIRMED',
                verificationRequired: true, retryable: false,
                ...(result ? { smtpStatus: result.status } : {}),
                message: 'Le résultat doit être vérifié dans le suivi des notifications. Ne relancez pas cet envoi.' });
        }
    }
    async function getNotificationStatus(req, res) {
        try {
            const party = req.party; // Authentifie par verifyAdminPin, jamais serialise.
            if (!party.drawDone || !party.drawId) {
                return res.status(200).json({ success: true, trackingAvailable: false,
                    code: party.drawDone ? 'LEGACY_DRAW_UNTRACKED' : 'DRAW_NOT_PREPARED', counts: null, notifications: [] });
            }
            const target = { partyId: party._id, drawId: party.drawId };
            const reconciliation = await notifications.expireReservations({ ...target, limit: 20 });
            const snapshot = await notifications.getNotifications(target);
            const expected = new Set((party.drawParticipantIds ?? []).map(String));
            const entries = snapshot?.notifications;
            if (!Array.isArray(entries) || !expected.size || entries.length !== expected.size ||
                new Set(entries.map(item => String(item.participantId))).size !== entries.length ||
                entries.some(item => !expected.has(String(item.participantId)) || !statuses.includes(item.status) ||
                    !Number.isInteger(item.attemptCount) || item.attemptCount < 0 || typeof item.recipientEmail !== 'string')) {
                return res.status(409).json({ success: false, code: 'NOTIFICATION_DATA_INCONSISTENT',
                    message: 'Le suivi des notifications est incomplet ou incohérent. Aucun envoi n\'a été déclenché.' });
            }
            const participants = await ParticipantModel.find({ partyId: party._id,
                _id: { $in: entries.map(item => item.participantId) } }).select('_id name')
                .setOptions({ timeoutMS: 5000, maxTimeMS: 5000 }).lean();
            const names = new Map(participants.map(person => [String(person._id), person.name]));
            const counts = Object.fromEntries(statuses.map(status => [status, 0]));
            const rows = entries.map(item => {
                counts[item.status]++;
                // Liste blanche stricte : aucune paire, receiverId, wishlist,
                // tentative, messageId, leaseToken ou erreur SMTP brute.
                const name = names.get(String(item.participantId));
                return { participantId: String(item.participantId), giverName: typeof name === 'string' ? name : null,
                    recipientEmail: item.recipientEmail, status: item.status, attemptCount: item.attemptCount,
                    lastAttemptAt: publicDate(item.lastAttemptAt), acceptedAt: item.status === 'accepted' ? publicDate(item.acceptedAt) : null,
                    lastError: publicError(item.lastError, item.status) };
            });
            return res.status(200).json({ success: true, trackingAvailable: true,
                counts: { total: rows.length, ...counts }, notifications: rows,
                reconciliationPending: reconciliation.hasMore === true });
        } catch {
            return res.status(503).json({ success: false, code: 'NOTIFICATION_STATUS_UNAVAILABLE',
                message: 'Le suivi des notifications ne peut pas être confirmé. Actualisez son état. Aucun envoi n\'a été déclenché.' });
        }
    }
    return { getNotificationStatus, sendNotification };
}

module.exports = { ...createNotificationController(), createNotificationController };
