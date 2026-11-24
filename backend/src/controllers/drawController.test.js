const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');
const mongoose = require('mongoose');
const Party = require('../models/Party');
const Participant = require('../models/Participant');
const helpers = require('../utils/helpers');

// Aucun .env, serveur MongoDB, service email ou logger fichier n'est charge.
// Express, bcrypt, Mongoose, ClientSession.withTransaction (retries inclus)
// et l'algorithme sont reels. Le stockage, les verrous et les commandes
// commit/abort sont simules : pas de test de replication/serveur MongoDB.
const quietLogger = { info() {}, warn() {}, error() {} };
let emailImports = 0;
function load(relativePath, dependencies = {}) {
    const filename = path.resolve(__dirname, relativePath);
    const localRequire = createRequire(filename);
    const module = { exports: {} };
    const requireDependency = name => {
        if (/emailService|nodemailer/.test(name)) {
            emailImports++;
            throw new Error('Tout acces SMTP est interdit dans ces tests.');
        }
        if (name === '../../logs/logger') return quietLogger;
        if (Object.hasOwn(dependencies, name)) return dependencies[name];
        return localRequire(name);
    };
    vm.compileFunction(fs.readFileSync(filename, 'utf8'),
        ['require', 'module', 'exports', '__filename', '__dirname'], { filename })(
        requireDependency, module, module.exports, filename, path.dirname(filename));
    return module.exports;
}

const drawService = load('../services/drawService.js');
const { serialize, deserialize } = mongoose.mongo.BSON;
const clone = value => deserialize(serialize({ value })).value;
const id = () => new mongoose.Types.ObjectId();
let pinHash;
test.before(async () => { pinHash = await helpers.hashPin('1234'); });
test.after(() => { assert.equal(emailImports, 0, 'Aucun import SMTP, meme indirect'); });

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

// Evaluateur limite aux operateurs utilises par les filtres testes. L'absence
// d'await entre matches() et l'affectation simule une operation indivisible.
function matches(document, filter) {
    return Object.entries(filter).every(([field, expected]) => {
        if (field === '$and') return expected.every(part => matches(document, part));
        if (field === '$or') return expected.some(part => matches(document, part));
        const value = document[field];
        if (expected === null) return value == null;
        if (expected && typeof expected === 'object' && !expected._bsontype) {
            return Object.entries(expected).every(([operator, operand]) => {
                if (operator === '$ne') return value !== operand;
                if (operator === '$exists') return (value !== undefined) === operand;
                if (operator === '$size') return Array.isArray(value) && value.length === operand;
                throw new Error(`Operateur de test non implemente : ${operator}`);
            });
        }
        return String(value) === String(expected);
    });
}

