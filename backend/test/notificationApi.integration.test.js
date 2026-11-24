// Tests API sur replica set temporaire local. Aucun .env, MONGODB_URI,
// credential SMTP, Heroku ou Atlas. Aucun module d'envoi n'est charge.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const express = require('express');
const http = require('node:http');

let memoryServer;
try { memoryServer = require('mongodb-memory-server-core'); }
catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    memoryServer = require(path.join(os.tmpdir(), 'noeliwacu-mongo-integration-deps/node_modules/mongodb-memory-server-core'));
}
const loggerPath = require.resolve('../logs/logger');
const previousLogger = require.cache[loggerPath];
require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true,
    exports: { info() {}, warn() {}, error() {} } };
const Party = require('../src/models/Party');
const Participant = require('../src/models/Participant');
const { hashPin } = require('../src/utils/helpers');
const { adminPinLimiter } = require('../src/middleware/rateLimit');
const routes = require('../src/routes/draw');
const { createNotificationController } = require('../src/controllers/notificationController');
const notifications = require('../src/services/notificationService');

let replSet;
let server;
let pinHash;
let dbName;
const statuses = ['pending', 'sending', 'accepted', 'failed', 'uncertain', 'simulated', 'expired'];

async function openServer() {
    const app = express();
    app.use(express.json());
    app.use('/api/parties', routes);
    return new Promise((resolve, reject) => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
        listener.on('error', reject);
    });
}
async function closeServer() {
    if (!server) return;
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    server = undefined;
}

// http.request evite la liste de ports interdits de Fetch sur un port local
// attribue aleatoirement. Aucun client HTTP externe n'est utilise.
function request({ pin = '1234', code = 'ADMIN21', method = 'GET', suffix = 'notifications' } = {}) {
    return new Promise((resolve, reject) => {
        const headers = {};
        if (pin !== null) headers['X-Admin-Pin'] = pin;
        const req = http.request({ hostname: '127.0.0.1', port: server.address().port,
            path: `/api/parties/${code}/draw/${suffix}`, method, headers }, res => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { text += chunk; });
            res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(text) }); } catch (error) { reject(error); } });
        });
        req.on('error', reject);
        req.end();
    });
}

test.before(async () => {
    assert.equal(mongoose.connection.readyState, 0);
    dbName = `noeliwacu_notification_api_${randomUUID().replaceAll('-', '')}`;
    replSet = await memoryServer.MongoMemoryReplSet.create({
        binary: { version: '7.0.24', downloadDir: path.join(os.tmpdir(), 'noeliwacu-mongo-integration-binaries') },
        replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' }
    });
    const uri = replSet.getUri(dbName);
    assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//);
    await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000 });
    await Promise.all([Party.init(), Participant.init()]);
    pinHash = await hashPin('1234');
    server = await openServer();
}, { timeout: 240000 });

test.beforeEach(async () => {
    assert.equal(mongoose.connection.name, dbName);
    await Participant.deleteMany({});
    await Party.deleteMany({});
    adminPinLimiter.resetKey('127.0.0.1');
});

test.after(async () => {
    try { await closeServer(); await mongoose.disconnect(); }
    finally { if (replSet) await replSet.stop(); }
    assert.equal(require.cache[require.resolve('../src/services/emailService')], undefined);
    assert.equal(require.cache[require.resolve('nodemailer')], undefined);
    if (previousLogger) require.cache[loggerPath] = previousLogger;
    else delete require.cache[loggerPath];
});

