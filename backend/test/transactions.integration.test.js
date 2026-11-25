// Tests exclusivement locaux. Aucun .env, server.js ou MONGODB_URI n'est lu.
// Dependances de test (PowerShell, hors sandbox) :
// npm install --prefix "$env:TEMP/noeliwacu-mongo-integration-deps" --no-save --package-lock=false --ignore-scripts mongodb-memory-server-core@10.4.3
// node --test backend/test/transactions.integration.test.js
// Comparaison de configuration, sans toucher au backend :
// node backend/test/transactions.integration.test.js --heartbeat-ms=1000
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const mongoose = require('mongoose');
const express = require('express');

let memoryServer;
try {
    memoryServer = require('mongodb-memory-server-core');
} catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    memoryServer = require(path.join(os.tmpdir(),
        'noeliwacu-mongo-integration-deps/node_modules/mongodb-memory-server-core'));
}
const { MongoMemoryReplSet } = memoryServer;

// Seuls le logger fichier et SMTP sont neutralises. Les modeles, transactions,
// collections, controleurs, middleware PIN, routes et algorithme sont reels.
const loggerPath = require.resolve('../logs/logger');
const previousLogger = require.cache[loggerPath];
require.cache[loggerPath] = {
    id: loggerPath, filename: loggerPath, loaded: true,
    exports: { info() {}, warn() {}, error() {} }
};
const nodemailer = require('nodemailer');
let smtpCalls = 0;
test.mock.method(nodemailer, 'createTransport', () => {
    smtpCalls++;
    throw new Error('SMTP interdit dans les tests d\'integration.');
});
const Party = require('../src/models/Party');
const Participant = require('../src/models/Participant');
const { hashPin } = require('../src/utils/helpers');
const { withPartyTransaction } = require('../src/utils/partyTransaction');
const drawRoutes = require('../src/routes/draw');
const partyRoutes = require('../src/routes/parties');
const participantRoutes = require('../src/routes/participants');
const { adminPinLimiter } = require('../src/middleware/rateLimit');

let replSet;
let server;
let client;
let pinHash;
let baseUrl;
let dbName;
const wire = [];
const transactionSessions = new Map();
const metrics = {};
const heartbeatArgument = process.argv.find(argument => argument.startsWith('--heartbeat-ms='));
const heartbeatFrequencyMS = heartbeatArgument ? Number(heartbeatArgument.split('=')[1]) : 10000;
assert.ok([1000, 10000].includes(heartbeatFrequencyMS), 'Comparaison de test limitee aux heartbeats 1 s / 10 s');

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

async function waitUntil(predicate, timeout = 5000) {
    const deadline = performance.now() + timeout;
    while (!predicate()) {
        if (performance.now() >= deadline) throw new Error('Evenement MongoDB attendu non observe.');
        await delay(10);
    }
}

function isConflict(event) {
    return event.kind === 'failed' && [24, 112, 251].includes(event.code);
}

// Pause APRES une vraie commande, dans sa transaction encore non commitee.
// Aucun resultat de collection n'est fabrique ou remplace.
function pauseAfter(t, collection, method, predicate = () => true) {
    const reached = deferred();
    const release = deferred();
    const original = collection[method];
    let used = false;
    t.after(() => release.resolve());
    t.mock.method(collection, method, async function (...args) {
        const result = await original.apply(this, args);
        if (!used && predicate(...args)) {
            used = true;
            reached.resolve();
            await release.promise;
        }
        return result;
    });
    return { reached: reached.promise, release: release.resolve };
}

async function request(url = '/api/parties/TEST21/draw/prepare', { method = 'POST', body, pin = '1234' } = {}) {
    const headers = {};
    if (pin !== null) headers['X-Admin-Pin'] = pin;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${baseUrl}${url}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
}

const register = (name = 'ENFANT', extra = {}) => request('/api/participants/party/TEST21', {
    pin: null, body: { name, email: 'shared@example.invalid', familyGroup: 'A', ...extra }
});

async function seed(count = 2) {
    const party = await Party.create({
        code: 'TEST21', name: 'Fete locale integration', families: ['A', 'B', 'C'], adminPinHash: pinHash
    });
    if (count) {
        await Participant.insertMany(Array.from({ length: count }, (_, i) => ({
            partyId: party._id, name: `FIXTURE ${i}`, email: 'shared@example.invalid',
            familyGroup: ['A', 'B', 'C'][i % 3], wishList: ['Livre']
        })));
    }
    return party;
}

