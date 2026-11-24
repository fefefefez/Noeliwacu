const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const Party = require('./Party');

// Validation/casting/serialisation uniquement : aucune connexion DB ou lecture de .env.
const objectId = () => new mongoose.Types.ObjectId();
const statuses = ['pending', 'sending', 'accepted', 'failed', 'uncertain', 'simulated'];

function legacyParty(overrides = {}) {
    return {
        _id: objectId(),
        code: 'TEST21',
        name: 'Fete de test',
        families: ['A', 'B'],
        adminPinHash: 'fixture-hash-not-a-real-pin',
        drawDone: false,
        drawDate: null,
        pairsGenerated: [],
        createdAt: new Date('2025-11-01T12:00:00Z'),
        ...overrides
    };
}

function drawParty(count = 2) {
    const ids = Array.from({ length: count }, objectId);
    return new Party(legacyParty({
        drawId: randomUUID(),
        drawParticipantIds: ids,
        drawDone: true,
        drawDate: new Date('2026-11-23T12:00:00Z'),
        pairsGenerated: ids.map((giverId, i) => ({ giverId, receiverId: ids[(i + 1) % count] })),
        notifications: ids.map(participantId => ({ participantId, recipientEmail: 'shared@example.invalid' }))
    }));
}

test('une nouvelle fete sans tirage ne genere aucun champ V2.1', async () => {
    const party = new Party(legacyParty());
    await party.validate();
    assert.equal(party.drawDone, false);
    assert.equal(party.drawDate, null);
    assert.equal(party.pairsGenerated.length, 0);
    for (const field of ['drawId', 'drawParticipantIds', 'notifications']) {
        assert.equal(party[field], undefined);
        assert.equal(Object.hasOwn(party.toObject(), field), false);
    }
});

for (const drawn of [false, true]) {
    test(`une ancienne fete hydratee reste inchangee (drawDone=${drawn})`, async () => {
        const pairs = drawn ? [{ _id: objectId(), giverId: objectId(), receiverId: objectId() }] : [];
        const raw = legacyParty({
            drawDone: drawn,
            drawDate: drawn ? new Date('2025-12-01T12:00:00Z') : null,
            pairsGenerated: pairs,
            __v: 0
        });
        const party = Party.hydrate(raw);
        const before = party.toObject();
        await party.validate();
        assert.deepEqual(party.toObject(), before);
        assert.deepEqual(party.modifiedPaths(), []);
        assert.equal(party.drawDone, raw.drawDone);
        assert.deepEqual(party.drawDate, raw.drawDate);
        assert.deepEqual(party.toObject().pairsGenerated, pairs);
        assert.equal(party.drawId, undefined);
        assert.equal(party.drawParticipantIds, undefined);
        assert.equal(party.notifications, undefined);
    });
}

test('une ancienne fete peut encore etre tiree par le controller V2', async () => {
    const party = Party.hydrate(legacyParty());
    party.pairsGenerated = [{ giverId: objectId(), receiverId: objectId() }];
    party.drawDone = true;
    party.drawDate = new Date();
    await party.validate();
    assert.equal(party.drawId, undefined);
    assert.equal(party.notifications, undefined);
});

for (const count of [2, 31, 56]) {
    test(`${count} participants partagent un email et gardent des notifications distinctes`, async () => {
        const party = drawParty(count);
        await party.validate();
        assert.equal(party.notifications.length, count);
        assert.equal(new Set(party.notifications.map(n => String(n.participantId))).size, count);
        assert.equal(new Set(party.notifications.map(n => n.recipientEmail)).size, 1);
        for (const notification of party.notifications) {
            assert.equal(notification.status, 'pending');
            assert.equal(notification.attemptCount, 0);
            assert.equal(notification.acceptedAt, undefined);
            assert.equal(notification.lastError, undefined);
            assert.deepEqual(notification.attempts.toObject(), []);
            assert.equal(notification._id, undefined);
        }
        const restored = Party.hydrate(party.toObject());
        await restored.validate();
        assert.deepEqual(restored.toObject(), party.toObject());
    });
}

for (const status of statuses) {
    test(`le statut ${status} est conserve sans toucher aux attributions`, async () => {
        const party = drawParty();
        const pairs = party.toObject().pairsGenerated;
        party.notifications[0].status = status;
        await party.validate();
        assert.equal(Party.hydrate(party.toObject()).notifications[0].status, status);
        assert.deepEqual(party.toObject().pairsGenerated, pairs);
    });
}

test('un statut inconnu ou null est refuse', () => {
    for (const status of ['delivered', 'unknown', '', null]) {
        const party = drawParty();
        party.notifications[0].status = status;
        assert.ok(party.validateSync().errors['notifications.0.status']);
    }
});

