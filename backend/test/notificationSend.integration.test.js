// Vrais MongoDB/Express/modeles ; SMTP injecte, aucune configuration reelle lue.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const mongoose = require('mongoose');
const express = require('express');
let memoryServer;
try { memoryServer = require('mongodb-memory-server-core'); }
catch { memoryServer = require(path.join(os.tmpdir(), 'noeliwacu-mongo-integration-deps/node_modules/mongodb-memory-server-core')); }
const loggerPath = require.resolve('../logs/logger');
require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true,
    exports: { info() {}, warn() {}, error() {} } };
const Party = require('../src/models/Party');
const Participant = require('../src/models/Participant');
const notifications = require('../src/services/notificationService');
const { createNotificationController } = require('../src/controllers/notificationController');
const { createNotificationBudget } = require('../src/middleware/notificationBudget');
const { verifyAdminPin } = require('../src/middleware/auth');
const { adminPinLimiter } = require('../src/middleware/rateLimit');
const { hashPin } = require('../src/utils/helpers');

let replSet, server, pinHash, dbName;
let calls, smtpStatus, sendHook, recordHook, reserveHook;
let smtpBudgetMs = 15000;
let requestBudgetMs = 24000;
async function openServer() {
    const controller = createNotificationController({ smtpBudgetMs,
        notifications: { ...notifications,
            reserveNotification: target => reserveHook ? reserveHook(target) : notifications.reserveNotification(target),
            recordResult: target => recordHook ? recordHook(target) : notifications.recordResult(target) },
        sendEmail: async (giver, receiver, party, options) => {
            // La reservation doit etre reellement persistee AVANT SMTP.
            const stored = await Party.findById(party._id).lean();
            const entry = stored.notifications.find(n => String(n.participantId) === String(giver._id));
            assert.equal(entry.status, 'sending');
            assert.equal(entry.leaseToken, options.attemptId);
            calls.push({ giver, receiver, options });
            if (sendHook) await sendHook(options.signal);
            const status = options.signal.aborted ? 'uncertain' : smtpStatus;
            return { participantId: String(giver._id), attemptId: options.attemptId,
                messageId: `<${options.attemptId}@noeliwacu.invalid>`, status,
                ...(['failed', 'uncertain'].includes(status) ? { error: { code: options.signal.aborted ? 'EABORT' : 'ESOCKET',
                    message: 'PRIVATE_ERROR', retryable: false } } : {}) };
        }
    });
    const app = express();
    app.post('/api/parties/:code/draw/notifications/:participantId/send',
        createNotificationBudget({ requestBudgetMs }), adminPinLimiter, verifyAdminPin, controller.sendNotification);
    app.get('/api/parties/:code/draw/notifications', adminPinLimiter, verifyAdminPin, controller.getNotificationStatus);
    return new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
}
async function closeServer() {
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    server = undefined;
}
function request(id, { pin = '1234', method = 'POST' } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port: server.address().port,
            path: `/api/parties/SEND21/draw/notifications${id ? `/${id}/send` : ''}`, method,
            headers: pin === null ? {} : { 'X-Admin-Pin': pin } }, res => {
            let body = '';
            res.on('data', part => { body += part; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    for (const key of ['receiverId', 'pairsGenerated', 'drawId', 'wishList', 'attemptId', 'leaseToken', 'messageId', 'adminPinHash']) {
                        assert.equal(body.includes(`"${key}"`), false, key);
                    }
                    assert.equal(body.includes('PRIVATE_'), false);
                    resolve({ status: res.statusCode, body: parsed });
                } catch (error) { reject(error); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}
async function seed() {
    const partyId = new mongoose.Types.ObjectId();
    const people = await Participant.insertMany([0, 1].map(i => ({ partyId, name: `Donneur ${i}`,
        email: 'shared@example.invalid', familyGroup: 'A', wishList: ['PRIVATE_WISHLIST'] })));
    const party = await Party.create({ _id: partyId, code: 'SEND21', name: 'Test local', families: ['A'], adminPinHash: pinHash,
        drawDone: true, drawId: randomUUID(), drawDate: new Date(), drawParticipantIds: people.map(p => p._id),
        pairsGenerated: people.map((giver, i) => ({ giverId: giver._id, receiverId: people[1 - i]._id })),
        notifications: people.map(p => ({ participantId: p._id, recipientEmail: p.email, status: 'pending' })) });
    return { party, people, id: String(people[0]._id) };
}
test.before(async () => {
    dbName = `noeliwacu_send_${randomUUID().replaceAll('-', '')}`;
    replSet = await memoryServer.MongoMemoryReplSet.create({
        binary: { version: '7.0.24', downloadDir: path.join(os.tmpdir(), 'noeliwacu-mongo-integration-binaries') },
        replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
    const uri = replSet.getUri(dbName);
    assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//);
    await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000 });
    await Promise.all([Party.init(), Participant.init()]);
    pinHash = await hashPin('1234');
}, { timeout: 240000 });
test.beforeEach(async () => {
    await Participant.deleteMany({}); await Party.deleteMany({});
    adminPinLimiter.resetKey('127.0.0.1');
    calls = []; smtpStatus = 'accepted'; sendHook = recordHook = reserveHook = undefined;
    smtpBudgetMs = 15000; requestBudgetMs = 24000;
    server = await openServer();
});
test.afterEach(closeServer);
test.after(async () => {
    await mongoose.disconnect(); if (replSet) await replSet.stop();
    assert.equal(require.cache[require.resolve('../src/services/emailService')], undefined);
});

for (const status of ['accepted', 'failed', 'uncertain', 'simulated']) {
    test(`envoi cible : ${status}, tentative conservee et aucune attribution exposee`, async () => {
        const { party, id } = await seed(); smtpStatus = status;
        const before = await Party.findById(party._id).lean();
        const response = await request(id);
        assert.equal(response.status, 200);
        assert.equal(response.body.status, status);
        assert.equal(response.body.accepted, status === 'accepted');
        assert.equal(response.body.simulated, status === 'simulated');
        const after = await Party.findById(party._id).lean();
        assert.deepEqual(after.pairsGenerated, before.pairsGenerated);
        assert.deepEqual(after.drawParticipantIds, before.drawParticipantIds);
        assert.equal(after.drawId, before.drawId);
        assert.equal(after.notifications[0].attemptCount, 1);
        assert.equal(after.notifications[0].attempts[0].status, status);
        assert.equal((await request(id)).status, 409);
        assert.equal(calls.length, 1);
    });
}
test('deux demandes concurrentes pour le meme participant : un seul SMTP', async () => {
    const { id } = await seed(); sendHook = () => delay(100);
    const responses = await Promise.all([request(id), request(id)]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    assert.equal(calls.length, 1);
});
test('deux participants et adresse partagee : deux tentatives distinctes', async () => {
    const { people } = await seed();
    assert.ok((await Promise.all(people.map(p => request(String(p._id))))).every(r => r.status === 200));
    assert.equal(calls.length, 2);
    assert.equal(calls[0].giver.email, calls[1].giver.email);
    assert.notEqual(calls[0].options.attemptId, calls[1].options.attemptId);
});
test('PIN absent ou incorrect : aucun SMTP et aucune reservation', async () => {
    const { party, id } = await seed();
    assert.equal((await request(id, { pin: null })).status, 401);
    assert.equal((await request(id, { pin: '9999' })).status, 403);
    assert.equal(calls.length, 0);
    assert.equal((await Party.findById(party._id)).notifications[0].attemptCount, 0);
});
test('confirmation de reservation perdue : aucun appel SMTP', async () => {
    const { id } = await seed();
    reserveHook = async target => { await notifications.reserveNotification(target); throw new Error('PRIVATE_MONGO'); };
    const response = await request(id);
    assert.equal(response.status, 503);
    assert.equal(response.body.verificationRequired, true);
    assert.equal(calls.length, 0);
});
for (const committed of [false, true]) {
    test(`acceptation SMTP puis confirmation MongoDB perdue, commit=${committed}`, async () => {
        const { party, id } = await seed();
        recordHook = async target => {
            if (committed) await notifications.recordResult(target);
            throw new Error('PRIVATE_MONGO');
        };
        const response = await request(id);
        assert.equal(response.status, 503);
        assert.equal(response.body.smtpStatus, 'accepted');
        assert.equal(response.body.retryable, false);
        recordHook = undefined;
        await closeServer(); server = await openServer();
        let state = await request(null, { method: 'GET' });
        assert.equal(state.body.notifications[0].status, committed ? 'accepted' : 'sending');
        if (!committed) {
            await Party.updateOne({ _id: party._id }, { $set: { 'notifications.0.leaseExpiresAt': new Date(0) } });
            state = await request(null, { method: 'GET' });
            assert.equal(state.body.notifications[0].status, 'uncertain');
        }
        assert.equal((await request(id)).status, 409);
        assert.equal(calls.length, 1);
    });
}
test('budget SMTP : signal reel transmis et resultat EABORT conserve uncertain', async () => {
    await closeServer(); smtpBudgetMs = 50; server = await openServer();
    const { id } = await seed();
    sendHook = signal => new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    const response = await request(id);
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'uncertain');
    assert.equal(response.body.lastError.code, 'EABORT');
    assert.equal(calls.length, 1);
});
test('authentification tardive : deadline HTTP et aucun SMTP apres reponse', async () => {
    await closeServer(); requestBudgetMs = 10; server = await openServer();
    const { id } = await seed();
    const response = await request(id);
    assert.equal(response.status, 503);
    assert.equal(response.body.code, 'NOTIFICATION_REQUEST_DEADLINE');
    await delay(150);
    assert.equal(calls.length, 0);
});
test('reservation confirmee trop tard : absence de SMTP et aucun envoi detache', async () => {
    await closeServer(); requestBudgetMs = 11500; server = await openServer();
    const { id } = await seed();
    reserveHook = async target => {
        const result = await notifications.reserveNotification(target);
        await delay(6100);
        return result;
    };
    const response = await request(id);
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'failed');
    assert.equal(calls.length, 0);
});

test('deconnexion HTTP pendant SMTP : annulation et uncertain persiste sans second envoi', async () => {
    const { party, id } = await seed();
    sendHook = signal => new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port,
        path: `/api/parties/SEND21/draw/notifications/${id}/send`, method: 'POST', headers: { 'X-Admin-Pin': '1234' } });
    req.on('error', () => {});
    req.end();
    for (let i = 0; i < 200 && !calls.length; i++) await delay(10);
    assert.equal(calls.length, 1);
    req.destroy();
    let status;
    for (let i = 0; i < 100; i++) {
        status = (await Party.findById(party._id).lean()).notifications[0].status;
        if (status === 'uncertain') break;
        await delay(10);
    }
    assert.equal(status, 'uncertain');
    assert.equal((await request(id)).status, 409);
    assert.equal(calls.length, 1);
});
