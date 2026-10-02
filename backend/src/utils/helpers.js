const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;

/**
 * Hash un PIN avec bcrypt
 * @param {string} pin - Le PIN à hasher
 * @returns {Promise<string>} - Le hash bcrypt du PIN
 */
async function hashPin(pin) {
    return bcrypt.hash(pin.toString(), SALT_ROUNDS);
}

/**
 * Vérifie si un PIN correspond à son hash
 * @param {string} pin - Le PIN en clair
 * @param {string} hash - Le hash bcrypt stocké
 * @returns {Promise<boolean>}
 */
async function verifiyPin(pin, hash) {
    return bcrypt.compare(pin.toString(), hash);
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