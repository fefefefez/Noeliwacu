// Replica set local temporaire uniquement. Aucun .env, MONGODB_URI, logger ou
// service SMTP. Dependances de test temporaires identiques a transactions.integration.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const Party = require('../src/models/Party');
const Participant = require('../src/models/Participant');
const { createNotificationService, NotificationPersistenceError } = require('../src/services/notificationService');
let memoryServer;
try { memoryServer = require('mongodb-memory-server-core'); }
catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    memoryServer = require(path.join(os.tmpdir(), 'noeliwacu-mongo-integration-deps/node_modules/mongodb-memory-server-core'));
}

let replSet;
let uri;
let dbName;
let clock;
let service;
const writes = [];
const now = () => new Date(clock);
const advance = milliseconds => { clock = new Date(clock.getTime() + milliseconds); };

test.before(async () => {
    assert.equal(mongoose.connection.readyState, 0);
    dbName = `noeliwacu_notifications_${randomUUID().replaceAll('-', '')}`;
    replSet = await memoryServer.MongoMemoryReplSet.create({
        binary: { version: '7.0.24', downloadDir: path.join(os.tmpdir(), 'noeliwacu-mongo-integration-binaries') },
        replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' }
    });
    uri = replSet.getUri(dbName);
    assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//);
    await mongoose.connect(uri, { dbName, monitorCommands: true, serverSelectionTimeoutMS: 5000 });
    await Promise.all([Party.init(), Participant.init()]);
    mongoose.connection.getClient().on('commandStarted', event => {
        if (event.commandName === 'findAndModify') writes.push(event.command.update);
    });
    console.log(`Notifications : MongoDB reel 7.0.24, replica set local isole ; Mongoose ${mongoose.version}.`);
}, { timeout: 240000 });

test.beforeEach(async () => {
    assert.equal(mongoose.connection.name, dbName);
    assert.match(dbName, /^noeliwacu_notifications_[a-f0-9]+$/);
    await Participant.deleteMany({});
    await Party.deleteMany({});
    writes.length = 0;
    clock = new Date('2026-11-23T12:00:00Z');
    service = createNotificationService({ now });
});

test.afterEach(() => {
    // Aucune commande du service ne peut ecrire une paire, un drawId, drawDate,
    // drawDone ou meme un autre champ racine de Party.
    for (const update of writes) {
        for (const operator of Object.keys(update)) {
            assert.ok(['$set', '$unset', '$inc', '$push'].includes(operator));
            assert.ok(Object.keys(update[operator]).every(field => field.startsWith('notifications.')));
        }
    }
});

test.after(async () => {
    try { await mongoose.disconnect(); }
    finally { if (replSet) await replSet.stop(); }
    assert.equal(require.cache[require.resolve('../src/services/emailService')], undefined);
    assert.equal(require.cache[require.resolve('nodemailer')], undefined);
    console.log('Aucun import SMTP ; replica set arrete et donnees temporaires nettoyees.');
});

async function seed(count = 2) {
    const partyId = new mongoose.Types.ObjectId();
    const participants = await Participant.insertMany(Array.from({ length: count }, (_, i) => ({
        partyId, name: `PERSONNE ${i}`, email: 'shared@example.invalid', familyGroup: i % 2 ? 'A' : 'B'
    })));
    const ids = participants.map(person => person._id);
    const party = await Party.create({
        _id: partyId, code: 'LOCAL21', name: 'Fete locale', adminPinHash: 'fixture-hash-not-a-real-pin',
        families: ['A', 'B'], drawDone: true, drawId: randomUUID(), drawDate: now(), drawParticipantIds: ids,
        pairsGenerated: ids.map((giverId, i) => ({ giverId, receiverId: ids[(i + 1) % count] })),
        notifications: ids.map(participantId => ({ participantId, recipientEmail: 'shared@example.invalid', status: 'pending' }))
    });
    const target = index => ({ partyId: party._id, drawId: party.drawId, participantId: ids[index] });
    const immutable = await Party.findById(party._id).select('-notifications').lean();
    return { party, target, ids, immutable };
}

const outcome = (reservation, status, error) => ({
    status, attemptId: reservation.attemptId, participantId: reservation.participantId,
    messageId: reservation.messageId, startedAt: reservation.startedAt, completedAt: now(), error
});
const record = (target, reservation, status, error) => service.recordResult({ ...target, attemptId: reservation.attemptId,
    result: outcome(reservation, status, error) });