async function seed(selectedStatuses = statuses) {
    const partyId = new mongoose.Types.ObjectId();
    const people = await Participant.insertMany(selectedStatuses.map((status, i) => ({
        partyId, name: `DONNEUR ${i}`, email: 'shared@example.invalid', familyGroup: i % 2 ? 'A' : 'B',
        wishList: [`DO_NOT_EXPOSE_WISHLIST_${i}`]
    })));
    const at = new Date();
    const party = await Party.create({
        _id: partyId, code: 'ADMIN21', name: 'API locale', families: ['A', 'B'], adminPinHash: pinHash,
        drawDone: true, drawId: randomUUID(), drawDate: at, drawParticipantIds: people.map(person => person._id),
        pairsGenerated: people.map((giver, i) => ({ giverId: giver._id, receiverId: people[(i + 1) % people.length]._id })),
        notifications: people.map((giver, i) => {
            const state = selectedStatuses[i];
            const status = state === 'expired' ? 'sending' : state;
            const attemptId = `DO_NOT_EXPOSE_ATTEMPT_${i}`;
            return { participantId: giver._id, recipientEmail: giver.email, status,
                attemptCount: status === 'pending' ? 0 : 1,
                ...(status === 'pending' ? {} : { messageId: `<${attemptId}@noeliwacu.invalid>`, lastAttemptAt: at,
                    attempts: [{ attemptId, status, startedAt: at }] }),
                ...(status === 'sending' ? { leaseToken: attemptId,
                    leaseExpiresAt: new Date(at.getTime() + (state === 'expired' ? -60000 : 120000)) } : {}),
                ...(status === 'accepted' ? { acceptedAt: at } : {}),
                ...(['failed', 'uncertain'].includes(status) ? { lastError: { code: 'EAUTH', responseCode: 535,
                    message: 'DO_NOT_EXPOSE_PASSWORD shared@example.invalid', command: 'AUTH SECRET', retryable: true } } : {})
            };
        })
    });
    return { party, people };
}

function assertPrivate(body) {
    const serialized = JSON.stringify(body);
    for (const key of ['receiverId', 'giverId', 'pairsGenerated', 'drawId', 'drawParticipantIds', 'adminPinHash',
        'attempts', 'attemptId', 'messageId', 'leaseToken', 'leaseExpiresAt', 'wishList', 'response', 'stack', 'credentials']) {
        assert.equal(serialized.includes(`"${key}"`), false, key);
    }
    assert.equal(serialized.includes('DO_NOT_EXPOSE'), false);
    assert.equal(serialized.includes('SECRET'), false);
    assert.equal(serialized.includes(pinHash), false);
}

test('route POST officielle : PIN obligatoire puis simulation ciblee, sans SMTP ni fuite', async () => {
    const { people } = await seed(['pending', 'pending']);
    const suffix = `notifications/${people[0]._id}/send`;
    assert.equal((await request({ method: 'POST', suffix, pin: null })).status, 401);
    assert.equal((await request({ method: 'POST', suffix, pin: '9999' })).status, 403);
    const emailPath = require.resolve('../src/services/emailService');
    let calls = 0;
    require.cache[emailPath] = { id: emailPath, filename: emailPath, loaded: true, exports: {
        async sendSecretSantaEmail(giver, receiver, party, options) {
            calls++;
            assert.equal(String(receiver._id), String(people[1]._id));
            assert.ok(options.signal instanceof AbortSignal);
            return { participantId: String(giver._id), attemptId: options.attemptId,
                messageId: `<${options.attemptId}@noeliwacu.invalid>`, status: 'simulated' };
        }
    } };
    try {
        const response = await request({ method: 'POST', suffix });
        assert.equal(response.status, 200);
        assert.equal(response.body.status, 'simulated');
        assert.equal(response.body.accepted, false);
        assertPrivate(response.body);
        assert.equal((await request({ method: 'POST', suffix })).status, 409);
        assert.equal(calls, 1);
    } finally { delete require.cache[emailPath]; }
});

test('lecture PIN : compteurs persistants, donneurs, emails partages et erreurs expurgees', async () => {
    const { people } = await seed();
    const response = await request();
    assert.equal(response.status, 200);
    assert.equal(response.body.trackingAvailable, true);
    assert.deepEqual(response.body.counts, { total: 7, pending: 1, sending: 1, accepted: 1, failed: 1, uncertain: 2, simulated: 1 });
    assert.equal(response.body.reconciliationPending, false);
    assert.equal(response.body.notifications.length, 7);
    response.body.notifications.forEach((row, i) => {
        assert.deepEqual(Object.keys(row).sort(), ['participantId', 'giverName', 'recipientEmail', 'status',
            'attemptCount', 'lastAttemptAt', 'acceptedAt', 'lastError'].sort());
        assert.equal(row.participantId, String(people[i]._id));
        assert.equal(row.giverName, people[i].name);
        assert.equal(row.recipientEmail, 'shared@example.invalid');
    });
    assert.equal(response.body.notifications[3].lastError.retryable, true);
    assert.equal(response.body.notifications[4].lastError.retryable, false);
    assert.equal(response.body.notifications[5].acceptedAt, null);
    assert.equal(response.body.notifications[6].lastError.code, 'LEASE_EXPIRED');
    assertPrivate(response.body);
});

