import { createNotificationDistribution, isValidNotificationSnapshot } from './notificationDistribution';

const states = ['pending', 'sending', 'accepted', 'failed', 'uncertain', 'simulated'];
function snapshot(rows) {
    return { success: true, trackingAvailable: true,
        counts: { total: rows.length, ...Object.fromEntries(states.map(s => [s, rows.filter(n => n.status === s).length])) },
        notifications: rows.map(n => ({ ...n })) };
}
function fixture(count = 2, overrides = {}) {
    const rows = Array.from({ length: count }, (_, i) => ({ participantId: `p${i}`, status: 'pending', attemptCount: 0,
        recipientEmail: 'shared@example.invalid' }));
    const blocked = new Set();
    const onSnapshot = jest.fn(value => {
        for (const row of value.notifications) if (row.status !== 'pending') blocked.delete(row.participantId);
    });
    const read = jest.fn(async () => snapshot(rows));
    const send = jest.fn(async id => {
        const row = rows.find(n => n.participantId === id);
        row.status = 'accepted'; row.attemptCount++;
        return { success: true, participantId: id, status: row.status };
    });
    const options = { read, send, onSnapshot, onProgress: jest.fn(),
        beforeSend: jest.fn(id => { blocked.add(id); return true; }), isBlocked: id => blocked.has(id), ...overrides };
    return { rows, blocked, read, send, options, sequence: createNotificationDistribution(options) };
}
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
async function next() { jest.advanceTimersByTime(6100); await flush(); }
beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

for (const count of [2, 31, 56]) {
    test(`${count} notifications partageant une adresse : demandes sequentielles, cadence et compteurs MongoDB`, async () => {
        const f = fixture(count);
        let active = 0, max = 0;
        const original = f.options.send;
        f.options.send = jest.fn(async id => {
            active++; max = Math.max(max, active);
            await Promise.resolve();
            const value = await original(id);
            active--;
            return value;
        });
        const sequence = createNotificationDistribution(f.options);
        const result = sequence.run(); await flush();
        expect(f.send).not.toHaveBeenCalled();
        for (let i = 0; i < count; i++) {
            jest.advanceTimersByTime(6099); await flush();
            expect(f.send).toHaveBeenCalledTimes(i);
            jest.advanceTimersByTime(1); await flush();
            expect(f.send).toHaveBeenCalledTimes(i + 1);
        }
        expect(await result).toEqual({ reason: 'completed', attempted: count });
        expect(max).toBe(1);
        expect(new Set(f.send.mock.calls.map(([id]) => id)).size).toBe(count);
        expect(f.options.onSnapshot.mock.calls.at(-1)[0].counts.accepted).toBe(count);
        expect(f.blocked.size).toBe(0);
    });
}

test('pause pendant SMTP : aucun abort, attente du resultat et reprise manuelle des seuls pending', async () => {
    const f = fixture(3);
    let resolve;
    f.options.send = jest.fn(id => new Promise(done => { resolve = () => {
        const row = f.rows.find(n => n.participantId === id); row.status = 'accepted'; row.attemptCount++;
        done({ success: true, participantId: id, status: 'accepted' });
    }; }));
    const sequence = createNotificationDistribution(f.options);
    const pending = sequence.run(); await flush(); await next();
    sequence.pause();
    await next();
    expect(f.options.send).toHaveBeenCalledTimes(1);
    expect(f.rows[0].status).toBe('pending'); // Pas de confirmation inventee.
    resolve(); await flush();
    expect(await pending).toEqual({ reason: 'paused', attempted: 1 });
    f.options.send = f.send;
    const resumed = createNotificationDistribution(f.options).run(); await flush(); await next(); await next();
    expect((await resumed).attempted).toBe(2);
    expect(f.send.mock.calls.map(([id]) => id)).toEqual(['p1', 'p2']);
});

test('pause pendant la cadence : timer libere et aucun POST', async () => {
    const f = fixture(); const result = f.sequence.run(); await flush();
    f.sequence.pause(); await flush();
    expect(await result).toEqual({ reason: 'paused', attempted: 0 });
    expect(jest.getTimerCount()).toBe(0);
    expect(f.send).not.toHaveBeenCalled();
});

test('statuts existants exclus, failed et simulated confirmes ne sont jamais retentes', async () => {
    const f = fixture(8);
    states.slice(1).forEach((status, i) => { f.rows[i].status = status; });
    f.options.send = jest.fn(async id => {
        const row = f.rows.find(n => n.participantId === id);
        row.status = id === 'p5' ? 'failed' : 'simulated'; row.attemptCount++;
        return { success: true, participantId: id, status: row.status };
    });
    const result = createNotificationDistribution(f.options).run(); await flush();
    for (let i = 0; i < 3; i++) await next();
    expect((await result).reason).toBe('completed');
    expect(f.options.send.mock.calls.map(([id]) => id)).toEqual(['p5', 'p6', 'p7']);
});

for (const committed of [true, false]) {
    test(`reponse perdue, accepte persiste=${committed} : arret et relecture, aucun second POST`, async () => {
        const f = fixture();
        f.options.send = jest.fn(async id => {
            if (committed) f.rows[0].status = 'accepted';
            throw new TypeError('Network loss');
        });
        const result = createNotificationDistribution(f.options).run(); await flush(); await next();
        expect((await result).reason).toBe('unconfirmed');
        await next();
        expect(f.options.send).toHaveBeenCalledTimes(1);
        expect(f.read).toHaveBeenCalledTimes(3);
        expect(f.blocked.has('p0')).toBe(!committed);
    });
}

