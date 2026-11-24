const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const net = require('node:net');
const { setTimeout: delay } = require('node:timers/promises');
const { createRequire } = require('node:module');
const nodemailer = require('nodemailer');

// Aucun .env ou credential reel. Le processus du module recoit un env fictif
// et les acces EMAIL/APP_PASS sont interdits dans ces tests.
function loadService(testMode = false) {
    const filename = path.join(__dirname, 'emailService.js');
    const localRequire = createRequire(filename);
    const logs = [];
    const logger = { info: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args) };
    const env = new Proxy({}, {
        get(target, key) {
            if (key === 'TEST_MODE') return testMode ? 'true' : 'false';
            throw new Error('Lecture de credentials interdite dans les tests.');
        }
    });
    const module = { exports: {} };
    vm.compileFunction(fs.readFileSync(filename, 'utf8'), ['require', 'module', 'exports', 'process'], { filename })(
        name => {
            if (name === '../../logs/logger') return logger;
            if (name === 'nodemailer') return { createTransport() { throw new Error('SMTP externe interdit.'); } };
            return localRequire(name);
        }, module, module.exports, { env });
    return { api: module.exports, logs };
}

function fixture(count = 2) {
    const people = Array.from({ length: count }, (_, i) => ({
        _id: `participant-${i}`, name: `DONNEUR ${i}`, email: 'shared@example.invalid',
        wishList: [`SOUHAIT ${i}`]
    }));
    return {
        pairs: people.map((giver, i) => ({ giver, receiver: people[(i + 1) % count] })),
        party: { name: 'Noel famille', budget: 25, date: new Date('2026-12-25T12:00:00Z') }
    };
}

function fakeService({ handler, config = { user: 'sender@example.invalid', pass: 'FICTITIOUS_PASSWORD' }, testMode = false } = {}) {
    const { api, logs } = loadService(testMode);
    const calls = [];
    const transports = [];
    let closes = 0;
    let tick = Date.UTC(2026, 10, 23, 12);
    const service = api.createEmailService({
        getConfig: () => config,
        now: () => new Date(tick += 100),
        createTransport(options) {
            transports.push(options);
            return {
                async sendMail(mail) {
                    calls.push(mail);
                    if (handler) return handler(mail, calls.length);
                    return { accepted: [mail.envelope.to[0]], rejected: [], messageId: mail.messageId };
                },
                close() { closes++; }
            };
        }
    });
    return { api, service, calls, transports, logs, closes: () => closes };
}

for (const count of [2, 31, 56]) {
    test(`${count} participants, email commun : un appel par personne, un transport et aucune duplication`, async () => {
        const { service, calls, transports, logs } = fakeService();
        const { pairs, party } = fixture(count);
        const result = await service.sendAllEmails(pairs, party);
        assert.equal(result.accepted, count);
        assert.equal(result.sent, count);
        assert.equal(result.failed + result.uncertain + result.simulated, 0);
        assert.equal(calls.length, count);
        assert.equal(transports.length, 1);
        assert.equal(new Set(result.attempts.map(attempt => attempt.participantId)).size, count);
        assert.equal(new Set(result.attempts.map(attempt => attempt.attemptId)).size, count);
        assert.equal(new Set(calls.map(mail => mail.messageId)).size, count);
        assert.equal(new Set(calls.map(mail => mail.envelope.to[0])).size, 1);
        for (let i = 0; i < count; i++) {
            const attempt = result.attempts[i];
            assert.equal(attempt.status, 'accepted');
            assert.equal(attempt.success, true);
            assert.equal(attempt.messageId, calls[i].messageId);
            assert.equal(attempt.participantId, pairs[i].giver._id);
            assert.ok(attempt.startedAt < attempt.completedAt);
            assert.equal(attempt.acceptedAt, attempt.completedAt);
            assert.ok(calls[i].subject.includes(pairs[i].giver.name));
            assert.ok(calls[i].html.includes(pairs[i].receiver.name));
            assert.ok(calls[i].html.includes(pairs[i].receiver.wishList[0]));
            assert.equal(calls[i].envelope.to.length, 1);
        }
        const trace = JSON.stringify(logs);
        for (const privateValue of ['shared@', 'DONNEUR', 'SOUHAIT', 'FICTITIOUS_PASSWORD', 'participant-']) {
            assert.equal(trace.includes(privateValue), false);
        }
    });
}