async function harness(t, options = {}) {
    const connection = mongoose.createConnection(); // Pas d'URI, pas de connexion.
    t.after(() => connection.close());
    const partySchema = Party.schema.clone();
    partySchema.set('autoCreate', false);
    partySchema.set('autoIndex', false);
    const participantSchema = Participant.schema.clone();
    participantSchema.set('autoCreate', false);
    participantSchema.set('autoIndex', false);
    const PartyModel = connection.model('Party', partySchema);
    const ParticipantModel = connection.model('Participant', participantSchema);
    // Les collections ci-dessous sont directement disponibles dans le double.
    PartyModel.collection.buffer = false;
    ParticipantModel.collection.buffer = false;
    const state = {
        party: {
            _id: id(), code: 'TEST21', name: 'Fete de test', families: ['A', 'B', 'C'],
            adminPinHash: pinHash, preferCrossFamily: true,
            drawDone: false, drawDate: null, pairsGenerated: [],
            ...options.party
        },
        participants: [], commits: 0, writes: [], generations: 0, partyReads: 0,
        lockWrites: [], transactionCommits: 0, transactionAttempts: 0, aborts: 0,
        commitCalls: 0, conflicts: 0, verificationReads: []
    };
    state.participants = Array.from({ length: options.size ?? 2 }, (_, i) => ({
        _id: id(), partyId: state.party._id, name: `PERSONNE ${i}`,
        email: 'shared@example.invalid', familyGroup: ['A', 'B', 'C'][i % 3], wishList: []
    }));

    // Client non connecte : les sessions/algorithmes de retry du driver sont
    // utilises, mais aucune commande ne peut atteindre un serveur.
    const client = new mongoose.mongo.MongoClient('mongodb://127.0.0.1:27017');
    t.after(() => client.close());
    const views = new WeakMap();
    let lockOwner;
    let lockReleased;
    const usedFaults = new Set();
    function once(name) {
        if (!options[name] || usedFaults.has(name)) return false;
        usedFaults.add(name);
        return true;
    }
    function transientError() {
        return new mongoose.mongo.MongoServerError({
            message: 'Simulated write conflict', code: 112, errorLabels: ['TransientTransactionError']
        });
    }
    function release(session) {
        if (lockOwner === session) {
            lockOwner = undefined;
            lockReleased.resolve();
        }
    }
    function view(session) {
        assert.ok(session?.inTransaction(), 'Toute operation transactionnelle exige la session active');
        assert.equal(lockOwner, session, 'Party doit etre verrouille avant la lecture de Participant');
        return views.get(session);
    }
    connection.startSession = async () => {
        const session = client.startSession();
        const startTransaction = session.startTransaction.bind(session);
        session.startTransaction = settings => {
            startTransaction(settings);
            state.transactionOptions = settings;
            state.transactionAttempts++;
            views.set(session, {});
        };
        session.abortTransaction = async () => {
            state.aborts++;
            session.transaction.transition('TRANSACTION_ABORTED');
            release(session);
        };
        session.commitTransaction = async () => {
            state.commitCalls++;
            if (session.transaction.state === 'TRANSACTION_COMMITTED') return;
            const pending = view(session);
            if (options.beforeCommit) await options.beforeCommit(pending, state);
            if (once('transientCommitOnce') || options.failCommit) {
                await session.abortTransaction();
                if (!options.failCommit) throw transientError();
                throw new mongoose.mongo.MongoServerError({ message: 'Simulated commit failure', code: 64 });
            }
            if (options.unknownBeforeCommit) {
                session.transaction.transition('TRANSACTION_COMMITTED');
                release(session);
                throw new mongoose.mongo.MongoOperationTimeoutError('Commit result lost without label');
            }
            state.party = pending.party;
            state.participants = pending.participants;
            state.transactionCommits++;
            if (pending.drawWritten) state.commits++;
            session.transaction.transition('TRANSACTION_COMMITTED');
            release(session);
            if (once('unknownCommitOnce') || options.failAfterCommit) {
                throw new mongoose.mongo.MongoServerError({
                    message: 'Connection lost after commit',
                    // 50 termine le retry du commit : resultat reste incertain.
                    code: options.failAfterCommit ? 50 : 64,
                    errorLabels: ['UnknownTransactionCommitResult']
                });
            }
        };
        return session;
    };

    PartyModel.collection.findOne = async (filter, settings) => {
        state.partyReads++;
        assert.ok(settings.session == null, 'Les lectures transactionnelles de Party passent par le verrou');
        if (settings.readConcern?.level === 'majority') {
            state.verificationReads.push({ filter, settings });
            if (options.failVerification) throw new Error('Verification unavailable');
            if (options.hideVerification) return null;
        }
        return state.party && matches(state.party, filter) ? clone(state.party) : null;
    };
    PartyModel.collection.findOneAndUpdate = async (filter, update, settings) => {
        const session = settings.session;
        assert.ok(session?.inTransaction(), 'Ecriture Party sans session interdite');
        if (update.$inc) {
            state.lockWrites.push({ filter, update, settings });
            if (options.beforeLock) await options.beforeLock(state);
            if (lockOwner && lockOwner !== session) {
                state.conflicts++;
                if (options.onLockConflict) options.onLockConflict();
                await lockReleased.promise;
                throw transientError(); // Le driver reprend avec un nouveau snapshot.
            }
            lockOwner = session;
            lockReleased = deferred();
            const pending = views.get(session);
            pending.party = clone(state.party);
            pending.participants = clone(state.participants);
            session.transaction.transition('TRANSACTION_IN_PROGRESS');
            if (options.unsupportedTransactions) {
                throw new mongoose.mongo.MongoServerError({ message: 'Transactions unavailable', code: 20 });
            }
            if (once('transientLockOnce')) throw transientError();
            if (!pending.party || !matches(pending.party, filter)) return null;
            assert.deepEqual(update.$inc, { __v: 1 });
            pending.party.__v = (pending.party.__v ?? 0) + 1;
            return clone(pending.party);
        }
        const pending = view(session);
        state.writes.push({ filter, update, settings });
        if (options.beforeWrite) await options.beforeWrite(state);
        if (options.failWrite) throw new Error('Simulated write failure containing private details');
        if (!pending.party || !matches(pending.party, filter)) return null;
        pending.party = { ...pending.party, ...clone(update.$set) };
        pending.drawWritten = true;
        if (once('transientDrawOnce')) throw transientError();
        return { drawId: pending.party.drawId, drawDate: pending.party.drawDate };
    };
    ParticipantModel.collection.find = (filter, settings) => ({
        toArray: async () => clone(view(settings.session).participants.filter(p => matches(p, filter)))
    });
    ParticipantModel.collection.countDocuments = async (filter, settings) =>
        (settings.session ? view(settings.session).participants : state.participants)
            .filter(p => matches(p, filter)).length;
    ParticipantModel.collection.findOne = async (filter, settings) => {
        if (settings.readConcern?.level === 'majority') {
            state.verificationReads.push({ filter, settings });
            if (options.failVerification) throw new Error('Verification unavailable');
            if (options.hideVerification) return null;
            assert.equal(settings.session, null);
            return clone(state.participants.find(p => matches(p, filter)) ?? null);
        }
        return clone(view(settings.session).participants.find(p => matches(p, filter)) ?? null);
    };
    ParticipantModel.collection.insertOne = async (participant, settings) => {
        const pending = view(settings.session);
        if (options.beforeInsert) await options.beforeInsert();
        if (options.failInsert) throw new Error('Simulated insert failure');
        pending.participants.push(clone(participant));
        if (once('transientInsertOnce')) throw transientError();
        return { acknowledged: true, insertedId: participant._id };
    };

    const models = { '../models/Party': PartyModel, '../models/Participant': ParticipantModel };
    const partyTransaction = load('../utils/partyTransaction.js', models);
    models['../utils/partyTransaction'] = partyTransaction;
    const controller = load('./drawController.js', {
        ...models,
        '../services/drawService': {
            ...drawService,
            generatePairs(participants, preference) {
                state.generations++;
                assert.equal(preference, state.party.preferCrossFamily);
                return options.generatePairs
                    ? options.generatePairs(participants) : drawService.generatePairs(participants, preference);
            }
        }
    });
    const auth = load('../middleware/auth.js', models);
    const limiter = load('../middleware/rateLimit.js');
    const router = load('../routes/draw.js', {
        '../controllers/drawController': controller,
        '../middleware/auth': auth,
        '../middleware/rateLimit': limiter
    });
    const partyController = load('./partyController.js', models);
    const participantController = load('./participantController.js', models);
    const app = express();
    app.use(express.json());
    app.use('/api/parties', router);
    app.get('/api/parties/:code', partyController.getParty);
    app.post('/api/participants/party/:code', participantController.addParticipant);
    const server = await new Promise((resolve, reject) => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
        listener.on('error', reject);
    });
    t.after(() => new Promise(resolve => {
        server.close(resolve);
        server.closeAllConnections();
    }));
    async function request(url = '/api/parties/TEST21/draw/prepare', config = {}) {
        const { pin = '1234', method = 'POST', body } = config;
        const headers = {};
        if (pin !== null) headers['X-Admin-Pin'] = pin;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
            method, headers, body: body === undefined ? undefined : JSON.stringify(body)
        });
        return { status: response.status, body: await response.json() };
    }
    return { state, request, PartyModel };
}