test('uncertain apres SMTP : arret immediat, pas de passage au participant suivant', async () => {
    const f = fixture();
    f.options.send = jest.fn(async id => {
        f.rows[0].status = 'uncertain';
        return { success: true, participantId: id, status: 'uncertain' };
    });
    const result = createNotificationDistribution(f.options).run(); await flush(); await next();
    expect((await result).reason).toBe('uncertain');
    expect(f.options.send).toHaveBeenCalledTimes(1);
});

for (const response of [{ success: false, outcome: 'unknown' }, { success: true, status: 'accepted', verificationRequired: true },
    { success: true, status: 'sending' }, { success: true, status: 'accepted', participantId: 'another' }]) {
    test(`resultat non confirme ${JSON.stringify(response)} : aucun enchainement`, async () => {
        const f = fixture(); f.options.send = jest.fn(async id => ({ participantId: id, ...response }));
        const result = createNotificationDistribution(f.options).run(); await flush(); await next();
        expect((await result).reason).toBe('unconfirmed');
        expect(f.options.send).toHaveBeenCalledTimes(1);
    });
}

test('MongoDB non relisible apres SMTP : compteur non invente et marqueur conserve', async () => {
    const f = fixture(); f.read.mockImplementationOnce(async () => snapshot(f.rows))
        .mockImplementationOnce(async () => snapshot(f.rows)).mockRejectedValue(new Error());
    const result = f.sequence.run(); await flush(); await next();
    expect((await result).reason).toBe('readFailed');
    expect(f.options.onSnapshot.mock.calls.at(-1)[0].counts.accepted).toBe(0);
    expect(f.blocked.has('p0')).toBe(true);
});

test('un autre administrateur traite une ligne pendant la cadence : elle est ignoree', async () => {
    const f = fixture(); const result = f.sequence.run(); await flush();
    f.rows[0].status = 'accepted';
    await next();
    expect((await result).reason).toBe('completed');
    expect(f.send.mock.calls.map(([id]) => id)).toEqual(['p1']);
});

test('une reservation devient uncertain pendant la sequence : arret avant tout POST', async () => {
    const f = fixture(3); f.rows[0].status = 'sending';
    const result = f.sequence.run(); await flush(); f.rows[0].status = 'uncertain'; await next();
    expect((await result).reason).toBe('uncertain'); expect(f.send).not.toHaveBeenCalled();
});

test('429 : pas de retry automatique, suivi relu', async () => {
    const f = fixture(); f.options.send = jest.fn(async () => { throw Object.assign(new Error(), { status: 429 }); });
    const result = createNotificationDistribution(f.options).run(); await flush(); await next();
    expect((await result).reason).toBe('rateLimited'); expect(f.options.send).toHaveBeenCalledTimes(1);
});

test('429 identifie comme refus avant SMTP : reprise manuelle possible, sans retry dans la sequence', async () => {
    const f = fixture();
    f.options.send = jest.fn(async () => { throw Object.assign(new Error(), { status: 429, code: 'NOTIFICATION_RATE_LIMITED' }); });
    f.options.onNotSent = jest.fn(id => f.blocked.delete(id));
    const result = createNotificationDistribution(f.options).run(); await flush(); await next();
    expect((await result).reason).toBe('rateLimited');
    expect(f.options.onNotSent).toHaveBeenCalledWith('p0');
    expect(f.blocked.size).toBe(0);
    expect(f.options.send).toHaveBeenCalledTimes(1);
});

test('snapshot nul, lignes dupliquees ou compteurs incoherents : non eligibles', () => {
    const f = fixture();
    expect(isValidNotificationSnapshot({ ...snapshot(f.rows), notifications: [null, f.rows[1]] })).toBe(false);
    expect(isValidNotificationSnapshot(snapshot([f.rows[0], f.rows[0]]))).toBe(false);
    expect(isValidNotificationSnapshot({ ...snapshot(f.rows), counts: { ...snapshot(f.rows).counts, accepted: 99 } })).toBe(false);
    expect(isValidNotificationSnapshot({ ...snapshot(f.rows), trackingAvailable: false })).toBe(false);
});

test('sortie de page pendant SMTP : aucun travail supplementaire, marqueur pour la prochaine ouverture', async () => {
    const f = fixture(); let resolve; let active = true;
    f.options.send = jest.fn(() => new Promise(done => { resolve = done; }));
    const sequence = createNotificationDistribution({ ...f.options, isActive: () => active });
    const pending = sequence.run(); await flush(); await next();
    active = false; sequence.pause(); resolve({ success: true, participantId: 'p0', status: 'accepted' }); await flush();
    expect((await pending).reason).toBe('paused');
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(f.blocked.has('p0')).toBe(true);
});

test('stockage indisponible, reconciliation restante ou snapshot incoherent : aucun POST', async () => {
    const f = fixture(2, { beforeSend: () => false });
    let result = f.sequence.run(); await flush(); await next();
    expect((await result).reason).toBe('storage');
    f.read.mockResolvedValue({ ...snapshot(f.rows), reconciliationPending: true });
    result = createNotificationDistribution(f.options).run(); await flush();
    expect((await result).reason).toBe('reconciliation');
    f.read.mockResolvedValue({ ...snapshot(f.rows), counts: { total: 999 } });
    result = createNotificationDistribution(f.options).run(); await flush();
    expect((await result).reason).toBe('readFailed'); expect(f.send).not.toHaveBeenCalled();
    expect(isValidNotificationSnapshot({ trackingAvailable: false })).toBe(false);
});
