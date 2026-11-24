const nodemailer = require('nodemailer');
const { randomUUID } = require('node:crypto');
const logger = require('../../logs/logger');
const { escapeHtml } = require('../utils/escapeHtml');
// Pas de connexion ni lecture de credentials au chargement du module.
function readConfig() {
    if (process.env.TEST_MODE === 'true') return { testMode: true };
    return { testMode: false, user: process.env.EMAIL, pass: process.env.APP_PASS };
}

const headerText = value => String(value ?? '').replace(/[\x00-\x1f\x7f\u2028\u2029]+/g, ' ').trim();
const emailAddress = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const isSingleAddress = value => /^[^\s@<>,;:]+@[^\s@<>,;:]+\.[^\s@<>,;:]+$/.test(value);

function buildMessage(giver, receiver, party, sender) {
        const safeGiverName = escapeHtml(giver.name);
        const safeGiverEmail = escapeHtml(giver.email);
        const safeReceiverName = escapeHtml(receiver.name);
        const safeReceiverNameUpper = escapeHtml(receiver.name.toUpperCase());
        const safePartyName = escapeHtml(party.name);

        const safeWishlist = Array.isArray(receiver.wishList) ? receiver.wishList.map(item => escapeHtml(item)) : [];

        // Wishlist HTML
        const wishlistHtml = safeWishlist.length > 0
            ? `
                <div style="background-color: #f3e5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="color: #6a1b9a; margin: 0 0 15px 0;">🎁 Wishlist de ${safeReceiverName} :</h3>
                    <ul style="line-height: 2; color: #333; margin: 0; padding-left: 25px;">
                        ${safeWishlist.map(item => `<li style="margin-bottom: 8px;">${item}</li>`).join('')}
                    </ul>
                </div>
            `
            : `
                <div style="background-color: #fff3e0; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
                    <p style="color: #e65100; margin: 0; font-style: italic;">
                        ℹ️ ${safeReceiverName} n'a pas encore indiqué de Wishlist.
                    </p>
                </div>
            `;

        const mailOptions = {
            from: { name: 'Secret Santa 🎅', address: sender },
            to: { name: headerText(giver.name), address: emailAddress(giver.email) },
            envelope: { from: sender, to: [emailAddress(giver.email)] },
            subject: `🎄 Secret Santa ${headerText(party.name)} - ${headerText(giver.name)}, ton cadeau surprise !`,
            html: `
                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
                    
                    <!-- Container principal -->
                    <div style="background-color: white; border-radius: 15px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                        
                        <!-- Header avec image de fond -->
                        <div style="background: linear-gradient(135deg, #c62828 0%, #d32f2f 100%); padding: 40px 30px; text-align: center; position: relative;">
                            <h1 style="color: white; margin: 0; font-size: 36px; text-shadow: 2px 2px 4px rgba(0,0,0,0.3);">
                                🎅 Secret Santa
                            </h1>
                            <h2 style="color: rgba(255,255,255,0.95); margin: 10px 0 0 0; font-size: 22px; font-weight: normal;">
                                ${safePartyName}
                            </h2>
                        </div>

                        <!-- Corps du message -->
                        <div style="padding: 40px 30px;">
                            
                            <!-- Salutation -->
                            <p style="font-size: 18px; color: #333; margin: 0 0 25px 0;">
                                Bonjour <strong>${safeGiverName}</strong> ! 🎄
                            </p>

                            <!-- Révélation du Secret Santa -->
                            <div style="background: linear-gradient(135deg, #15c087ff 0%, #1976d2 100%); padding: 30px; border-radius: 12px; text-align: center; margin: 25px 0; box-shadow: 0 3px 10px rgba(21,101,192,0.3);">
                                <p style="color: white; margin: 0 0 10px 0; font-size: 18px; opacity: 0.95;">
                                    🎁 Tu es le Secret Santa de :
                                </p>
                                <h2 style="color: white; margin: 0; font-size: 32px; font-weight: bold; text-shadow: 2px 2px 4px rgba(0,0,0,0.2); letter-spacing: 1px;">
                                    ${safeReceiverNameUpper}
                                </h2>
                            </div>

                            <!-- Wishlist -->
                            ${wishlistHtml}

                            <!-- Budget -->
                            ${party.budget ? `
                            <div style="background-color: #e8f5e9; padding: 18px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2e7d32;">
                                <p style="margin: 0; color: #1b5e20; font-size: 16px;">
                                    <strong>💰 Budget suggéré :</strong> ${escapeHtml(party.budget)}€
                                </p>
                            </div>
                            ` : ''}

                            <!-- Date -->
                            ${party.date ? `
                            <div style="background-color: #fff3e0; padding: 18px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f57c00;">
                                <p style="margin: 0; color: #e65100; font-size: 16px;">
                                    <strong>📅 Date de l'événement :</strong> ${new Date(party.date).toLocaleDateString('fr-FR', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            })}
                                </p>
                            </div>
                            ` : ''}

                            <!-- Message de clôture -->
                            <div style="margin-top: 35px; padding-top: 25px; border-top: 2px dashed #e0e0e0;">
                                <p style="color: #555; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0; text-align: center;">
                                    Amuse-toi bien à choisir un joli cadeau pour surprendre ${safeReceiverName} ! 🎅
                                </p>
                                
                                <!-- Alerte secret -->
                                <div style="background-color: #ffebee; padding: 20px; border-radius: 8px; border: 2px solid #ef5350; text-align: center;">
                                    <p style="color: #c62828; font-size: 18px; font-weight: bold; margin: 0 0 10px 0;">
                                        🤫 Garde le secret !
                                    </p>
                                    <p style="color: #d32f2f; font-size: 14px; margin: 0;">
                                        Ne révèle à personne qui tu as tiré au sort.
                                    </p>
                                </div>
                            </div>

                        </div>

                        <!-- Footer -->
                        <div style="background-color: #f5f5f5; padding: 25px 30px; text-align: center; border-top: 1px solid #e0e0e0;">
                            <p style="color: #1565c0; font-size: 20px; font-weight: bold; margin: 0 0 10px 0;">
                                🎄 Joyeux Noël ! 🎄
                            </p>
                            <p style="color: #999; font-size: 12px; margin: 0; font-style: italic;">
                                Cet email est destiné à <strong>${safeGiverName}</strong> (${safeGiverEmail})
                            </p>
                        </div>

                    </div>

                    <!-- Note technique -->
                    <p style="color: #999; font-size: 11px; text-align: center; margin-top: 20px;">
                        Secret Santa V2.0 - Ne pas répondre à cet email
                    </p>

                </div>
            `
        };

        return mailOptions;
}