async function notification(target) {
    const state = await service.getNotifications(target);
    return state.notifications.find(item => String(item.participantId) === String(target.participantId));
}
async function assertImmutable(fixture) {
    assert.deepEqual(await Party.findById(fixture.party._id).select('-notifications').lean(), fixture.immutable);
    assert.equal(await Participant.countDocuments({ partyId: fixture.party._id }), fixture.ids.length);
}

for (const count of [2, 31, 56]) {
    test(`${count} participants, email partage : reservations/resultats distincts et tirage intact`, async () => {
        const data = await seed(count);
        const reservations = await Promise.all(data.ids.map((id, i) => service.reserveNotification(data.target(i))));
        assert.ok(reservations.every(Boolean));
        assert.equal(new Set(reservations.map(item => item.attemptId)).size, count);
        assert.equal(new Set(reservations.map(item => item.participantId)).size, count);
        assert.equal(new Set(reservations.map(item => item.recipientEmail)).size, 1);
        const statuses = ['accepted', 'failed', 'uncertain', 'simulated'];
        await Promise.all(reservations.map((reservation, i) => record(data.target(i), reservation, statuses[i % 4])));
        const state = await service.getNotifications(data.target(0));
        state.notifications.forEach((item, i) => {
            assert.equal(item.status, statuses[i % 4]);
            assert.equal(item.attemptCount, 1);
            assert.equal(item.attempts.length, 1);
            assert.equal(item.attempts[0].attemptId, reservations[i].attemptId);
            assert.equal(item.attempts[0].status, item.status);
            assert.ok(item.attempts[0].completedAt instanceof Date);
            assert.equal(item.leaseToken, undefined);
            assert.equal(item.leaseExpiresAt, undefined);
            if (item.status === 'accepted') assert.deepEqual(item.acceptedAt, now());
            else assert.equal(item.acceptedAt, undefined);
        });
        await assertImmutable(data);
    });
}

test('deux clients concurrents : une seule reservation, sending et historique avant tout envoi', async t => {
    const data = await seed();
    const connection = await mongoose.createConnection(uri, { dbName }).asPromise();
    t.after(() => connection.close());
    const second = createNotificationService({ PartyModel: connection.model('Party', Party.schema.clone()), now });
    const replies = await Promise.all([service.reserveNotification(data.target(0)), second.reserveNotification(data.target(0))]);
    assert.equal(replies.filter(Boolean).length, 1);
    const reserved = replies.find(Boolean);
    const stored = await notification(data.target(0));
    assert.equal(stored.status, 'sending');
    assert.equal(stored.leaseToken, reserved.attemptId);
    assert.equal(stored.messageId, `<${reserved.attemptId}@noeliwacu.invalid>`);
    assert.equal(stored.attemptCount, 1);
    assert.equal(stored.attempts.length, 1);
    assert.equal(stored.attempts[0].status, 'sending');
    assert.deepEqual(stored.leaseExpiresAt, new Date(clock.getTime() + 120000));
    await assertImmutable(data);
});

test('une tentative ne peut etre reutilisee pour un autre participant du meme tirage', async () => {
    const data = await seed();
    const sameId = createNotificationService({ now, newAttemptId: () => 'same-attempt' });
    const replies = await Promise.all([sameId.reserveNotification(data.target(0)), sameId.reserveNotification(data.target(1))]);
    assert.equal(replies.filter(Boolean).length, 1);
    const state = await service.getNotifications(data.target(0));
    assert.equal(state.notifications.filter(item => item.status === 'pending').length, 1);
    assert.equal(state.notifications.filter(item => item.status === 'sending').length, 1);
});

test('double enregistrement concurrent : premier resultat seulement, historique non duplique', async () => {
    const data = await seed();
    const reserved = await service.reserveNotification(data.target(0));
    const results = await Promise.all([record(data.target(0), reserved, 'accepted'), record(data.target(0), reserved, 'failed')]);
    assert.equal(results.filter(Boolean).length, 1);
    const stored = await notification(data.target(0));
    assert.equal(stored.attempts.length, 1);
    assert.equal(stored.status, results.find(Boolean).status);
});

test('resultat pour mauvais participant, tentative, message ou statut refuse sans ecriture', async () => {
    const data = await seed();
    const reserved = await service.reserveNotification(data.target(0));
    const before = await notification(data.target(0));
    for (const changes of [{ participantId: String(data.ids[1]) }, { attemptId: 'foreign' },
        { messageId: '<foreign@example.invalid>' }, { status: 'pending' }, { status: 'sending' }]) {
        await assert.rejects(service.recordResult({ ...data.target(0), attemptId: reserved.attemptId,
            result: { ...outcome(reserved, 'accepted'), ...changes } }), TypeError);
    }
    assert.deepEqual(await notification(data.target(0)), before);
});