async function assertComplete(count) {
    const party = await Party.findOne({ code: 'TEST21' }).lean();
    const participants = await Participant.find({ partyId: party._id }).lean();
    const expected = participants.map(p => String(p._id)).sort();
    assert.equal(participants.length, count);
    assert.equal(party.drawDone, true);
    assert.ok(party.drawId);
    assert.ok(party.drawDate instanceof Date);
    assert.deepEqual(party.drawParticipantIds.map(String).sort(), expected);
    assert.deepEqual(party.pairsGenerated.map(p => String(p.giverId)).sort(), expected);
    assert.deepEqual(party.pairsGenerated.map(p => String(p.receiverId)).sort(), expected);
    assert.ok(party.pairsGenerated.every(p => !p.giverId.equals(p.receiverId)));
    assert.deepEqual(party.notifications.map(n => String(n.participantId)).sort(), expected);
    assert.ok(party.notifications.every(n => n.status === 'pending' && n.attemptCount === 0 &&
        n.recipientEmail === 'shared@example.invalid' && n.attempts.length === 0));
    return party;
}

function assertPrivate(response) {
    const json = JSON.stringify(response.body);
    for (const field of ['pairsGenerated', 'giverId', 'receiverId', 'drawParticipantIds',
        'notifications', 'recipientEmail', 'adminPinHash']) {
        assert.equal(json.includes(`"${field}"`), false, field);
    }
    assert.equal(json.includes('shared@example.invalid'), false);
    assert.equal(json.includes(pinHash), false);
}

test.before(async () => {
    assert.equal(mongoose.connection.readyState, 0, 'Aucune connexion preexistante autorisee');
    dbName = `noeliwacu_integration_${randomUUID().replaceAll('-', '')}`;
    replSet = await MongoMemoryReplSet.create({
        binary: { version: '7.0.24', downloadDir: path.join(os.tmpdir(), 'noeliwacu-mongo-integration-binaries') },
        replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' },
        instanceOpts: [{ args: ['--setParameter', 'enableTestCommands=1'] }]
    });
    const uri = replSet.getUri(dbName);
    assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, 'URI exclusivement locale generee par le replica set');
    await mongoose.connect(uri, {
        dbName, appName: 'noeliwacu-local-integration', monitorCommands: true,
        serverSelectionTimeoutMS: 5000, heartbeatFrequencyMS
    });
    assert.equal(mongoose.connection.name, dbName);
    client = mongoose.connection.getClient();
    client.on('commandStarted', event => {
        if (event.command.txnNumber) transactionSessions.set(event.command.lsid.id.toString('hex'), event.command.lsid);
        if (event.command.txnNumber) wire.push({
            kind: 'started', name: event.commandName,
            session: event.command.lsid.id.toString('hex'), txn: event.command.txnNumber.toString(),
            collection: event.command.findAndModify,
            coordination: Boolean(event.command.update?.$inc?.__v)
        });
    });
    client.on('commandFailed', event => wire.push({
        kind: 'failed', name: event.commandName, code: event.failure.code,
        labels: event.failure.errorLabels ?? []
    }));
    await Promise.all([Party.init(), Participant.init()]);
    pinHash = await hashPin('1234');
    const app = express();
    app.use(express.json());
    app.use('/api/parties', drawRoutes);
    app.use('/api/parties', partyRoutes);
    app.use('/api/participants', participantRoutes);
    server = await new Promise((resolve, reject) => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
        listener.on('error', reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const build = await mongoose.connection.db.admin().command({ buildInfo: 1 });
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    assert.ok(hello.setName && hello.isWritablePrimary);
    console.log(`Serveur reel : MongoDB ${build.version}, WiredTiger, replica set local 1 noeud ; Mongoose ${mongoose.version}.`);
}, { timeout: 240000 });

test.beforeEach(async () => {
    adminPinLimiter.resetKey('127.0.0.1');
    assert.equal(mongoose.connection.name, dbName);
    assert.match(dbName, /^noeliwacu_integration_[a-f0-9]+$/);
    await Participant.deleteMany({});
    await Party.deleteMany({});
    wire.length = 0;
    transactionSessions.clear();
});

test.after(async () => {
    try {
        if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
        await mongoose.disconnect();
    } finally {
        if (replSet) await replSet.stop();
        if (previousLogger) require.cache[loggerPath] = previousLogger;
        else delete require.cache[loggerPath];
    }
    assert.equal(smtpCalls, 0);
    assert.equal(require.cache[require.resolve('../src/services/emailService')], undefined);
    console.log(`Mesures integration : ${JSON.stringify(metrics)}`);
    console.log('SMTP : 0 appel ; replica set temporaire arrete et nettoye.');
});

test('56 participants : tirage complet, commit relu par un autre client et reponses sans attributions', async t => {
    await seed(56);
    const start = performance.now();
    const response = await request();
    metrics.prepare56Ms = Math.round(performance.now() - start);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assertPrivate(response);
    const saved = await assertComplete(56);
    const reader = new mongoose.mongo.MongoClient(replSet.getUri(dbName));
    try {
        await reader.connect();
        const independentlyRead = await reader.db(dbName).collection('parties').findOne({ _id: saved._id });
        assert.equal(independentlyRead.drawId, saved.drawId);
        assert.equal(independentlyRead.notifications.length, 56);
    } finally { await reader.close(); }
    for (const url of ['/api/parties/TEST21', '/api/parties/TEST21/draw/status']) {
        const publicResponse = await request(url, { method: 'GET', pin: null });
        assert.equal(publicResponse.status, 200);
        assertPrivate(publicResponse);
    }
    t.diagnostic(`Preparation 56 : ${metrics.prepare56Ms} ms`);
});

test('inscription verrouille d\'abord : tirage concurrent reprend et inclut le participant', { timeout: 30000 }, async t => {
    await seed();
    const gate = pauseAfter(t, Participant.collection, 'insertOne');
    const registration = register();
    await gate.reached;
    assert.equal(await Participant.countDocuments(), 2, 'Insertion transactionnelle encore invisible');
    const preparation = request();
    await waitUntil(() => wire.some(isConflict));
    gate.release();
    assert.equal((await registration).status, 201);
    assert.equal((await preparation).status, 201);
    await assertComplete(3);
    const child = await Participant.findOne({ name: 'ENFANT' });
    const party = await Party.findOne();
    assert.ok(party.drawParticipantIds.some(id => id.equals(child._id)));
    metrics.registrationFirstConflicts = wire.filter(isConflict).length;
    assert.ok(wire.some(event => event.labels?.includes('TransientTransactionError')));
});

test('tirage verrouille d\'abord : inscription concurrente refusee apres retry reel', { timeout: 30000 }, async t => {
    await seed();
    const gate = pauseAfter(t, Party.collection, 'findOneAndUpdate', (filter, update) => update.$set?.drawDone);
    const preparation = request();
    await gate.reached;
    const registration = register();
    await waitUntil(() => wire.some(isConflict));
    gate.release();
    assert.equal((await preparation).status, 201);
    assert.equal((await registration).status, 403);
    await assertComplete(2);
    assert.equal(await Participant.countDocuments({ name: 'ENFANT' }), 0);
});

test('deux preparations : un 201, un 409, aucune attribution remplacee', { timeout: 30000 }, async t => {
    await seed(56);
    const gate = pauseAfter(t, Party.collection, 'findOneAndUpdate', (filter, update) => update.$set?.drawDone);
    const first = request();
    await gate.reached;
    const second = request();
    await waitUntil(() => wire.some(isConflict));
    gate.release();
    const responses = await Promise.all([first, second]);
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
    const saved = await assertComplete(56);
    assert.equal(saved.drawId, responses.find(r => r.status === 201).body.draw.drawId);
    const snapshot = await Party.findOne().lean();
    assert.equal((await request()).status, 409);
    assert.deepEqual(await Party.findOne().lean(), snapshot);
});

test('deux inscriptions pour la 100e place : un 201, un 400 et exactement 100 participants', { timeout: 30000 }, async t => {
    await seed(99);
    const gate = pauseAfter(t, Participant.collection, 'insertOne');
    const first = register('ALICE');
    await gate.reached;
    const second = register('BOB');
    await waitUntil(() => wire.some(isConflict));
    gate.release();
    const responses = await Promise.all([first, second]);
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 400]);
    assert.equal(await Participant.countDocuments(), 100);
    assert.equal((await request()).status, 201);
    await assertComplete(100);
});