const safeCodes = new Set(['EAUTH', 'EENVELOPE', 'EMESSAGE', 'ETIMEDOUT', 'ECONNECTION', 'ESOCKET',
    'ECONNRESET', 'ECONNREFUSED', 'EDNS', 'ENOTFOUND', 'EAI_AGAIN', 'ESTREAM', 'EPROTOCOL', 'ETLS',
    'ECONFIG', 'EINPUT', 'ESHUTDOWN', 'ESMTPRESULT', 'EABORT']);
const preTransmissionCodes = new Set(['EAUTH', 'EENVELOPE', 'EDNS', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED']);
const temporaryCodes = new Set(['EDNS', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ESHUTDOWN',
    'ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'ECONNRESET']);

function safeCommand(value) {
    if (typeof value !== 'string') return undefined;
    const upper = value.toUpperCase();
    for (const command of ['AUTH', 'MAIL FROM', 'RCPT TO', 'EHLO', 'HELO', 'STARTTLS', 'DATA', 'CONN', 'API']) {
        if (upper === command || upper.startsWith(`${command} `)) return command;
    }
    return undefined;
}

function failureResult(error, transmissionInvoked) {
    const code = safeCodes.has(error?.code) ? error.code : 'SMTP_ERROR';
    const responseCode = Number.isInteger(error?.responseCode) && error.responseCode >= 400 &&
        error.responseCode <= 599 ? error.responseCode : undefined;
    // CONN n'est PAS une preuve d'echec avant DATA. EABORT apres invocation
    // reste incertain : aucune supposition sur la progression interne du pool.
    const status = !transmissionInvoked || responseCode || preTransmissionCodes.has(code) ? 'failed' : 'uncertain';
    return {
        status,
        error: {
            code,
            message: status === 'failed' ? 'Échec confirmé de la tentative SMTP.' : 'Transmission SMTP non confirmée.',
            command: safeCommand(error?.command),
            responseCode,
            retryable: status === 'failed' && (responseCode ? responseCode < 500 : temporaryCodes.has(code))
        }
    };
}

/**
 * Une instance = un pool paresseux et une configuration figee au premier appel.
 * L'ordonnancement durable et l'idempotence entre appels appartiennent a MongoDB.
 */
function createEmailService({ createTransport = options => nodemailer.createTransport(options),
    getConfig = readConfig, log = logger, now = () => new Date() } = {}) {
    let config;
    let transport;
    let closed = false;

    function getTransport() {
        if (!transport) {
            transport = createTransport({
                service: 'gmail',
                auth: { user: emailAddress(config.user), pass: config.pass },
                pool: true,
                maxConnections: 1,
                maxMessages: 100,
                maxRequeues: 0, // Aucun resend cache apres une coupure.
                rateLimit: 1,
                rateDelta: 1000,
                dnsTimeout: 5000,
                connectionTimeout: 10000,
                greetingTimeout: 10000,
                // Delais par phase ; AbortSignal borne la tentative complete.
                socketTimeout: 15000,
                logger: false,
                debug: false,
                transactionLog: false,
                disableFileAccess: true,
                disableUrlAccess: true
            });
        }
        return transport;
    }

    async function sendSecretSantaEmail(giver, receiver, party, options = {}) {
        const requestedAttemptId = options?.attemptId;
        const validAttemptId = typeof requestedAttemptId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(requestedAttemptId);
        const attemptId = validAttemptId ? requestedAttemptId : randomUUID();
        const messageId = `<${attemptId}@noeliwacu.invalid>`;
        const metadata = { participantId: giver?._id == null ? undefined : String(giver._id),
            attemptId, messageId, startedAt: now() };
        let transmissionInvoked = false;
        let result;
        try {
            if (options.signal?.aborted) throw Object.assign(new Error(), { code: 'EABORT' });
            if (closed) throw Object.assign(new Error(), { code: 'ESHUTDOWN' });
            if ((requestedAttemptId !== undefined && !validAttemptId) || !metadata.participantId ||
                typeof giver?.name !== 'string' || !giver.name.trim() || !isSingleAddress(emailAddress(giver?.email)) ||
                typeof receiver?.name !== 'string' || !receiver.name.trim() || typeof party?.name !== 'string') {
                throw Object.assign(new Error(), { code: 'EINPUT' });
            }
            config ??= getConfig();
            if (config.testMode) {
                result = { status: 'simulated' };
            } else {
                if (!isSingleAddress(emailAddress(config.user)) || typeof config.pass !== 'string' || !config.pass) {
                    throw Object.assign(new Error(), { code: 'ECONFIG' });
                }
                const mail = { ...buildMessage(giver, receiver, party, emailAddress(config.user)), messageId,
                    signal: options.signal };
                const sender = getTransport();
                transmissionInvoked = true;
                const info = await sender.sendMail(mail);
                const target = mail.envelope.to[0];
                const accepted = Array.isArray(info?.accepted) ? info.accepted.map(emailAddress) : [];
                const rejected = Array.isArray(info?.rejected) ? info.rejected.map(emailAddress) : [];
                const pending = Array.isArray(info?.pending) ? info.pending.map(emailAddress) : [];
                if (accepted.length === 1 && accepted[0] === target && !rejected.includes(target) && !pending.includes(target)) {
                    result = { status: 'accepted' };
                } else if (rejected.includes(target) && !accepted.includes(target)) {
                    result = failureResult({ code: 'EENVELOPE', command: 'RCPT TO',
                        responseCode: info?.rejectedErrors?.[0]?.responseCode }, true);
                } else {
                    result = failureResult({ code: 'ESMTPRESULT' }, true);
                }
            }
        } catch (error) {
            result = failureResult(error, transmissionInvoked);
        }
        const completedAt = now();
        // Jamais de log d'objet SMTP, d'erreur brute, d'adresse ou d'attribution.
        log.info(`Notification email : ${result.status}.`);
        return { ...metadata, ...result, success: result.status === 'accepted', completedAt,
            ...(result.status === 'accepted' ? { acceptedAt: completedAt } : {}) };
    }

    async function sendAllEmails(pairs, party) {
        if (!Array.isArray(pairs)) throw new TypeError('Le lot doit être un tableau.');
        const participantIds = pairs.map(pair => pair?.giver?._id == null ? null : String(pair.giver._id));
        if (participantIds.includes(null) || new Set(participantIds).size !== pairs.length) {
            throw new TypeError('Chaque participant doit apparaître une seule fois dans le lot.');
        }
        const results = { total: pairs.length, accepted: 0, failed: 0, uncertain: 0, simulated: 0, sent: 0, attempts: [] };
        for (const pair of pairs) {
            const attempt = await sendSecretSantaEmail(pair.giver, pair.receiver, party);
            results.attempts.push(attempt);
            results[attempt.status]++;
        }
        results.sent = results.accepted; // Compatibilite : seulement les acceptations SMTP reelles.
        return results;
    }

    function close() {
        closed = true;
        transport?.close(); // Les envois actifs finissent ; ceci n'est pas une annulation.
    }

    return { sendSecretSantaEmail, sendAllEmails, close };
}

const defaultService = createEmailService();
module.exports = {
    createEmailService,
    sendSecretSantaEmail: defaultService.sendSecretSantaEmail,
    sendAllEmails: defaultService.sendAllEmails,
    closeEmailTransport: defaultService.close
};
