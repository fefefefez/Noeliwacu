const mongoose = require('mongoose');

const notificationStatuses = ['pending', 'sending', 'accepted', 'failed', 'uncertain', 'simulated'];

// Le service d'envoi devra fournir des erreurs expurgees de tout secret/contenu SMTP.
const notificationErrorSchema = new mongoose.Schema({
    code: { type: String, maxlength: 80 },
    message: { type: String, maxlength: 500 },
    command: { type: String, maxlength: 80 },
    responseCode: { type: Number },
    retryable: { type: Boolean }
}, { _id: false });

const notificationAttemptSchema = new mongoose.Schema({
    attemptId: { type: String, required: true, trim: true },
    // Une tentative commence a sending ; pending appartient a la notification.
    status: { type: String, required: true, enum: notificationStatuses.slice(1) },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date },
    messageId: { type: String, maxlength: 998 },
    error: { type: notificationErrorSchema }
}, { _id: false });

const notificationSchema = new mongoose.Schema({
    // Identite dans ce tirage : participantId, jamais recipientEmail.
    // Le destinataire du cadeau reste defini uniquement par pairsGenerated.
    participantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant', required: true },
    recipientEmail: { type: String, required: true, trim: true, lowercase: true },
    // accepted = acceptation SMTP confirmee, pas reception/lecture du message.
    status: { type: String, required: true, enum: notificationStatuses, default: 'pending' },
    attemptCount: {
        type: Number,
        default: 0,
        min: 0,
        validate: { validator: Number.isInteger, message: 'Le nombre de tentatives doit etre entier.' }
    },
    lastAttemptAt: { type: Date },
    nextAttemptAt: { type: Date },
    leaseToken: { type: String },
    leaseExpiresAt: { type: Date },
    acceptedAt: { type: Date },
    messageId: { type: String, maxlength: 998 },
    lastError: { type: notificationErrorSchema },
    attempts: {
        type: [notificationAttemptSchema],
        default: [],
        validate: {
            validator: attempts => hasUniqueIds(attempts, attempt => attempt.attemptId),
            message: 'Chaque tentative doit avoir un identifiant distinct dans la notification.'
        }
    }
}, { _id: false });

function hasUniqueIds(items, getId) {
    if (items === undefined) return true;
    if (!Array.isArray(items) || items.some(item => item == null)) return false;
    // Les champs required des sous-documents signalent les identifiants manquants.
    const ids = items.map(getId).filter(id => id != null);
    return new Set(ids.map(String)).size === ids.length;
}

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
    drawDate: {
        type: Date,
        default: null
    },
    pairsGenerated: [{
        giverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant' },
        receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant' }
    }],
    // V2.1 : aucune valeur generee lors de la lecture d'une ancienne fete.
    // La creation atomique du tirage sera realisee dans une etape ulterieure.
    drawId: { type: String, trim: true, minlength: 1 },
    drawParticipantIds: {
        type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Participant' }],
        default: undefined,
        validate: {
            validator: ids => hasUniqueIds(ids, id => id),
            message: 'Un participant ne peut apparaitre qu\'une fois dans le tirage.'
        }
    },
    notifications: {
        type: [notificationSchema],
        default: undefined,
        // Pas d'index unique sur l'email : plusieurs participants peuvent le partager.
        // Ce validateur de tableau ne remplace pas les gardes des futures updates atomiques.
        validate: {
            validator: notifications => hasUniqueIds(notifications, notification => notification?.participantId),
            message: 'Une seule notification est autorisee par participant dans un tirage.'
        }
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Party', partySchema);