test('doublons concurrents refuses, noms distincts avec email partage acceptes', { timeout: 30000 }, async t => {
    await seed();
    const gate = pauseAfter(t, Participant.collection, 'insertOne');
    const first = register('ALICE');
    await gate.reached;
    const second = register('ALICE');
    await waitUntil(() => wire.some(isConflict));
    gate.release();
    assert.deepEqual((await Promise.all([first, second])).map(r => r.status).sort(), [201, 409]);
    assert.equal((await register('BOB')).status, 201);
    assert.equal(await Participant.countDocuments(), 4);
    const indexes = await Participant.collection.indexes();
    assert.ok(indexes.some(index => index.unique && index.key.partyId && index.key.name && index.key.email));
    const alice = await Participant.findOne({ name: 'ALICE' }).lean();
    const { _id, ...duplicate } = alice;
    await assert.rejects(Participant.collection.insertOne(duplicate), error => error.code === 11000);
});

test('erreur apres vraie insertion : transaction annulee, participant et version absents', async () => {
    const initial = await seed();
    const before = await Party.findById(initial._id).lean();
    await assert.rejects(withPartyTransaction({ _id: initial._id }, async (party, session) => {
        await new Participant({ partyId: party._id, name: 'ANNULE', email: 'shared@example.invalid', familyGroup: 'A' })
            .save({ session });
        throw new Error('Erreur de test apres insertion reelle');
    }), /Erreur de test/);
    assert.equal(await Participant.countDocuments(), 2);
    assert.deepEqual(await Party.findById(initial._id).lean(), before);
    assert.ok(wire.some(event => event.name === 'abortTransaction'));
});

