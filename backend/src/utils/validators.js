const crypto = require('crypto');
/**
 * Valide le format d'un email
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Valide le format d'un nom (lettres, espaces, accents, traits d'union)
*/

function isValidName(name) {
    if (!name || name.length < 2 || name.length > 50) {
        return false;
    }
    const nameRegex = /^[a-zA-ZÀ-ÿ\s'\-]+$/;

    return nameRegex.test(name);
}

/**
 * Valide le format d'un code PIN administrateur (4 chiffres)
 */
function isValidAdminPin(pin) {
    return typeof pin === 'string' && /^\d{4}$/.test(pin);
}
/**
 * Génère un code unique pour une party
*/
function generatePartyCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';

    for (let i = 0; i < 6; i++) {
        const randomIndex = crypto.randomInt(0, chars.length);
        code += chars[randomIndex];
    }

    return code;
}


module.exports = {
    isValidEmail,
    isValidName,
    isValidAdminPin,
    generatePartyCode
};