test('participantId et adresse sont requis pour chaque notification', () => {
    for (const field of ['participantId', 'recipientEmail']) {
        const party = drawParty();
        party.notifications[0][field] = undefined;
        assert.ok(party.validateSync().errors[`notifications.0.${field}`]);
    }
    const party = drawParty();
    party.notifications[0].participantId = 'invalid-object-id';
    assert.ok(party.validateSync().errors['notifications.0.participantId']);
});

test('une adresse snapshot est normalisee sans servir de cle unique', async () => {
    const party = drawParty();
    party.notifications[0].recipientEmail = ' Shared@Example.Invalid ';
    await party.validate();
    assert.equal(party.notifications[0].recipientEmail, party.notifications[1].recipientEmail);
});

test('les doublons de participants et de notifications sont refuses', () => {
    const party = drawParty();
    party.drawParticipantIds.push(party.drawParticipantIds[0]);
    assert.ok(party.validateSync().errors.drawParticipantIds);
    party.notifications.push(party.notifications[0].toObject());
    assert.ok(party.validateSync().errors.notifications);
});

test('un identifiant de tirage vide ou des tableaux null sont refuses', () => {
    const party = drawParty();
    party.drawId = '   ';
    party.drawParticipantIds = null;
    party.notifications = null;
    const errors = party.validateSync().errors;
    assert.ok(errors.drawId);
    assert.ok(errors.drawParticipantIds);
    assert.ok(errors.notifications);
});

test('le compteur de tentatives doit etre un entier positif ou nul', () => {
    for (const value of [-1, 0.5, NaN]) {
        const party = drawParty();
        party.notifications[0].attemptCount = value;
        assert.ok(party.validateSync().errors['notifications.0.attemptCount']);
    }
});

test('les tableaux refusent les entrees null au lieu de creer un suivi sans participant', () => {
    for (const field of ['drawParticipantIds', 'notifications']) {
        const party = drawParty();
        party[field].push(null);
        assert.ok(party.validateSync().errors[field]);
    }
    const party = drawParty();
    party.notifications[0].attempts.push(null);
    assert.ok(party.validateSync().errors['notifications.0.attempts']);
});

test('les champs V2.1 acceptes survivent a un aller-retour BSON sans connexion MongoDB', async () => {
    const party = drawParty();
    const acceptedAt = new Date('2026-11-23T12:03:00Z');
    party.notifications[0].set({ status: 'accepted', acceptedAt, messageId: '<accepted@example.invalid>' });
    const { serialize, deserialize } = mongoose.mongo.BSON;
    const restored = Party.hydrate(deserialize(serialize(party.toObject())));
    await restored.validate();
    assert.deepEqual(restored.toObject(), party.toObject());
    assert.deepEqual(restored.notifications[0].acceptedAt, acceptedAt);
});

test('reservation, erreur et historique survivent a la serialisation', async () => {
    const party = drawParty();
    const notification = party.notifications[0];
    const startedAt = new Date('2026-11-23T12:01:00Z');
    const error = { code: 'ETIMEDOUT', command: 'DATA', message: 'Resultat SMTP incertain', retryable: false };
    notification.set({
        status: 'uncertain', attemptCount: 1, lastAttemptAt: startedAt,
        nextAttemptAt: new Date('2026-11-23T12:05:00Z'),
        leaseToken: 'fixture-lease', leaseExpiresAt: new Date('2026-11-23T12:02:00Z'),
        messageId: '<fixture@example.invalid>', lastError: error,
        attempts: [{ attemptId: randomUUID(), status: 'uncertain', startedAt, completedAt: new Date(), error }]
    });
    await party.validate();
    assert.deepEqual(Party.hydrate(party.toObject()).toObject(), party.toObject());
    assert.equal(notification.acceptedAt, undefined);
    assert.equal(notification.lastError._id, undefined);
});

test('les tentatives exigent un identifiant unique, un debut et un statut valide', () => {
    const party = drawParty();
    const notification = party.notifications[0];
    notification.attempts = [{ status: 'pending' }];
    const errors = party.validateSync().errors;
    for (const field of ['attemptId', 'startedAt', 'status']) {
        assert.ok(errors[`notifications.0.attempts.0.${field}`]);
    }
    const attempt = { attemptId: 'same-attempt', startedAt: new Date(), status: 'sending' };
    notification.attempts = [attempt, attempt];
    assert.ok(party.validateSync().errors['notifications.0.attempts']);
});

test('aucun champ PIN en clair ou index unique sur une adresse n\'est ajoute', () => {
    assert.equal(Party.schema.path('adminPin'), undefined);
    assert.ok(Party.schema.path('adminPinHash'));
    for (const [keys, options] of Party.schema.indexes()) {
        assert.equal(options.unique && Object.keys(keys).some(key => /email/i.test(key)), false);
    }
});