test('souhait trop long : refus clair sans écriture puis inscription à la limite', async () => {
    const initial = await seed();
    const before = await Party.findById(initial._id).lean();
    const rejected = await register('INVALIDE', { wishList: ['x'.repeat(1001)] });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.code, 'WISH_TOO_LONG');
    assert.match(rejected.body.message, /1000 caractères/);
    assert.equal(await Participant.countDocuments(), 2);
    assert.deepEqual(await Party.findById(initial._id).lean(), before);
    const wish = 'https://shop.example.invalid/produit?reference='.padEnd(1000, 'x');
    assert.equal((await register('VALIDE', { wishList: [wish] })).status, 201);
    assert.deepEqual((await Participant.findOne({ name: 'VALIDE' })).wishList, [wish]);
    assert.equal(await Participant.countDocuments(), 3);
});

test('anciennes attributions et inscription apres tirage : aucune modification', async () => {
    const initial = await seed();
    const people = await Participant.find().sort({ _id: 1 });
    await Party.collection.updateOne({ _id: initial._id }, { $set: {
        drawDone: true, drawDate: new Date('2025-12-01T12:00:00Z'),
        pairsGenerated: [{ giverId: people[0]._id, receiverId: people[1]._id },
            { giverId: people[1]._id, receiverId: people[0]._id }]
    } });
    const before = await Party.findOne().lean();
    assert.equal((await register()).status, 403);
    assert.equal((await request()).status, 409);
    assert.deepEqual(await Party.findOne().lean(), before);
    assert.equal(await Participant.countDocuments(), 2);
});

test('timeout transactionnel 10 secondes : contention reelle, retries bornes et aucun ecrit partiel', { timeout: 35000 }, async t => {
    const initial = await seed();
    const before = await Party.findOne().lean();
    const blocker = await mongoose.startSession();
    try {
        blocker.startTransaction();
        await Party.findOneAndUpdate({ _id: initial._id }, { $inc: { __v: 1 } }, { session: blocker });
        const start = performance.now();
        const response = await request();
        metrics.transactionTimeoutMs = Math.round(performance.now() - start);
        metrics.timeoutConflicts = wire.filter(isConflict).length;
        assert.equal(response.status, 500, JSON.stringify(response.body));
        assertPrivate(response);
        assert.ok(metrics.transactionTimeoutMs >= 9000, `Timeout trop court : ${metrics.transactionTimeoutMs}`);
        assert.ok(metrics.transactionTimeoutMs < 20000, `Budget depasse : ${metrics.transactionTimeoutMs}`);
        assert.ok(metrics.timeoutConflicts > 1, 'Plusieurs conflits reels doivent etre observes');
    } finally {
        if (blocker.inTransaction()) await blocker.abortTransaction();
        await blocker.endSession();
    }
    assert.deepEqual(await Party.findOne().lean(), before);
    assert.equal((await request()).status, 201, 'Une nouvelle preparation est possible apres liberation du verrou');
    await assertComplete(2);
    t.diagnostic(`Timeout : ${metrics.transactionTimeoutMs} ms ; ${metrics.timeoutConflicts} conflits serveur`);
});

test('commit incertain sans indisponibilite primaire : reprise du commit sans doublon', { timeout: 30000 }, async () => {
    await seed();
    const control = new mongoose.mongo.MongoClient(replSet.getUri(dbName), { appName: 'noeliwacu-integration-control' });
    await control.connect();
    const admin = control.db(dbName).admin();
    await admin.command({ configureFailPoint: 'failCommand', mode: { times: 1 }, data: {
        failCommands: ['commitTransaction'], errorCode: 64,
        errorLabels: ['UnknownTransactionCommitResult'], appName: 'noeliwacu-local-integration'
    } });
    try {
        const response = await register();
        assert.equal(response.status, 201, JSON.stringify(response.body));
        assert.equal(await Participant.countDocuments({ name: 'ENFANT' }), 1);
        metrics.stableCommitAttempts = wire.filter(event => event.kind === 'started' && event.name === 'commitTransaction').length;
        assert.ok(metrics.stableCommitAttempts >= 2);
        assert.equal(wire.filter(event => event.kind === 'started' && event.coordination).length, 1);
    } finally {
        await admin.command({ configureFailPoint: 'failCommand', mode: 'off' });
        if (transactionSessions.size) await admin.command({ killSessions: [...transactionSessions.values()] });
        await control.close();
    }
});

