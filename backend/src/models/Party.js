const mongoose = require('mongoose');

const partySchema = new mongoose.Schema({
    code: {
        type: String,
        required: true,
        unique: true,
        uppercase: true
    },
    name: {
        type: String,
        required: true
    },
    budget: {
        type: Number,
        default: null // optionnel pour l'instant
    },
    date: {
        type: Date,
    },
    families: [{ // Liste des familles predefinies par l'organisateur
        type: String,
        required: true
    }],
    preferCrossFamily: { // Indique si les participants peuvent choisir des cadeaux en dehors de leur famille
        type: Boolean,
        default: true
    },
    adminPinHash: {
        type: String,
        required: true
    },
    drawDone: {
        type: Boolean,
        default: false
    },
    pairsGenerated: [{
        giverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant' },
        receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant' }
    }],
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Party', partySchema);