test('options du pool : concurrence 1, aucun requeue, timeouts explicites et logs SMTP desactives', async () => {
    const { service, transports } = fakeService();
    const { pairs, party } = fixture();
    await service.sendSecretSantaEmail(pairs[0].giver, pairs[0].receiver, party);
    const options = transports[0];
    assert.equal(options.pool, true);
    assert.equal(options.maxConnections, 1);
    assert.equal(options.maxMessages, 100);
    assert.equal(options.maxRequeues, 0);
    assert.equal(options.rateLimit, 1);
    assert.equal(options.rateDelta, 1000);
    assert.equal(options.dnsTimeout, 5000);
    assert.equal(options.connectionTimeout, 10000);
    assert.equal(options.greetingTimeout, 10000);
    assert.equal(options.socketTimeout, 15000);
    for (const field of ['logger', 'debug', 'transactionLog']) assert.equal(options[field], false);
    assert.equal(options.disableFileAccess, true);
    assert.equal(options.disableUrlAccess, true);
    assert.equal(options.tls?.rejectUnauthorized, undefined, 'Pas de desactivation de la verification TLS');
});

const failures = [
    [{ code: 'EMESSAGE', command: 'DATA', responseCode: 550 }, 'failed', false],
    [{ code: 'EMESSAGE', command: 'DATA', responseCode: 451 }, 'failed', true],
    [{ code: 'EAUTH', command: 'AUTH PLAIN', responseCode: 535 }, 'failed', false],
    [{ code: 'EENVELOPE', command: 'RCPT TO', responseCode: 550 }, 'failed', false],
    [{ code: 'EDNS' }, 'failed', true],
    [{ code: 'ECONNREFUSED' }, 'failed', true],
    [{ code: 'ETIMEDOUT', command: 'DATA' }, 'uncertain', false],
    [{ code: 'ETIMEDOUT', command: 'CONN' }, 'uncertain', false],
    [{ code: 'ECONNECTION', command: 'CONN' }, 'uncertain', false],
    [{ code: 'ECONNRESET' }, 'uncertain', false],
    [{ code: 'ESOCKET' }, 'uncertain', false],
    [{}, 'uncertain', false]
];
for (const [error, status, retryable] of failures) {
    test(`${error.code ?? 'erreur inconnue'} / ${error.responseCode ?? error.command ?? 'sans phase'} : ${status}`, async () => {
        const { service, calls, logs } = fakeService({ handler: () => {
            throw Object.assign(new Error('SECRET shared@example.invalid DONNEUR'), error, {
                response: '550 SECRET shared@example.invalid', stack: 'SECRET', cause: 'SECRET'
            });
        } });
        const { pairs, party } = fixture();
        const result = await service.sendSecretSantaEmail(pairs[0].giver, pairs[0].receiver, party);
        assert.equal(result.status, status);
        assert.equal(result.success, false);
        assert.equal(result.error.retryable, retryable);
        assert.equal(result.acceptedAt, undefined);
        assert.equal(calls.length, 1, 'Aucune reprise automatique');
        assert.equal(JSON.stringify({ result, logs }).includes('SECRET'), false);
        assert.equal(JSON.stringify(result).includes('shared@example.invalid'), false);
        assert.equal(result.error.response, undefined);
        assert.equal(result.error.stack, undefined);
    });
}