// Rejouer le scenario d'origine (un code 91), puis une indisponibilite durable.
// Un 201 exige une preuve persistante ; un 503 doit rester explicitement inconnu.
for (const persistent of [false, true]) {
for (const operation of ['inscription', 'tirage']) {
test(`${operation} : commit code 91 ${persistent ? 'persistant' : 'unique'}, confirmation ou inconnu sans replay`, { timeout: 35000 }, async t => {
    await seed();
    // Connexion de controle distincte : le failpoint ne vise que l'application.
    const control = new mongoose.mongo.MongoClient(replSet.getUri(dbName), { appName: 'noeliwacu-integration-control' });
    await control.connect();
    const admin = control.db(dbName).admin();
    const originalTransaction = mongoose.connection.transaction;
    t.mock.method(mongoose.connection, 'transaction', async function (...args) {
        try { return await originalTransaction.apply(this, args); }
        catch (error) {
            metrics.commitError = { name: error.name, code: error.code, message: error.message, labels: error.errorLabels };
            throw error;
        }
    });
    await admin.command({ configureFailPoint: 'failCommand', mode: persistent ? 'alwaysOn' : { times: 1 }, data: {
        failCommands: ['commitTransaction'], errorCode: 91,
        errorLabels: ['UnknownTransactionCommitResult'], appName: 'noeliwacu-local-integration'
    } });
    try {
        const response = await (operation === 'inscription' ? register() : request());
        if (persistent) assert.equal(response.status, 503, JSON.stringify(response.body));
        else assert.ok([201, 503].includes(response.status), JSON.stringify(response.body));
        const confirmed = response.status === 201;
        assert.equal(response.body.outcome, confirmed ? 'confirmed' : 'unknown');
        if (!confirmed) {
            assert.equal(response.body.code, 'TRANSACTION_RESULT_UNKNOWN');
            assert.equal(response.body.retryable, false);
            assert.equal(response.body.verificationRequired, true);
            assert.ok(response.body.operationId);
        }
        if (operation === 'tirage') assertPrivate(response);
        assert.equal(await control.db(dbName).collection('participants').countDocuments(), confirmed && operation === 'inscription' ? 3 : 2);
        const stored = await control.db(dbName).collection('parties').findOne({ code: 'TEST21' });
        assert.equal(stored.drawDone, confirmed && operation === 'tirage');
        if (confirmed && operation === 'tirage') assert.equal(stored.drawId, response.body.draw.drawId);
        metrics.commitAttempts = wire.filter(event => event.kind === 'started' && event.name === 'commitTransaction').length;
        assert.ok(metrics.commitAttempts >= 1);
        assert.equal(wire.filter(event => event.kind === 'started' && event.coordination).length, 1);
    } finally {
        const hello = await admin.command({ hello: 1 });
        metrics.commitPrimaryStillAvailable = hello.isWritablePrimary;
        metrics.testServerSelectionTimeoutMs = client.options.serverSelectionTimeoutMS;
        metrics.testHeartbeatFrequencyMs = client.options.heartbeatFrequencyMS;
        metrics.commitWire = {
            attempts: wire.filter(event => event.kind === 'started' && event.name === 'commitTransaction').length,
            transactions: [...new Set(wire.filter(event => event.name === 'commitTransaction').map(event => event.txn).filter(Boolean))],
            failureCodes: [...new Set(wire.filter(event => event.kind === 'failed').map(event => event.code))]
        };
        t.diagnostic(`Commit observe : ${JSON.stringify({ error: metrics.commitError, commands: metrics.commitWire })}`);
        await admin.command({ configureFailPoint: 'failCommand', mode: 'off' });
        // En cas d'echec de confirmation, ne pas laisser un verrou de test
        // attendre l'expiration serveur de la transaction.
        if (transactionSessions.size) await admin.command({ killSessions: [...transactionSessions.values()] });
        await control.close();
    }
});
}
}