function assertPrivate(response, state) {
    const json = JSON.stringify(response.body);
    for (const field of ['pairsGenerated', 'giverId', 'receiverId', 'drawParticipantIds',
        'notifications', 'adminPinHash', 'recipientEmail']) {
        assert.equal(json.includes(`"${field}"`), false, field);
    }
    assert.equal(json.includes(pinHash), false);
    for (const participant of state.participants) {
        assert.equal(json.includes(String(participant._id)), false);
        assert.equal(json.includes(participant.email), false);
    }
}

for (const size of [2, 31, 56]) {
    test(`prepare sauvegarde ${size} attributions coherentes et notifications pending sans SMTP`, async t => {
        const { state, request, PartyModel } = await harness(t, { size });
        const response = await request();
        assert.equal(response.status, 201);
        assert.equal(response.body.success, true);
        assert.equal(response.body.draw.participantCount, size);
        assert.match(response.body.draw.drawId, /^[0-9a-f-]{36}$/);
        assertPrivate(response, state);
        assert.equal(state.commits, 1);
        assert.equal(state.writes.length, 1);
        const saved = state.party;
        assert.equal(saved.drawDone, true);
        assert.ok(saved.drawDate instanceof Date);
        assert.equal(response.body.draw.drawId, saved.drawId);
        assert.equal(response.body.draw.drawDate, saved.drawDate.toISOString());
        const expected = state.participants.map(p => String(p._id)).sort();
        assert.deepEqual(saved.drawParticipantIds.map(String).sort(), expected);
        assert.deepEqual(saved.pairsGenerated.map(p => String(p.giverId)).sort(), expected);
        assert.deepEqual(saved.pairsGenerated.map(p => String(p.receiverId)).sort(), expected);
        assert.ok(saved.pairsGenerated.every(p => String(p.giverId) !== String(p.receiverId)));
        assert.deepEqual(saved.notifications.map(n => String(n.participantId)).sort(), expected);
        assert.ok(saved.notifications.every(n => n.status === 'pending' && n.attemptCount === 0 &&
            n.recipientEmail === 'shared@example.invalid' && n.attempts.length === 0));
        await PartyModel.hydrate(saved).validate();
        const { update, settings } = state.writes[0];
        assert.deepEqual(Object.keys(update), ['$set']);
        assert.deepEqual(Object.keys(update.$set).sort(), [
            'drawId', 'drawDate', 'drawDone', 'drawParticipantIds', 'pairsGenerated', 'notifications'
        ].sort());
        assert.equal(settings.upsert, false);
        assert.equal(settings.returnDocument, 'after');
        // Mongoose peut retirer l'exclusion _id de la projection du driver.
        assert.equal(settings.projection.drawId, 1);
        assert.equal(settings.projection.drawDate, 1);
        assert.ok(Object.keys(settings.projection).every(field => ['_id', 'drawId', 'drawDate'].includes(field)));
        assert.equal(settings.writeConcern, undefined); // Configure au niveau transaction.
        assert.equal(state.transactionOptions.writeConcern.w, 'majority');
        assert.equal(state.transactionOptions.readConcern.level, 'snapshot');
        assert.equal(state.transactionOptions.readPreference, 'primary');
        assert.equal(state.transactionOptions.timeoutMS, 10000);
        assert.equal(state.lockWrites.length, 1);
        assert.equal(state.lockWrites[0].settings.session, settings.session);
        assert.equal(settings.maxTimeMS, 10000);
    });
}