test('ancienne tentative ne peut ecraser ni une reprise failed ni sa nouvelle tentative', async () => {
    const data = await seed();
    const first = await service.reserveNotification(data.target(0));
    await record(data.target(0), first, 'failed', { code: 'EMESSAGE', responseCode: 451, retryable: true });
    assert.equal(await service.reserveNotification(data.target(0)), null, 'Aucun retry implicite de failed');
    await service.requeueNotification({ ...data.target(0), expectedStatus: 'failed', expectedAttemptId: first.attemptId, confirmed: true });
    const second = await service.reserveNotification(data.target(0));
    assert.notEqual(second.attemptId, first.attemptId);
    const before = await notification(data.target(0));
    assert.equal(await record(data.target(0), first, 'accepted'), null);
    assert.deepEqual(await notification(data.target(0)), before);
    await record(data.target(0), second, 'accepted');
    const stored = await notification(data.target(0));
    assert.deepEqual(stored.attempts.map(item => item.status), ['failed', 'accepted']);
    assert.equal(stored.attemptCount, 2);
    await assertImmutable(data);
});

test('expiration exacte : aucun resultat tardif accepte, sending devient uncertain et jamais pending', async () => {
    const data = await seed();
    const reserved = await service.reserveNotification({ ...data.target(0), leaseDurationMs: 1000 });
    advance(1000);
    assert.equal(await record(data.target(0), reserved, 'accepted'), null);
    assert.equal(await service.reserveNotification(data.target(0)), null);
    const result = await service.expireReservations(data.target(0));
    assert.equal(result.expired, 1);
    const stored = await notification(data.target(0));
    assert.equal(stored.status, 'uncertain');
    assert.equal(stored.attempts[0].status, 'uncertain');
    assert.equal(stored.lastError.code, 'LEASE_EXPIRED');
    assert.equal(stored.lastError.retryable, false);
    assert.equal(stored.leaseToken, undefined);
    assert.equal(await service.reserveNotification(data.target(0)), null);
    assert.equal(await record(data.target(0), reserved, 'accepted'), null);
    await assert.rejects(service.requeueNotification({ ...data.target(0), expectedStatus: 'uncertain',
        expectedAttemptId: reserved.attemptId, confirmed: true }), TypeError);
    await assertImmutable(data);
});

test('resultat juste avant expiration conserve, expiration ulterieure ne l\'ecrase pas', async () => {
    const data = await seed();
    const reserved = await service.reserveNotification({ ...data.target(0), leaseDurationMs: 1000 });
    advance(999);
    assert.ok(await record(data.target(0), reserved, 'accepted'));
    advance(1);
    assert.equal((await service.expireReservations(data.target(0))).expired, 0);
    assert.equal((await notification(data.target(0))).status, 'accepted');
});

test('redemarrage simule et expiration par petites demandes, sans processus permanent', async t => {
    const data = await seed(3);
    await Promise.all(data.ids.map((id, i) => service.reserveNotification({ ...data.target(i), leaseDurationMs: 1000 })));
    advance(1001);
    const connection = await mongoose.createConnection(uri, { dbName }).asPromise();
    t.after(() => connection.close());
    const restarted = createNotificationService({ PartyModel: connection.model('Party', Party.schema.clone()), now });
    assert.equal(await restarted.reserveNotification(data.target(0)), null);
    const first = await restarted.expireReservations({ ...data.target(0), limit: 1 });
    assert.deepEqual(first, { expired: 1, examined: 1, hasMore: true });
    const rest = await restarted.expireReservations(data.target(0));
    assert.equal(rest.expired, 2);
    const stored = await restarted.getNotifications(data.target(0));
    assert.ok(stored.notifications.every(item => item.status === 'uncertain' && item.attemptCount === 1 && item.attempts.length === 1));
    assert.equal((await restarted.expireReservations(data.target(0))).expired, 0);
    await assertImmutable(data);
});