test('resultats SMTP incomplets/contradictoires ne deviennent jamais des succes', async () => {
    for (const info of [undefined, {}, { accepted: [] }, { accepted: ['other@example.invalid'] },
        { accepted: ['shared@example.invalid'], rejected: ['shared@example.invalid'] },
        { accepted: ['shared@example.invalid'], pending: ['shared@example.invalid'] }]) {
        const { service } = fakeService({ handler: () => info });
        const { pairs, party } = fixture();
        const result = await service.sendSecretSantaEmail(pairs[0].giver, pairs[0].receiver, party);
        assert.equal(result.status, 'uncertain');
    }
});

test('destinataire explicitement rejete dans info : echec confirme', async () => {
    const { service } = fakeService({ handler: () => ({
        accepted: [], rejected: ['shared@example.invalid'], rejectedErrors: [{ responseCode: 450 }]
    }) });
    const { pairs, party } = fixture();
    const result = await service.sendSecretSantaEmail(pairs[0].giver, pairs[0].receiver, party);
    assert.equal(result.status, 'failed');
    assert.equal(result.error.responseCode, 450);
    assert.equal(result.error.retryable, true);
});

test('erreurs expurgees : pas de texte libre dans code ou commande', async () => {
    const { service, logs } = fakeService({ handler: () => {
        throw { code: 'SECRET_CODE', command: 'AUTH SECRET_PASSWORD', message: 'SECRET', response: 'SECRET' };
    } });
    const { pairs, party } = fixture();
    const result = await service.sendSecretSantaEmail(pairs[0].giver, pairs[0].receiver, party);
    assert.equal(result.error.code, 'SMTP_ERROR');
    assert.equal(result.error.command, 'AUTH');
    assert.equal(JSON.stringify({ result, logs }).includes('SECRET'), false);
});

for (const count of [2, 31, 56]) {
    test(`TEST_MODE : ${count} simulations, zero acceptation et zero transport`, async () => {
        const { service, calls, transports } = fakeService({ config: { testMode: true } });
        const { pairs, party } = fixture(count);
        const result = await service.sendAllEmails(pairs, party);
        assert.equal(result.simulated, count);
        assert.equal(result.accepted, 0);
        assert.equal(result.sent, 0);
        assert.equal(transports.length, 0);
        assert.equal(calls.length, 0);
        assert.ok(result.attempts.every(attempt => attempt.status === 'simulated' && !attempt.success && !attempt.acceptedAt));
    });
}

test('TEST_MODE par defaut fonctionne sans lire EMAIL/APP_PASS', async () => {
    const { api } = loadService(true);
    const { pairs, party } = fixture();
    const result = await api.sendAllEmails(pairs, party);
    assert.equal(result.simulated, 2);
    assert.equal(result.sent, 0);
});

test('lot mixte : compteurs reels, echecs et incertains distincts', async () => {
    const { service, calls } = fakeService({ handler: (mail, count) => {
        if (count === 2) throw { code: 'EMESSAGE', responseCode: 550, command: 'DATA' };
        if (count === 3) throw { code: 'ETIMEDOUT', command: 'CONN' };
        return { accepted: mail.envelope.to, rejected: [], messageId: mail.messageId };
    } });
    const { pairs, party } = fixture(4);
    const result = await service.sendAllEmails(pairs, party);
    assert.deepEqual([result.accepted, result.failed, result.uncertain, result.simulated, result.sent], [2, 1, 1, 0, 2]);
    assert.equal(calls.length, 4);
});

test('contenu preserve et echappe ; aucune injection de header via les noms', async () => {
    const { service, calls } = fakeService();
    const giver = { _id: 'child', name: 'ALICE\r\nBcc: secret@example.invalid', email: 'shared@example.invalid' };
    const receiver = { name: '<script>Bob & Co</script>', wishList: ['<img src=x onerror=alert(1)>', 'Livre & jeu'] };
    await service.sendSecretSantaEmail(giver, receiver, { name: '<Noel>\nFamille', budget: '<b>25</b>', date: '2026-12-25' });
    const mail = calls[0];
    assert.equal(/[\r\n]/.test(mail.subject), false);
    assert.equal(/[\r\n]/.test(mail.to.name), false);
    assert.deepEqual(mail.envelope.to, ['shared@example.invalid']);
    for (const text of ['&lt;script&gt;', '&lt;img', 'Livre &amp; jeu', '&lt;Noel&gt;', '&lt;b&gt;25&lt;/b&gt;', 'Budget suggéré', '2026', 'Cet email est destiné', 'Garde le secret']) {
        assert.ok(mail.html.includes(text), text);
    }
    assert.equal(mail.html.includes('<script>'), false);
    assert.equal(mail.html.includes('<img'), false);
    assert.equal(mail.html.includes('<b>25</b>'), false);
});