test('deux demandes concurrentes : une creation 201, un conflit 409 apres retry', { timeout: 15000 }, async t => {
    const atWrite = deferred();
    const conflict = deferred();
    const { state, request } = await harness(t, {
        size: 56,
        beforeWrite: async () => { atWrite.resolve(); await conflict.promise; },
        onLockConflict: () => conflict.resolve()
    });
    const first = request();
    await atWrite.promise;
    const responses = await Promise.all([first, request()]);
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
    assert.equal(state.generations, 1);
    assert.equal(state.commits, 1);
    assert.equal(state.writes.length, 1);
    assert.equal(state.conflicts, 1);
    assert.equal(responses.find(r => r.status === 201).body.draw.drawId, state.party.drawId);
    for (const response of responses) assertPrivate(response, state);
});

test('echec avant sauvegarde : aucun champ du tirage n\'est enregistre', async t => {
    const { state, request } = await harness(t, { failWrite: true });
    const before = clone(state.party);
    const response = await request();
    assert.equal(response.status, 500);
    assert.equal(state.commits, 0);
    assert.deepEqual(state.party, before);
    assertPrivate(response, state);
    assert.equal(JSON.stringify(response.body).includes('private details'), false);
});

test('reponse DB perdue apres commit : lecture confirme le tirage sans nouvelle creation', async t => {
    const { state, request } = await harness(t, { failAfterCommit: true });
    assert.equal((await request()).status, 201);
    const saved = clone(state.party);
    assert.equal(saved.drawDone, true);
    assert.equal(saved.notifications.length, 2);
    assert.equal(saved.pairsGenerated.length, 2);
    assert.equal((await request()).status, 409);
    assert.deepEqual(state.party, saved);
    assert.equal(state.commits, 1);
    assert.equal(state.generations, 1);
});