// Perte de confirmation injectee APRES un commit vraiment execute par mongod.
// Les ecritures et la lecture de reconciliation restent de vraies commandes.
for (const operation of ['inscription', 'tirage']) {
for (const inaccessible of [false, true]) {
test(`${operation} : commit reel, confirmation perdue${inaccessible ? ', verification inaccessible' : ', lecture confirme'}`,
    { timeout: 20000 }, async t => {
    await seed();
    const control = new mongoose.mongo.MongoClient(replSet.getUri(dbName), { appName: 'noeliwacu-integration-control' });
    await control.connect();
    const admin = control.db(dbName).admin();
    const originalStartSession = mongoose.connection.startSession;
    t.mock.method(mongoose.connection, 'startSession', async function (...args) {
        const session = await originalStartSession.apply(this, args);
        const originalCommit = session.commitTransaction;
        t.mock.method(session, 'commitTransaction', async function (...commitArgs) {
            await originalCommit.apply(this, commitArgs);
            if (inaccessible) {
                await admin.command({ configureFailPoint: 'failCommand', mode: { times: 1 }, data: {
                    failCommands: ['find'], blockConnection: true, blockTimeMS: 6500,
                    appName: 'noeliwacu-local-integration'
                } });
            }
            // Sans label UnknownTransactionCommitResult : la phase doit suffire.
            throw new mongoose.mongo.MongoOperationTimeoutError('Confirmation perdue apres commit reel');
        });
        return session;
    });
    try {
        const start = performance.now();
        const response = await (operation === 'inscription' ? register() : request());
        const elapsed = Math.round(performance.now() - start);
        assert.equal(response.status, inaccessible ? 503 : 201, JSON.stringify(response.body));
        assert.equal(response.body.outcome, inaccessible ? 'unknown' : 'confirmed');
        if (inaccessible) {
            assert.equal(response.body.retryable, false);
            assert.equal(response.body.verificationRequired, true);
            assert.ok(elapsed >= 4500 && elapsed < 10000, `Lecture non bornee : ${elapsed} ms`);
            metrics.verificationTimeoutMs = elapsed;
        }
        assert.equal(await control.db(dbName).collection('participants').countDocuments(), operation === 'inscription' ? 3 : 2);
        const stored = await control.db(dbName).collection('parties').findOne({ code: 'TEST21' });
        if (operation === 'tirage') {
            assert.equal(stored.drawDone, true);
            assert.equal(stored.pairsGenerated.length, 2);
            assertPrivate(response);
        }
        assert.equal(wire.filter(event => event.kind === 'started' && event.coordination).length, 1);
        assert.equal(wire.filter(event => event.kind === 'started' && event.name === 'commitTransaction').length, 1);
    } finally {
        await admin.command({ configureFailPoint: 'failCommand', mode: 'off' });
        if (transactionSessions.size) await admin.command({ killSessions: [...transactionSessions.values()] });
        await control.close();
    }
});
}
}

const adminParticipants = '/api/participants/party/TEST21/admin';
const adminEntry = { name: ' Alice ', email: ' SHARED@example.invalid ', familyGroup: 'A', wishList: [' Livre ', '', 'Jeu', 'Chocolat'] };
const adminAdd = (body = adminEntry) => request(adminParticipants, { body });
const adminEdit = (id, body) => request(`${adminParticipants}/${id}`, { method: 'PATCH', body });
const adminDelete = id => request(`${adminParticipants}/${id}`, { method: 'DELETE' });

test('CRUD administrateur : normalisation, adresse partagee, whitelist et suppression ciblee', async () => {
    const party = await seed(0);
    const added = await adminAdd();
    assert.equal(added.status, 201);
    const { _id: id } = added.body.participant;
    assert.deepEqual(added.body.participant, { _id: id, name: 'ALICE', email: 'shared@example.invalid', familyGroup: 'A',
        wishList: ['Livre', 'Jeu', 'Chocolat'] });
    const other = await adminAdd({ ...adminEntry, name: 'Bob' });
    assert.equal(other.status, 201);
    assert.equal((await adminAdd({ ...adminEntry, familyGroup: 'B' })).status, 409);
    assert.equal((await adminEdit(id, { name: 'Bob' })).status, 409);
    const changed = await adminEdit(id, { name: 'Chloé', email: ' Autre@example.invalid ', familyGroup: ' B ',
        wishList: [' Un ', 'Deux', 'Trois', 'Quatre'], partyId: other.body.participant._id, receiverId: 'private' });
    assert.equal(changed.status, 200);
    assert.deepEqual(changed.body.participant, { _id: id, name: 'CHLOÉ', email: 'autre@example.invalid', familyGroup: 'B',
        wishList: ['Un', 'Deux', 'Trois'] });
    assert.equal((await adminEdit(id, { familyGroup: 'B' })).status, 200);
    assert.deepEqual((await adminEdit(id, { wishList: [] })).body.participant.wishList, []);
    assert.equal(String((await Participant.findById(id)).partyId), String(party._id));
    assert.deepEqual((await adminDelete(id)).body, { success: true, outcome: 'confirmed', participantId: id });
    assert.equal(await Participant.findById(id), null);
    assert.ok(await Participant.findById(other.body.participant._id));
    assert.equal((await adminDelete(id)).status, 404);
});

