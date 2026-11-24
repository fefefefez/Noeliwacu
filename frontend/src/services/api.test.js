import { prepareDraw, getNotifications, sendNotification, addAdminParticipant, updateAdminParticipant, deleteAdminParticipant } from './api';

beforeEach(() => { global.fetch = jest.fn(); });
afterEach(() => { jest.useRealTimers(); delete global.fetch; });

test('inscriptions admin : bons verbes, PIN dans le header et conservation du résultat inconnu', async () => {
    const entry = { name: 'Alice', email: 'alice@example.invalid', familyGroup: 'A', wishList: [] };
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, outcome: 'confirmed' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, outcome: 'confirmed' }) })
        .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ success: false, outcome: 'unknown', verificationRequired: true }) });
    await addAdminParticipant('TEST21', '1234', entry);
    await updateAdminParticipant('TEST21', '1234', 'p1', entry);
    await expect(deleteAdminParticipant('TEST21', '1234', 'p1')).rejects.toMatchObject({ status: 503, outcome: 'unknown', verificationRequired: true });
    expect(fetch.mock.calls.map(([url, options]) => [url.split('/api')[1], options.method])).toEqual([
        ['/participants/party/TEST21/admin', 'POST'], ['/participants/party/TEST21/admin/p1', 'PATCH'],
        ['/participants/party/TEST21/admin/p1', 'DELETE']
    ]);
    for (const [url, options] of fetch.mock.calls) {
        expect(url).not.toContain('1234');
        expect(options.headers['X-Admin-Pin']).toBe('1234');
        expect(options.body).toBe(options.method === 'DELETE' ? undefined : JSON.stringify(entry));
    }
});

test('prepare utilise exclusivement POST /draw/prepare avec PIN dans le header', async () => {
    fetch.mockResolvedValue({ ok: true, status: 201, json: async () => ({ success: true, outcome: 'confirmed' }) });
    await prepareDraw('TEST21', '1234');
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/parties\/TEST21\/draw\/prepare$/);
    expect(url).not.toContain('1234');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'X-Admin-Pin': '1234' });
    expect(options.body).toBeUndefined();
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(fetch).toHaveBeenCalledTimes(1);
});

test('notifications : lecture GET authentifiee sans cache, aucun envoi', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, counts: {} }) });
    await getNotifications('TEST21', '1234');
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/draw\/notifications$/), expect.objectContaining({
        method: 'GET', cache: 'no-store', headers: { 'X-Admin-Pin': '1234' }
    }));
});

for (const [status, outcome] of [[409, 'rejected'], [503, 'unknown']]) {
    test(`conserve HTTP ${status} et outcome ${outcome} sans retry`, async () => {
        fetch.mockResolvedValue({ ok: false, status, json: async () => ({ success: false, outcome,
            code: 'SAFE_CODE', verificationRequired: outcome === 'unknown', message: 'PRIVATE_SERVER_TEXT' }) });
        await expect(prepareDraw('TEST21', '1234')).rejects.toMatchObject({ status, outcome, code: 'SAFE_CODE' });
        expect(fetch).toHaveBeenCalledTimes(1);
    });
}

test('perte reseau : erreur propagee sans nouvelle requete', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(prepareDraw('TEST21', '1234')).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
});

test('timeout client : veritable AbortSignal, aucune repetition du POST', async () => {
    jest.useFakeTimers();
    fetch.mockImplementation((url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const result = prepareDraw('TEST21', '1234');
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    jest.advanceTimersByTime(20000);
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
});

test('envoi cible : POST unique, identifiant encode, PIN uniquement dans le header', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, participantId: 'p1', status: 'simulated' }) });
    await sendNotification('TEST21', '1234', 'p1');
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/draw\/notifications\/p1\/send$/);
    expect(url).not.toContain('1234');
    expect(options).toMatchObject({ method: 'POST', headers: { 'X-Admin-Pin': '1234' } });
    expect(options.body).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
});

test('envoi : le budget client ne coupe pas a 20 s la route serveur de 24 s', async () => {
    jest.useFakeTimers();
    let signal;
    fetch.mockImplementation((url, options) => new Promise((resolve, reject) => {
        signal = options.signal;
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const pending = sendNotification('TEST21', '1234', 'p1');
    const check = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    jest.advanceTimersByTime(24000);
    expect(signal.aborted).toBe(false);
    jest.advanceTimersByTime(11000);
    await check;
    expect(fetch).toHaveBeenCalledTimes(1);
});