const existingStates = [
    ['ancienne V2 terminee', { drawDone: true }],
    ['paires V2 seules', { pairsGenerated: [{ giverId: id(), receiverId: id() }] }],
    ['date seule', { drawDate: new Date('2025-12-01T12:00:00Z') }],
    ['identifiant V2.1 seul', { drawId: 'existing-draw' }],
    ['participants inclus seuls', { drawParticipantIds: [id()] }],
    ['notifications seules', { notifications: [{ participantId: id(), recipientEmail: 'shared@example.invalid' }] }]
];
for (const [label, party] of existingStates) {
    test(`tirage existant (${label}) : aucun nouveau candidat ni modification`, async t => {
        const { state, request } = await harness(t, { party });
        const before = clone(state.party);
        const response = await request();
        assert.equal(response.status, 409);
        assert.equal(response.body.code, 'DRAW_ALREADY_EXISTS');
        assert.deepEqual(state.party, before);
        assert.equal(state.generations, 0);
        assert.equal(state.writes.length, 0);
        assertPrivate(response, state);
        const status = await request('/api/parties/TEST21/draw/status', { method: 'GET', pin: null });
        assert.equal(status.body.status.canDraw, false);
        assertPrivate(status, state);
    });

    test(`garde atomique (${label}) : changement apres lecture refuse sans remplacement`, async t => {
        const { state, request } = await harness(t, {
            beforeLock: current => { Object.assign(current.party, clone(party)); }
        });
        const response = await request();
        assert.equal(response.status, 409);
        assert.equal(state.commits, 0);
        for (const [field, value] of Object.entries(party)) assert.deepEqual(state.party[field], value);
        assert.equal(state.party.drawId, party.drawId);
    });
}

test('ancienne V2 non tiree sans nouveaux champs : preparation autorisee', async t => {
    const { state, request } = await harness(t);
    delete state.party.drawDone;
    delete state.party.drawDate;
    delete state.party.pairsGenerated;
    assert.equal((await request()).status, 201);
    assert.equal(state.commits, 1);
});

for (const size of [0, 1]) {
    test(`${size} participant : refus avant generation ou ecriture`, async t => {
        const { state, request } = await harness(t, { size });
        assert.equal((await request()).status, 400);
        assert.equal(state.generations, 0);
        assert.equal(state.writes.length, 0);
    });
}

const invalidDraws = [
    ['tirage vide', () => []],
    ['participant absent', people => drawService.generatePairs(people.slice(0, 2))],
    ['participant etranger', people => drawService.generatePairs([people[0], people[1], { ...people[2], _id: id() }])],
    ['auto-attributions', people => people.map(person => ({ giver: person, receiver: person }))],
    ['donneur repete', people => [
        { giver: people[0], receiver: people[1] },
        { giver: people[0], receiver: people[2] },
        { giver: people[1], receiver: people[0] }
    ]],
    ['destinataire repete', people => [
        { giver: people[0], receiver: people[1] },
        { giver: people[1], receiver: people[2] },
        { giver: people[2], receiver: people[1] }
    ]]
];
for (const [label, generatePairs] of invalidDraws) {
    test(`coherence invalide (${label}) : rien n'est sauvegarde ou revele`, async t => {
        const { state, request } = await harness(t, { size: 3, generatePairs });
        const before = clone(state.party);
        const response = await request();
        assert.equal(response.status, 500);
        assert.equal(state.writes.length, 0);
        assert.deepEqual(state.party, before);
        assertPrivate(response, state);
    });
}

test('une notification invalide est rejetee par Mongoose avant appel collection', async t => {
    const { state, request } = await harness(t);
    state.participants[0].email = '';
    const before = clone(state.party);
    assert.equal((await request()).status, 500);
    assert.equal(state.writes.length, 0);
    assert.deepEqual(state.party, before);
});

test('prepare exige le PIN existant : absent 401, format 400, incorrect 403', async t => {
    const { state, request } = await harness(t);
    for (const [pin, expected] of [[null, 401], ['abc', 400], ['9999', 403]]) {
        const response = await request(undefined, { pin });
        assert.equal(response.status, expected);
        assertPrivate(response, state);
    }
    assert.equal(state.generations, 0);
    assert.equal(state.writes.length, 0);
});

test('fete inexistante : 404 sans generation', async t => {
    const { state, request } = await harness(t);
    assert.equal((await request('/api/parties/ABSENT/draw/prepare')).status, 404);
    assert.equal(state.generations, 0);
    assert.equal(state.writes.length, 0);
});

test('la limitation existante bloque la onzieme tentative de PIN', async t => {
    const { state, request } = await harness(t);
    for (let i = 0; i < 10; i++) assert.equal((await request(undefined, { pin: null })).status, 401);
    assert.equal((await request(undefined, { pin: null })).status, 429);
    assert.equal(state.writes.length, 0);
});