test('sans wishlist : message alternatif conserve', async () => {
    const { service, calls } = fakeService();
    const { pairs, party } = fixture();
    pairs[0].receiver.wishList = [];
    await service.sendSecretSantaEmail(pairs[0].giver, pairs[0].receiver, party);
    assert.ok(calls[0].html.includes('pas encore indiqué de Wishlist'));
});

test('identifiant de tentative fourni par la future file conserve sans exposer de donnees', async () => {
    const { service, calls } = fakeService();
    const { pairs, party } = fixture();
    const result = await service.sendSecretSantaEmail(pairs[0].giver, pairs[0].receiver, party, { attemptId: 'attempt-123' });
    assert.equal(result.attemptId, 'attempt-123');
    assert.equal(result.messageId, '<attempt-123@noeliwacu.invalid>');
    assert.equal(calls[0].messageId, result.messageId);
});

test('lot contenant deux fois le meme participant refuse avant tout envoi', async () => {
    const { service, calls, transports } = fakeService();
    const { pairs, party } = fixture();
    await assert.rejects(service.sendAllEmails([pairs[0], pairs[0]], party), /une seule fois/);
    assert.equal(calls.length, 0);
    assert.equal(transports.length, 0);
});

test('donnees invalides ou configuration absente : echec local sans SMTP', async () => {
    const { pairs, party } = fixture();
    for (const email of ['x@example.invalid,other@example.invalid', 'x@example.invalid\r\nBcc:x@y.invalid', '']) {
        const { service, calls } = fakeService();
        const result = await service.sendSecretSantaEmail({ ...pairs[0].giver, email }, pairs[0].receiver, party);
        assert.equal(result.status, 'failed');
        assert.equal(result.error.code, 'EINPUT');
        assert.equal(calls.length, 0);
    }
    const { service, transports } = fakeService({ config: {} });
    assert.equal((await service.sendSecretSantaEmail(pairs[0].giver, pairs[0].receiver, party)).error.code, 'ECONFIG');
    assert.equal(transports.length, 0);
});

test('fermeture explicite : plus aucun envoi ni creation de nouveau pool', async () => {
    const { service, calls, transports, closes } = fakeService();
    const { pairs, party } = fixture();
    await service.sendSecretSantaEmail(pairs[0].giver, pairs[0].receiver, party);
    service.close();
    const result = await service.sendSecretSantaEmail(pairs[1].giver, pairs[1].receiver, party);
    assert.equal(result.status, 'failed');
    assert.equal(result.error.code, 'ESHUTDOWN');
    assert.equal(closes(), 1);
    assert.equal(transports.length, 1);
    assert.equal(calls.length, 1);
});

