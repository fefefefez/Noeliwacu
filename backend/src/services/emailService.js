const nodemailer = require('nodemailer');
const logger = require('../../logs/logger');
const { escapeHtml } = require('../utils/escapeHtml');
/**
 * Service d'envoi d'emails via Nodemailer
 * @param {Object} giver - Le participant qui donne
 * @param {Object} receiver - Le participant qui reçoit
 * @param {Object} party - La party
 * @returns {Promise<Object>} - Résultat de l'envoi de l'email
 */
async function sendSecretSantaEmail(giver, receiver, party) {

    if (process.env.TEST_MODE === 'true') {
        logger.info('[TEST MODE] Email simulé');

        return {
            success: true,
            testMode: true,
            recipient: giver.email,
            giverId: giver._id
        };
    }

    // Mode Production : Envoi réel de l'email
    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL,
                pass: process.env.APP_PASS
            }
        });

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
            from: `"Secret Santa 🎅" <${process.env.EMAIL}>`,
            to: giver.email,
            subject: `🎄 Secret Santa ${party.name} - Ton cadeau surprise !`,
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
                                    <strong>💰 Budget suggéré :</strong> ${party.budget}€
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

        const info = await transporter.sendMail(mailOptions);
        logger.info(`✅ Email envoyé avec succès`);

        return {
            success: true,
            info,
            recipient: giver.email,
            giverId: giver._id
        };
    } catch (error) {
        logger.error(`❌ Erreur lors de l'envoi de l'email`);
        throw error;
    }
}

/**
 * Envoie de tous les emails du Secret Santa
 * @param {Array} pairs - Les paires de participants
 * @param {Object} party - La party
 * @returns {Promise<Object>} - Résultats de l'envoi
 */
async function sendAllEmails(pairs, party) {
    const results = {
        total: pairs.length,
        sent: 0,
        failed: 0,
        errors: []
    };

    logger.info(`Début de l'envoi de ${pairs.length} emails`);
    for (const pair of pairs) {
        try {
            await sendSecretSantaEmail(pair.giver, pair.receiver, party);
            results.sent++;

            // ✅ Pause de 1000ms entre les envois (sauf en TEST_MODE)
            if (process.env.TEST_MODE !== 'true') {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error) {
            results.failed++;
            results.errors.push({
                error: 'Échec de l’envoi de l’email'
            });
            logger.error('❌ Échec d’envoi d’un email');
        }
    }

    logger.info(`✅ Envoi terminé : ${results.sent}/${results.total} emails envoyés avec succès, ${results.failed} échec(s).`);

    return results;
}

module.exports = {
    sendSecretSantaEmail,
    sendAllEmails
};