test('ancien draw/send neutralise pour tous, sans lecture DB ni generation', async t => {
    const { state, request } = await harness(t);
    const before = clone(state.party);
    for (const pin of [null, '1234', '9999']) {
        const response = await request('/api/parties/TEST21/draw/send', { pin, body: { adminPin: '1234' } });
        assert.equal(response.status, 410);
        assert.equal(response.body.code, 'DRAW_SEND_DISABLED');
        assertPrivate(response, state);
    }
    assert.equal(state.generations, 0);
    assert.equal(state.writes.length, 0);
    assert.deepEqual(state.party, before);
    assert.equal(state.partyReads, 0);
});

test('les deux reponses publiques restent sans paires, participants, emails ou hash', async t => {
    const { state, request } = await harness(t);
    assert.equal((await request()).status, 201);
    for (const url of ['/api/parties/TEST21', '/api/parties/TEST21/draw/status']) {
        const response = await request(url, { method: 'GET', pin: null });
        assert.equal(response.status, 200);
        assertPrivate(response, state);
    }
});

test('inscription en cours : commit avant tirage, participant inclus apres conflit et retry', { timeout: 15000 }, async t => {
    const reachedInsert = deferred();
    const releaseInsert = deferred();
    const conflict = deferred();
    t.after(() => releaseInsert.resolve());
    const { state, request } = await harness(t, {
        beforeInsert: async () => { reachedInsert.resolve(); await releaseInsert.promise; },
        onLockConflict: () => conflict.resolve()
    });
    const registration = request('/api/participants/party/TEST21', {
        pin: null, body: { name: 'ENFANT', email: 'shared@example.invalid', familyGroup: 'A' }
    });
    await reachedInsert.promise;
    assert.equal(state.participants.length, 2, 'Insertion non visible avant commit');
    const preparation = request();
    await conflict.promise;
    releaseInsert.resolve();
    assert.equal((await registration).status, 201);
    assert.equal((await preparation).status, 201);
    assert.equal(state.participants.length, 3);
    assert.equal(state.party.drawParticipantIds.length, 3);
    const child = state.participants.find(p => p.name === 'ENFANT');
    assert.ok(state.party.drawParticipantIds.some(participantId => participantId.equals(child._id)));
    assert.ok(state.party.pairsGenerated.some(pair => pair.giverId.equals(child._id)));
    assert.ok(state.party.pairsGenerated.some(pair => pair.receiverId.equals(child._id)));
    assert.equal(state.conflicts, 1);
    const late = await request('/api/participants/party/TEST21', {
        pin: null, body: { name: 'AUTRE', email: 'shared@example.invalid', familyGroup: 'B' }
    });
    assert.equal(late.status, 403);
    assert.equal(state.participants.length, 3);
});

const register = (request, name = 'ENFANT', extra = {}) => request('/api/participants/party/TEST21', {
    pin: null, body: { name, email: 'shared@example.invalid', familyGroup: 'A', ...extra }
});

test('tirage en cours : inscription concurrente refusee apres retry sans insertion', { timeout: 15000 }, async t => {
    const reachedWrite = deferred();
    const releaseWrite = deferred();
    const conflict = deferred();
    t.after(() => releaseWrite.resolve());
    const { state, request } = await harness(t, {
        beforeWrite: async () => { reachedWrite.resolve(); await releaseWrite.promise; },
        onLockConflict: () => conflict.resolve()
    });
    const preparation = request();
    await reachedWrite.promise;
    const registration = register(request);
    await conflict.promise;
    releaseWrite.resolve();
    assert.equal((await preparation).status, 201);
    assert.equal((await registration).status, 403);
    assert.equal(state.participants.length, 2);
    assert.equal(state.party.drawParticipantIds.length, 2);
    assert.equal(state.transactionCommits, 1);
});

test('deux inscriptions concurrentes pour la derniere place : 100 maximum', { timeout: 15000 }, async t => {
    const reachedInsert = deferred();
    const conflict = deferred();
    const { state, request } = await harness(t, {
        size: 99,
        beforeInsert: async () => { reachedInsert.resolve(); await conflict.promise; },
        onLockConflict: () => conflict.resolve()
    });
    const first = register(request, 'ALICE');
    await reachedInsert.promise;
    const responses = await Promise.all([first, register(request, 'BOB')]);
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 400]);
    assert.equal(state.participants.length, 100);
    assert.equal(state.transactionCommits, 1);
    assert.equal(state.conflicts, 1);
});