// Faux serveur SMTP local : il collecte puis oublie les messages, sans relais,
// DNS externe, TLS externe ou authentification. Nodemailer et son pool sont reels.
async function smtpSimulator(t, mode = 'accept') {
    const sockets = new Set();
    const messages = [];
    let connections = 0;
    let maxConnections = 0;
    const server = net.createServer(socket => {
        connections++;
        sockets.add(socket);
        maxConnections = Math.max(maxConnections, sockets.size);
        socket.setNoDelay(true);
        socket.on('error', () => {});
        socket.on('close', () => sockets.delete(socket));
        socket.write('220 localhost test SMTP\r\n');
        let buffer = '';
        let data = null;
        socket.on('data', chunk => {
            buffer += chunk.toString();
            while (buffer.includes('\r\n')) {
                const end = buffer.indexOf('\r\n');
                const line = buffer.slice(0, end);
                buffer = buffer.slice(end + 2);
                if (data) {
                    if (line !== '.') { data.push(line); continue; }
                    messages.push(data.join('\r\n'));
                    data = null;
                    if (mode === 'disconnect') { socket.destroy(); return; }
                    if (mode === 'stall' || mode === 'abort') continue; // Aucun acquittement DATA.
                    socket.write(mode === 'reject' ? '550 message refused\r\n' : '250 message accepted\r\n');
                } else if (/^EHLO|^HELO/.test(line)) socket.write('250 localhost\r\n');
                else if (/^MAIL FROM:|^RCPT TO:|^RSET/.test(line)) socket.write('250 OK\r\n');
                else if (line === 'DATA') { data = []; socket.write('354 send data\r\n'); }
                else if (line === 'QUIT') { socket.end('221 bye\r\n'); }
                else socket.write('500 unsupported\r\n');
            }
        });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    t.after(() => new Promise(resolve => {
        for (const socket of sockets) socket.destroy();
        server.close(resolve);
    }));
    return { port: server.address().port, messages, connections: () => connections, activeConnections: () => sockets.size, maxConnections: () => maxConnections,
        disconnectIdle() { for (const socket of sockets) socket.destroy(); }
    };
}

async function localPool(t, mode) {
    const smtp = await smtpSimulator(t, mode);
    const { api } = loadService();
    const service = api.createEmailService({
        getConfig: () => ({ user: 'sender@example.invalid', pass: 'DUMMY_NOT_USED_BY_LOCAL_SMTP' }),
        createTransport: options => nodemailer.createTransport({
            ...options, service: undefined, host: '127.0.0.1', port: smtp.port,
            secure: false, ignoreTLS: true, auth: undefined, rateLimit: 0,
            ...(mode === 'stall' ? { socketTimeout: 75 } : {}),
            ...(mode === 'abort' ? { socketTimeout: 10000 } : {})
        })
    });
    t.after(() => service.close());
    return { smtp, service };
}

test('pool Nodemailer reel : 56 envois concurrents, une seule connexion TCP et aucun doublon', { timeout: 15000 }, async t => {
    const { smtp, service } = await localPool(t, 'accept');
    const { pairs, party } = fixture(56);
    const results = await Promise.all(pairs.map(pair => service.sendSecretSantaEmail(pair.giver, pair.receiver, party)));
    assert.ok(results.every(result => result.status === 'accepted'));
    assert.equal(smtp.messages.length, 56);
    assert.equal(smtp.connections(), 1);
    assert.equal(smtp.maxConnections(), 1);
    assert.equal(new Set(results.map(result => result.messageId)).size, 56);
    const receivedIds = smtp.messages.map(message => message.match(/^Message-ID:\s*(.+)$/mi)?.[1].trim());
    assert.deepEqual(receivedIds.sort(), results.map(result => result.messageId).sort());
    service.close();
});

test('pool Nodemailer reel : refus SMTP confirme, aucune reprise cachee', { timeout: 10000 }, async t => {
    const { smtp, service } = await localPool(t, 'reject');
    const { pairs, party } = fixture();
    const result = await service.sendSecretSantaEmail(pairs[0].giver, pairs[0].receiver, party);
    assert.equal(result.status, 'failed');
    assert.equal(result.error.responseCode, 550);
    assert.equal(smtp.messages.length, 1);
    service.close();
});

test('pool Nodemailer reel : coupure apres DATA, resultat incertain et aucun resend', { timeout: 10000 }, async t => {
    const { smtp, service } = await localPool(t, 'disconnect');
    const { pairs, party } = fixture();
    const result = await service.sendSecretSantaEmail(pairs[0].giver, pairs[0].receiver, party);
    assert.equal(result.status, 'uncertain');
    assert.equal(result.error.retryable, false);
    assert.equal(smtp.messages.length, 1);
    assert.equal(smtp.connections(), 1);
    service.close();
});

test('pool Nodemailer reel : timeout en attente de l\'acquittement DATA, sans resend', { timeout: 10000 }, async t => {
    const { smtp, service } = await localPool(t, 'stall');
    const { pairs, party } = fixture();
    const result = await service.sendSecretSantaEmail(pairs[0].giver, pairs[0].receiver, party);
    assert.equal(result.status, 'uncertain');
    assert.equal(result.error.code, 'ETIMEDOUT');
    assert.equal(result.error.retryable, false);
    assert.equal(smtp.messages.length, 1);
    assert.equal(smtp.connections(), 1);
    service.close();
});

test('pool Nodemailer reel : reconnexion apres fermeture inactive, sans keep-alive applicatif', { timeout: 10000 }, async t => {
    const { smtp, service } = await localPool(t, 'accept');
    const { pairs, party } = fixture();
    assert.equal((await service.sendSecretSantaEmail(pairs[0].giver, pairs[0].receiver, party)).status, 'accepted');
    smtp.disconnectIdle();
    await delay(25); // Laisser passer l'evenement close cote client.
    assert.equal((await service.sendSecretSantaEmail(pairs[1].giver, pairs[1].receiver, party)).status, 'accepted');
    assert.equal(smtp.messages.length, 2);
    assert.equal(smtp.connections(), 2);
    assert.equal(smtp.maxConnections(), 1);
    service.close();
});

test('Nodemailer 10.6.1 : Node compatible et signal deja annule, aucune connexion SMTP', async t => {
    assert.equal(require('nodemailer/package.json').version, '10.6.1');
    assert.ok(Number(process.versions.node.split('.')[0]) >= 20);
    const { smtp, service } = await localPool(t, 'accept');
    const { pairs, party } = fixture();
    const controller = new AbortController();
    controller.abort();
    const result = await service.sendSecretSantaEmail(pairs[0].giver, pairs[0].receiver, party, { signal: controller.signal });
    assert.equal(result.status, 'failed');
    assert.equal(result.error.code, 'EABORT');
    assert.equal(smtp.connections(), 0);
    assert.equal(smtp.messages.length, 0);
});

test('AbortSignal apres DATA : vraie fermeture TCP, uncertain et aucun retry cache', { timeout: 10000 }, async t => {
    const { smtp, service } = await localPool(t, 'abort');
    const { pairs, party } = fixture();
    const controller = new AbortController();
    const pending = service.sendSecretSantaEmail(pairs[0].giver, pairs[0].receiver, party, { signal: controller.signal });
    for (let i = 0; i < 200 && smtp.messages.length === 0; i++) await delay(10);
    assert.equal(smtp.messages.length, 1);
    controller.abort();
    const result = await pending;
    assert.equal(result.status, 'uncertain');
    assert.equal(result.error.code, 'EABORT');
    assert.equal(result.error.retryable, false);
    for (let i = 0; i < 100 && smtp.activeConnections(); i++) await delay(10);
    assert.equal(smtp.activeConnections(), 0);
    await delay(100);
    assert.equal(smtp.messages.length, 1);
    assert.equal(smtp.connections(), 1);
});

test('AbortSignal en attente dans le pool : retrait du message sans emission tardive', { timeout: 10000 }, async t => {
    const { smtp, service } = await localPool(t, 'abort');
    const { pairs, party } = fixture();
    const first = new AbortController();
    const second = new AbortController();
    const sending = service.sendSecretSantaEmail(pairs[0].giver, pairs[0].receiver, party, { signal: first.signal });
    for (let i = 0; i < 200 && !smtp.messages.length; i++) await delay(10);
    const queued = service.sendSecretSantaEmail(pairs[1].giver, pairs[1].receiver, party, { signal: second.signal });
    await delay(20);
    second.abort();
    assert.equal((await queued).status, 'uncertain'); // Classification conservative, aucun suivi interne de phase.
    first.abort();
    await sending;
    await delay(100);
    assert.equal(smtp.messages.length, 1);
    assert.equal(smtp.connections(), 1);
});