test('deux recuperations concurrentes n\'expirent une reservation qu\'une seule fois', async () => {
    const data = await seed();
    await service.reserveNotification({ ...data.target(0), leaseDurationMs: 1000 });
    advance(1000);
    const replies = await Promise.all([service.expireReservations(data.target(0)), service.expireReservations(data.target(0))]);
    assert.equal(replies.reduce((sum, item) => sum + item.expired, 0), 1);
    assert.equal((await notification(data.target(0))).attempts.length, 1);
});

test('simulation : reprise explicite protegee, anciennes simulations conservees', async () => {
    const data = await seed();
    const first = await service.reserveNotification(data.target(0));
    await record(data.target(0), first, 'simulated');
    assert.equal(await service.reserveNotification(data.target(0)), null);
    const expected = { ...data.target(0), expectedStatus: 'simulated', expectedAttemptId: first.attemptId };
    await assert.rejects(service.requeueNotification(expected), TypeError);
    const replies = await Promise.all([service.requeueNotification({ ...expected, confirmed: true }),
        service.requeueNotification({ ...expected, confirmed: true })]);
    assert.equal(replies.filter(Boolean).length, 1);
    const second = await service.reserveNotification(data.target(0));
    await record(data.target(0), second, 'simulated');
    const before = await notification(data.target(0));
    assert.equal(await service.requeueNotification({ ...expected, confirmed: true }), null, 'Derniere simulation attendue obligatoire');
    assert.deepEqual(await notification(data.target(0)), before);
    assert.deepEqual(before.attempts.map(item => item.status), ['simulated', 'simulated']);
    assert.equal(before.acceptedAt, undefined);
});

test('accepted ne peut jamais etre remis en attente par cette API', async () => {
    const data = await seed();
    const reserved = await service.reserveNotification(data.target(0));
    await record(data.target(0), reserved, 'accepted');
    await assert.rejects(service.requeueNotification({ ...data.target(0), expectedStatus: 'accepted',
        expectedAttemptId: reserved.attemptId, confirmed: true }), TypeError);
    assert.equal(await service.reserveNotification(data.target(0)), null);
});

test('nextAttemptAt respecte sans timer ; seule la demande suivante fait progresser la file', async () => {
    const data = await seed();
    await Party.updateOne({ _id: data.party._id }, { $set: { 'notifications.0.nextAttemptAt': new Date(clock.getTime() + 1000) } });
    assert.equal(await service.reserveNotification(data.target(0)), null);
    advance(1000);
    assert.ok(await service.reserveNotification(data.target(0)));
});

test('erreur technique re-expurgee avant stockage, aucun payload SMTP libre', async () => {
    const data = await seed();
    const reserved = await service.reserveNotification(data.target(0));
    await record(data.target(0), reserved, 'failed', {
        code: 'EAUTH', command: 'AUTH SECRET_PASSWORD', message: 'SECRET shared@example.invalid',
        responseCode: 535, response: 'SECRET', stack: 'SECRET', cause: 'SECRET', retryable: false
    });
    const stored = await notification(data.target(0));
    assert.equal(JSON.stringify(stored.lastError).includes('SECRET'), false);
    assert.equal(JSON.stringify(stored.attempts).includes('SECRET'), false);
    assert.equal(stored.lastError.code, 'EAUTH');
    assert.equal(stored.lastError.responseCode, 535);
    assert.equal(stored.lastError.command, undefined);
});

test('ancienne fete V2 sans notifications : aucun backfill ni modification', async () => {
    const legacy = await Party.create({ code: 'LEGACY', name: 'V2', adminPinHash: 'fixture-hash', families: ['A', 'B'], drawDone: true });
    const before = await Party.findById(legacy._id).lean();
    const target = { partyId: legacy._id, drawId: 'absent', participantId: new mongoose.Types.ObjectId() };
    assert.equal(await service.reserveNotification(target), null);
    assert.equal(await service.getNotifications(target), null);
    assert.equal((await service.expireReservations(target)).expired, 0);
    assert.deepEqual(await Party.findById(legacy._id).lean(), before);
});

test('mauvais tirage et participant etranger : aucune reservation', async () => {
    const data = await seed();
    assert.equal(await service.reserveNotification({ ...data.target(0), drawId: 'another-draw' }), null);
    assert.equal(await service.reserveNotification({ ...data.target(0), participantId: new mongoose.Types.ObjectId() }), null);
    assert.ok((await service.getNotifications(data.target(0))).notifications.every(item => item.status === 'pending'));
});