test('CRUD admin : familles, identifiants, souhaits et limite valides uniquement', async () => {
    await seed(99);
    assert.equal((await adminAdd({ ...adminEntry, familyGroup: 'X' })).status, 400);
    const added = await adminAdd();
    assert.equal(added.status, 201);
    const id = added.body.participant._id;
    assert.equal((await adminAdd({ ...adminEntry, name: 'Bob' })).status, 400);
    assert.equal((await adminEdit('invalid', { name: 'Bob' })).status, 400);
    for (const body of [{ name: '123' }, { email: 'invalide' }, { familyGroup: 'X' }, { wishList: [1] },
        { wishList: ['x'.repeat(1001)] }, { partyId: id }]) {
        assert.equal((await adminEdit(id, body)).status, 400);
    }
    assert.equal((await Participant.findById(id)).name, 'ALICE');
    assert.equal(await Participant.countDocuments(), 100);
});

test('CRUD admin : PIN obligatoire, mauvais PIN et cible d’une autre fête refusés', async () => {
    await seed(0);
    const foreignParty = await Party.create({ code: 'AUTRE1', name: 'Autre', families: ['A', 'B'], adminPinHash: pinHash });
    const foreign = await Participant.create({ partyId: foreignParty._id, ...adminEntry });
    for (const [url, method] of [[adminParticipants, 'POST'], [`${adminParticipants}/${foreign._id}`, 'PATCH'],
        [`${adminParticipants}/${foreign._id}`, 'DELETE']]) {
        for (const [pin, status] of [[null, 401], ['9999', 403]]) {
            const result = await request(url, { method, pin, body: adminEntry });
            assert.equal(result.status, status);
            assertPrivate(result);
        }
    }
    assert.equal((await adminEdit(foreign._id, { name: 'Bob' })).status, 404);
    assert.equal((await adminDelete(foreign._id)).status, 404);
    assert.equal(await Participant.countDocuments(), 1);
});

for (const [method, collectionMethod, firstStatus] of [['POST', 'insertOne', 201], ['PATCH', 'updateOne', 200], ['DELETE', 'deleteOne', 200]]) {
    for (const adminFirst of [true, false]) {
        test(`${method} admin et tirage concurrents, admin premier=${adminFirst}`, { timeout: 30000 }, async t => {
            const party = await seed(3);
            const person = await Participant.findOne({ partyId: party._id, name: 'FIXTURE 0' });
            const mutate = () => method === 'POST' ? adminAdd() : method === 'PATCH' ?
                adminEdit(person._id, { email: 'changed@example.invalid', familyGroup: 'B' }) : adminDelete(person._id);
            const gate = adminFirst ? pauseAfter(t, Participant.collection, collectionMethod, (...args) =>
                args.at(-1)?.session) : pauseAfter(t, Party.collection, 'findOneAndUpdate', (filter, update) => update.$set?.drawDone);
            const first = adminFirst ? mutate() : request();
            await Promise.race([gate.reached, first.then(result => { throw new Error(`Écriture attendue absente: ${result.status}`); })]);
            const second = adminFirst ? request() : mutate();
            try { await waitUntil(() => wire.some(isConflict)); }
            finally { gate.release(); }
            const [firstResult, secondResult] = await Promise.all([first, second]);
            assert.equal(firstResult.status, adminFirst ? firstStatus : 201);
            assert.equal(secondResult.status, adminFirst ? 201 : 403);
            const stored = await Party.findById(party._id).lean();
            const participants = await Participant.find({ partyId: party._id }).lean();
            assert.equal(participants.length, adminFirst && method === 'POST' ? 4 : adminFirst && method === 'DELETE' ? 2 : 3);
            assert.deepEqual(stored.drawParticipantIds.map(String).sort(), participants.map(p => String(p._id)).sort());
            const old = stored.notifications.find(n => n.participantId.equals(person._id));
            assert.equal(old?.recipientEmail, adminFirst && method === 'DELETE' ? undefined :
                adminFirst && method === 'PATCH' ? 'changed@example.invalid' : 'shared@example.invalid');
            assert.ok(stored.notifications.every(n => n.status === 'pending'));
        });
    }
}

test('ancienne fête V2 avec des paires seules : les trois opérations admin refusées', async () => {
    const party = await seed();
    const [giver, receiver] = await Participant.find({ partyId: party._id });
    await Party.updateOne({ _id: party._id }, { $set: { pairsGenerated: [{ giverId: giver._id, receiverId: receiver._id }] } });
    const before = await Party.findById(party._id).lean();
    for (const result of [await adminAdd(), await adminEdit(giver._id, { name: 'Bob' }), await adminDelete(giver._id)]) {
        assert.equal(result.status, 403);
        assert.equal(result.body.code, 'DRAW_ALREADY_EXISTS');
        assertPrivate(result);
    }
    assert.deepEqual(await Party.findById(party._id).lean(), before);
    assert.equal(await Participant.countDocuments(), 2);
});