test('meme nom/email concurrent : une inscription, un doublon refuse apres retry', { timeout: 15000 }, async t => {
    const reachedInsert = deferred();
    const conflict = deferred();
    const { state, request } = await harness(t, {
        beforeInsert: async () => { reachedInsert.resolve(); await conflict.promise; },
        onLockConflict: () => conflict.resolve()
    });
    const first = register(request);
    await reachedInsert.promise;
    const responses = await Promise.all([first, register(request)]);
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
    assert.equal(state.participants.length, 3);
    assert.equal(state.transactionCommits, 1);
});

for (const fault of ['transientLockOnce', 'transientInsertOnce', 'transientCommitOnce']) {
    test(`inscription : ${fault}, transaction rejouee sans doublon`, async t => {
        const { state, request } = await harness(t, { [fault]: true });
        const response = await register(request);
        assert.equal(response.status, 201);
        assert.equal(state.participants.filter(p => p.name === 'ENFANT').length, 1);
        assert.equal(state.participants.length, 3);
        assert.equal(state.transactionAttempts, 2);
        assert.equal(state.transactionCommits, 1);
        assert.equal(state.party.__v, 1, 'Increment abandonne non persiste');
    });
}

for (const fault of ['transientDrawOnce', 'transientCommitOnce']) {
    test(`tirage : ${fault}, nouveau candidat mais un seul commit officiel`, async t => {
        const { state, request } = await harness(t, { [fault]: true, size: 31 });
        const response = await request();
        assert.equal(response.status, 201);
        assert.equal(state.transactionAttempts, 2);
        assert.equal(state.generations, 2);
        assert.equal(state.commits, 1);
        assert.equal(state.party.__v, 1);
        assert.equal(state.party.notifications.length, 31);
        assert.equal(state.party.pairsGenerated.length, 31);
        assert.equal(state.party.drawId, response.body.draw.drawId);
        assertPrivate(response, state);
    });
}

for (const fault of ['failInsert', 'failCommit', 'unsupportedTransactions']) {
    test(`inscription : ${fault}, aucun participant ni version partiellement enregistre`, async t => {
        const { state, request } = await harness(t, { [fault]: true });
        const before = clone(state.party);
        assert.equal((await register(request)).status, fault === 'failCommit' ? 503 : 500);
        assert.equal(state.participants.length, 2);
        assert.equal(state.transactionCommits, 0);
        assert.deepEqual(state.party, before);
    });
}

for (const fault of ['failCommit', 'unsupportedTransactions']) {
    test(`tirage : ${fault}, aucune attribution ni version partiellement enregistree`, async t => {
        const { state, request } = await harness(t, { [fault]: true });
        const before = clone(state.party);
        assert.equal((await request()).status, fault === 'failCommit' ? 503 : 500);
        assert.equal(state.commits, 0);
        assert.deepEqual(state.party, before);
    });
}

for (const operation of ['inscription', 'tirage']) {
    test(`${operation} : resultat de commit incertain, retry du commit sans rejouer le callback`, async t => {
        const { state, request } = await harness(t, { unknownCommitOnce: true });
        const response = await (operation === 'inscription' ? register(request) : request());
        assert.equal(response.status, 201);
        assert.equal(state.transactionAttempts, 1);
        assert.equal(state.transactionCommits, 1);
        assert.equal(state.commitCalls, 2);
        assert.equal(state.participants.length, operation === 'inscription' ? 3 : 2);
        assert.equal(state.generations, operation === 'tirage' ? 1 : 0);
    });
}

test('inscriptions par proches : noms distincts, email commun et wishlist conserves', async t => {
    const { state, request } = await harness(t);
    for (const name of ['ALICE', 'BOB']) {
        const response = await register(request, name, { wishList: [' Livre ', 'Jeu'] });
        assert.equal(response.status, 201);
        const saved = state.participants.find(p => p.name === name);
        assert.deepEqual(saved.wishList, ['Livre', 'Jeu']);
        assert.equal(saved.email, 'shared@example.invalid');
    }
    assert.equal((await request()).body.draw.participantCount, 4);
    assert.equal(state.party.notifications.length, 4);
});

test('inscription refusee pour toute trace d\'ancien tirage, sans modifier la fete', async t => {
    for (const [label, party] of existingStates) {
        await t.test(label, async subtest => {
            const { state, request } = await harness(subtest, { party });
            const before = clone(state.party);
            assert.equal((await register(request)).status, 403);
            assert.deepEqual(state.party, before);
            assert.equal(state.participants.length, 2);
            assert.equal(state.transactionCommits, 0);
        });
    }
});