test('entrees invalides refusees avant tout stockage', async () => {
    const data = await seed();
    const before = writes.length;
    for (const change of [{ partyId: 'bad' }, { participantId: 'bad' }, { drawId: '' },
        { leaseDurationMs: 0 }, { leaseDurationMs: 300001 }, { leaseDurationMs: 1500.5 }]) {
        await assert.rejects(service.reserveNotification({ ...data.target(0), ...change }), TypeError);
    }
    await assert.rejects(service.expireReservations({ ...data.target(0), limit: 0 }), TypeError);
    assert.equal(writes.length, before);
});

test('reservation commitee mais reponse perdue : erreur explicite, aucune autorisation SMTP ni nouvelle reservation', async t => {
    const data = await seed();
    const original = Party.findOneAndUpdate;
    const mocked = t.mock.method(Party, 'findOneAndUpdate', function (...args) {
        const query = original.apply(this, args);
        return { lean: async () => { await query.lean(); throw new Error('SECRET: reponse perdue'); } };
    });
    let error;
    try { await service.reserveNotification(data.target(0)); } catch (caught) { error = caught; }
    mocked.mock.restore();
    assert.ok(error instanceof NotificationPersistenceError);
    assert.equal(error.code, 'NOTIFICATION_STORAGE_UNCONFIRMED');
    assert.equal(error.operation, 'reserve');
    assert.equal(error.retryable, false);
    assert.equal(String(error).includes('SECRET'), false);
    const restarted = createNotificationService({ now });
    assert.equal(await restarted.reserveNotification(data.target(0)), null);
    const stored = await notification(data.target(0));
    assert.equal(stored.status, 'sending');
    assert.equal(stored.leaseToken, error.attemptId);
    assert.equal(stored.attempts.length, 1);
    advance(120000);
    assert.equal((await restarted.expireReservations(data.target(0))).expired, 1);
    assert.equal((await notification(data.target(0))).status, 'uncertain');
    await assertImmutable(data);
});

test('resultat commite mais reponse perdue : historique unique et aucune remise en attente', async t => {
    const data = await seed();
    const reserved = await service.reserveNotification(data.target(0));
    const original = Party.findOneAndUpdate;
    const mocked = t.mock.method(Party, 'findOneAndUpdate', function (...args) {
        const query = original.apply(this, args);
        return { lean: async () => { await query.lean(); throw new Error('SECRET: confirmation perdue'); } };
    });
    await assert.rejects(record(data.target(0), reserved, 'accepted'), error =>
        error instanceof NotificationPersistenceError && error.operation === 'complete' && error.attemptId === reserved.attemptId);
    mocked.mock.restore();
    assert.equal(await record(data.target(0), reserved, 'accepted'), null);
    assert.equal(await service.reserveNotification(data.target(0)), null);
    const stored = await notification(data.target(0));
    assert.equal(stored.status, 'accepted');
    assert.equal(stored.attempts.length, 1);
    assert.equal(stored.attempts[0].status, 'accepted');
    await assertImmutable(data);
});

test('expiration lue avant une nouvelle tentative : le snapshot ancien ne peut pas l\'ecraser', { timeout: 10000 }, async t => {
    const data = await seed();
    const first = await service.reserveNotification({ ...data.target(0), leaseDurationMs: 1000 });
    const recovering = createNotificationService({ now: () => new Date(clock.getTime() + 1000) });
    let reached;
    let release;
    const snapshotRead = new Promise(resolve => { reached = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    t.after(() => release());
    const original = Party.findOne;
    let held = false;
    t.mock.method(Party, 'findOne', function (...args) {
        const query = original.apply(this, args);
        const exec = query.exec;
        query.exec = async function (...execArgs) {
            const document = await exec.apply(this, execArgs);
            if (!held) { held = true; reached(); await gate; }
            return document;
        };
        return query;
    });
    const expiration = recovering.expireReservations(data.target(0));
    await snapshotRead;
    // L'horloge du traitement original est encore avant l'echeance : il termine
    // et une action explicite reserve une nouvelle tentative pendant la pause.
    await record(data.target(0), first, 'failed');
    await service.requeueNotification({ ...data.target(0), expectedStatus: 'failed', expectedAttemptId: first.attemptId, confirmed: true });
    const second = await service.reserveNotification(data.target(0));
    release();
    assert.equal((await expiration).expired, 0);
    const stored = await notification(data.target(0));
    assert.equal(stored.status, 'sending');
    assert.equal(stored.leaseToken, second.attemptId);
    assert.deepEqual(stored.attempts.map(item => item.status), ['failed', 'sending']);
    await assertImmutable(data);
});
