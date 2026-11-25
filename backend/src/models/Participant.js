const mongoose = require('mongoose');
const { MAX_WISH_LENGTH } = require('../utils/validators');

const participantSchema = new mongoose.Schema({
    partyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Party',
        required: true
    },
    name: {
        type: String,
        required: true,
        uppercase: true
    },
    email: {
        type: String,
        required: true,
        lowercase: true // Emails en minuscules pour cohérence
    },
    familyGroup: {
        type: String,
        required: true // Doit correspondre à une des familles définies dans Party.families
    },
    wishList: [{
        type: String,
        maxlength: MAX_WISH_LENGTH
    }],
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Index unique pour éviter les doublons d'email dans la même fête
participantSchema.index({ partyId: 1, name: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('Participant', participantSchema);