for (const method of ['PATCH', 'DELETE']) {
    test(`${method} admin : commit réel sans confirmation, aucune répétition`, async t => {
        const party = await seed();
        const person = await Participant.findOne({ partyId: party._id });
        const startSession = mongoose.connection.startSession;
        t.mock.method(mongoose.connection, 'startSession', async function (...args) {
            const session = await startSession.apply(this, args);
            const commit = session.commitTransaction;
            t.mock.method(session, 'commitTransaction', async function (...commitArgs) {
                await commit.apply(this, commitArgs);
                throw new mongoose.mongo.MongoOperationTimeoutError('Confirmation perdue après écriture réelle');
            });
            return session;
        });
        const result = await (method === 'PATCH' ? adminEdit(person._id, { name: 'Bob' }) : adminDelete(person._id));
        assert.equal(result.status, 503);
        assert.equal(result.body.outcome, 'unknown');
        assert.equal(result.body.verificationRequired, true);
        assert.equal(result.body.retryable, false);
        const stored = await Participant.findById(person._id);
        assert.equal(stored?.name, method === 'PATCH' ? 'BOB' : undefined);
        assert.equal(wire.filter(event => event.kind === 'started' && event.coordination).length, 1);
        assertPrivate(result);
    });
}

test('recette locale : création, 56 participants, corrections, tirage et distribution simulée', { timeout: 30000 }, async () => {
    const created = await request('/api/parties', { pin: null, body: {
        name: 'Noël fictif', families: ['A', 'B'], adminPin: '1234', budget: 25
    } });
    assert.equal(created.status, 201);
    const { code } = created.body.party;
    const party = `/api/parties/${code}`;
    const people = `/api/participants/party/${code}`;
    assert.deepEqual((await request(party, { method: 'GET', pin: null })).body.party.families, ['A', 'B']);
    assert.equal((await request(`${party}/verify-pin`, { pin: null, body: { adminPin: '1234' } })).status, 200);
    for (let i = 0; i < 55; i++) {
        const name = `Invité ${String.fromCharCode(65 + Math.floor(i / 26), 65 + i % 26)}`;
        assert.equal((await request(people, { pin: null, body: { name, email: 'shared@example.invalid', familyGroup: i % 2 ? 'A' : 'B' } })).status, 201);
    }
    const extra = await request(`${people}/admin`, { body: adminEntry });
    assert.equal(extra.status, 201);
    const id = extra.body.participant._id;
    const incorrect = await request(`${people}/admin`, { body: { ...adminEntry, name: 'À supprimer' } });
    assert.equal(incorrect.status, 201);
    assert.equal((await request(`${people}/admin/${incorrect.body.participant._id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await request(`${people}/admin/${id}`, { method: 'PATCH', body: {
        name: 'Alice corrigée', familyGroup: 'B', wishList: ['Livre']
    } })).status, 200);
    const listed = await request(people, { method: 'GET' });
    assert.equal(listed.body.count, 56);
    assert.equal(listed.body.participants.find(p => p._id === id).name, 'ALICE CORRIGÉE');
    const prepared = await request(`${party}/draw/prepare`);
    assert.equal(prepared.status, 201);
    assert.equal(prepared.body.draw.participantCount, 56);
    assertPrivate(prepared);
    assert.equal((await request(`${party}/draw/send`)).status, 410);
    const read = () => request(`${party}/draw/notifications`, { method: 'GET' });
    const pending = await read();
    assert.equal(pending.body.counts.pending, 56);

    // Le vrai service classe les simulations. La configuration injectée exclut
    // toute lecture de credentials et createTransport est interdit par le harness.
    const emailPath = require.resolve('../src/services/emailService');
    const { createEmailService } = require(emailPath);
    require.cache[emailPath].exports = createEmailService({ getConfig: () => ({ testMode: true }) });
    try {
        for (const participantId of [id, pending.body.notifications.find(row => row.participantId !== id).participantId]) {
            const result = await request(`${party}/draw/notifications/${participantId}/send`);
            assert.equal(result.status, 200);
            assert.equal(result.body.status, 'simulated');
            assert.equal(result.body.accepted, false);
            assertPrivate(result);
        }
        const tracked = await read();
        assert.deepEqual(tracked.body.counts, { total: 56, pending: 54, sending: 0, accepted: 0, failed: 0, uncertain: 0, simulated: 2 });
        assert.ok(!JSON.stringify(tracked.body).includes('receiverId'));
        assert.equal((await request(`${people}/admin/${id}`, { method: 'DELETE' })).status, 403);
        assert.equal((await request(`${party}/draw/prepare`)).status, 409);
    } finally { delete require.cache[emailPath]; }
});

test('ancien envoi desactive et aucun appel SMTP dans toute la suite', async () => {
    await seed();
    const response = await request('/api/parties/TEST21/draw/send');
    assert.equal(response.status, 410);
    assert.equal(smtpCalls, 0);
    assert.equal(require.cache[require.resolve('../src/services/emailService')], undefined);
});