test('aucun succes d\'inscription avant confirmation du commit', { timeout: 15000 }, async t => {
    const reachedCommit = deferred();
    const releaseCommit = deferred();
    t.after(() => releaseCommit.resolve());
    const { state, request } = await harness(t, {
        beforeCommit: async () => { reachedCommit.resolve(); await releaseCommit.promise; }
    });
    let responded = false;
    const registration = register(request).then(result => { responded = true; return result; });
    await reachedCommit.promise;
    assert.equal(responded, false);
    assert.equal(state.participants.length, 2);
    releaseCommit.resolve();
    assert.equal((await registration).status, 201);
    assert.equal(state.participants.length, 3);
});

test('inscription annulee pendant un tirage concurrent : aucun participant fantome', { timeout: 15000 }, async t => {
    const reachedInsert = deferred();
    const conflict = deferred();
    const { state, request } = await harness(t, {
        failInsert: true,
        beforeInsert: async () => { reachedInsert.resolve(); await conflict.promise; },
        onLockConflict: () => conflict.resolve()
    });
    const registration = register(request);
    await reachedInsert.promise;
    const preparation = request();
    assert.equal((await registration).status, 500);
    assert.equal((await preparation).status, 201);
    assert.equal(state.participants.length, 2);
    assert.equal(state.party.drawParticipantIds.length, 2);
    assert.equal(state.party.__v, 1);
    assert.equal(state.transactionCommits, 1);
});

test('tirage annule pendant une inscription concurrente : inscription encore possible', { timeout: 15000 }, async t => {
    const reachedWrite = deferred();
    const conflict = deferred();
    const { state, request } = await harness(t, {
        failWrite: true,
        beforeWrite: async () => { reachedWrite.resolve(); await conflict.promise; },
        onLockConflict: () => conflict.resolve()
    });
    const preparation = request();
    await reachedWrite.promise;
    const registration = register(request);
    assert.equal((await preparation).status, 500);
    assert.equal((await registration).status, 201);
    assert.equal(state.participants.length, 3);
    assert.equal(state.party.drawDone, false);
    assert.equal(state.party.drawId, undefined);
    assert.equal(state.party.__v, 1);
    assert.equal(state.commits, 0);
    assert.equal(state.transactionCommits, 1);
});

for (const operation of ['inscription', 'tirage']) {
    const invoke = request => operation === 'inscription' ? register(request) : request();
    test(`${operation} : commit persiste mais confirmation perdue, lecture exacte et aucun replay`, async t => {
        const { state, request } = await harness(t, { failAfterCommit: true });
        const response = await invoke(request);
        assert.equal(response.status, 201);
        assert.equal(response.body.outcome, 'confirmed');
        assert.equal(state.transactionAttempts, 1);
        assert.equal(state.transactionCommits, 1);
        assert.equal(state.verificationReads.length, 1);
        const { filter, settings } = state.verificationReads[0];
        assert.ok(filter._id);
        assert.equal(filter.email, undefined, 'Verification jamais par adresse partagee');
        assert.equal(settings.readPreference.mode, 'primary');
        assert.equal(settings.readConcern.level, 'majority');
        assert.equal(settings.session, null);
        assert.equal(settings.timeoutMS, 5000);
        assert.equal(settings.maxTimeMS, 5000);
        if (operation === 'tirage') {
            assert.equal(filter.drawId, response.body.draw.drawId);
            assert.equal(state.generations, 1);
        } else {
            assert.equal(String(filter._id), String(state.participants.find(p => p.name === 'ENFANT')._id));
            assert.ok(filter.partyId);
        }
    });

    for (const options of [
        { unknownBeforeCommit: true },
        { failAfterCommit: true, failVerification: true },
        { failAfterCommit: true, hideVerification: true }
    ]) {
        test(`${operation} : resultat inconnu ${JSON.stringify(options)}, 503 explicite sans replay`, async t => {
            const { state, request } = await harness(t, options);
            const response = await invoke(request);
            assert.equal(response.status, 503);
            assert.equal(response.body.outcome, 'unknown');
            assert.equal(response.body.code, 'TRANSACTION_RESULT_UNKNOWN');
            assert.equal(response.body.verificationRequired, true);
            assert.equal(response.body.retryable, false);
            assert.ok(response.body.operationId);
            assert.equal(state.transactionAttempts, 1);
            assert.equal(state.verificationReads.length, 1);
            assert.equal(state.transactionCommits, options.unknownBeforeCommit ? 0 : 1);
            assert.equal(state.participants.length,
                operation === 'inscription' && !options.unknownBeforeCommit ? 3 : 2);
            if (operation === 'tirage') assertPrivate(response, state);
        });
    }
}