for (const [pin, expected] of [[null, 401], ['abc', 400], ['9999', 403]]) {
    test(`acces sans PIN valide refuse (${expected}) sans donnees privees`, async () => {
        await seed();
        const response = await request({ pin });
        assert.equal(response.status, expected);
        assert.equal(response.body.notifications, undefined);
        assert.equal(JSON.stringify(response.body).includes('shared@'), false);
        assertPrivate(response.body);
    });
}

test('fete absente : 404 ; limitation des tentatives presente', async () => {
    await seed();
    assert.equal((await request({ code: 'ABSENT' })).status, 404);
    adminPinLimiter.resetKey('127.0.0.1');
    for (let i = 0; i < 10; i++) assert.equal((await request({ pin: null })).status, 401);
    assert.equal((await request({ pin: null })).status, 429);
});

test('les lectures admin reussies ne consomment pas le quota de PIN incorrects', async () => {
    await seed(['pending', 'pending']);
    for (let i = 0; i < 12; i++) assert.equal((await request()).status, 200);
});

test('reouverture apres redemarrage HTTP : etats MongoDB conserves, aucun envoi', async () => {
    await seed();
    const initial = await request();
    await closeServer();
    server = await openServer();
    const reopened = await request();
    assert.deepEqual(reopened.body, initial.body);
    assertPrivate(reopened.body);
});

for (const drawDone of [false, true]) {
    test(`fete sans suivi V2.1 (drawDone=${drawDone}) : aucun compteur invente`, async () => {
        const party = await Party.create({ code: 'ADMIN21', name: 'Historique', families: ['A', 'B'], adminPinHash: pinHash, drawDone });
        const before = await Party.findById(party._id).lean();
        const response = await request();
        assert.equal(response.status, 200);
        assert.equal(response.body.trackingAvailable, false);
        assert.equal(response.body.counts, null);
        assert.deepEqual(response.body.notifications, []);
        assert.deepEqual(await Party.findById(party._id).lean(), before);
    });
}

test('suivi incomplet : refus explicite plutot que compteurs trompeurs', async () => {
    const { party } = await seed();
    await Party.collection.updateOne({ _id: party._id }, { $pop: { notifications: 1 } });
    const response = await request();
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'NOTIFICATION_DATA_INCONSISTENT');
    assertPrivate(response.body);
});

test('erreur de stockage : reponse expurgee et aucun declenchement SMTP', async t => {
    const { party } = await seed();
    const controller = createNotificationController({ notifications: { ...notifications,
        async expireReservations() { throw new Error('DO_NOT_EXPOSE_PASSWORD'); } } });
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await controller.getNotificationStatus({ party }, res);
    assert.equal(res.code, 503);
    assert.equal(res.body.code, 'NOTIFICATION_STATUS_UNAVAILABLE');
    assertPrivate(res.body);
});

test('ancien draw/send reste desactive et aucune attribution ne change a la lecture', async () => {
    const { party } = await seed(['pending', 'pending']);
    const before = await Party.findById(party._id).lean();
    assert.equal((await request({ suffix: 'send', method: 'POST' })).status, 410);
    assert.equal((await request()).status, 200);
    assert.deepEqual(await Party.findById(party._id).lean(), before);
});

test('reconciliation bornee : progression explicite entre deux lectures, jamais de renvoi', async () => {
    const { party } = await seed(Array(25).fill('expired'));
    const immutable = await Party.findById(party._id).select('-notifications').lean();
    const first = await request();
    assert.equal(first.status, 200);
    assert.equal(first.body.counts.total, 25);
    assert.equal(first.body.counts.uncertain, 20);
    assert.equal(first.body.counts.sending, 5);
    assert.equal(first.body.reconciliationPending, true);
    const next = await request();
    assert.equal(next.body.counts.uncertain, 25);
    assert.equal(next.body.counts.sending, 0);
    assert.equal(next.body.reconciliationPending, false);
    assert.deepEqual(await Party.findById(party._id).select('-notifications').lean(), immutable);
    assertPrivate(next.body);
});
