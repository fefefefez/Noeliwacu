const crypto = require('crypto');

/**
 * Hash a PIN avec SHA-256
 * @param {string} pin - Le PIN à hasher
 * @returns {Promise<string>} - Le hash hexadécimal du PIN
 */
async function hashPin(pin) {
    return crypto
        .createHash('sha256')
        .update(pin.toString())
        .digest('hex');
}

/**
 * vérifie si un PIN correspond à son hash
 * @param {string} pin - Le PIN en clair
 * @param {string} hash - Le hash stocké
 * @returns {Promise<boolean>} - true si le PIN correspond au hash, false sinon
 */

async function verifiyPin(pin, hash) {
    const hashedPin = await hashPin(pin);
    return hashedPin === hash;
}

/**
 * Anonymise un email pour l'affichage
 * ex: user@example.com -> u***@example.com
 */

function anonymizeEmail(email) {
    const [username, domain] = email.split('@');

    if (username.length <= 2) {
        return `${username}****@${domain[0]}****.${domain.split('.').pop()}`;
    }

    const visibleUsername = username.substring(0, 2);
    const [domainName, extension] = domain.split('.');
    const visibleDomain = domainName[0];

    return `${visibleUsername}***@${visibleDomain}****.${extension}`;
}

module.exports = {
    hashPin,
    verifiyPin,
    anonymizeEmail
};