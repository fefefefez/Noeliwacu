const Participant = require('../models/Participant');
const Party = require('../models/Party');
const { isValidEmail, isValidName } = require('../utils/validators');
const logger = require('../../logs/logger');

async function addParticipant(req, res) {
    const { code } = req.params;
    let { name, email, familyGroup, wishList } = req.body;

    logger.info(`POST /api/participants/${code} - Tentative d'ajout de participant`);

    // Normalisation
    name = name.trim().toUpperCase();
    email = email.trim().toLowerCase();

    // Validation basique
    if (!name || !email || !familyGroup) {
        logger.warn(`❌ Validation échouée : Données manquantes (name: ${!!name}, email: ${!!email}, familyGroup: ${!!familyGroup})`);
        return res.status(400).json({
            success: false,
            message: 'Nom, email et groupe familial sont obligatoires.'
        });
    }

    // ✅ VALIDATION NOM (Message spécifique et détaillé)
    if (!isValidName(name)) {
        logger.warn(`❌ Validation échouée : Format de nom invalide (name: "${name}")`);
        return res.status(400).json({
            success: false,
            message: 'Le nom doit contenir uniquement des lettres, espaces, accents et traits d\'union.'
        });
    }

    // ✅ VALIDATION EMAIL (Message spécifique)
    if (!isValidEmail(email)) {
        logger.warn(`❌ Validation échouée : Format d'email invalide (email: "${email}")`);
        return res.status(400).json({
            success: false,
            message: 'L\'adresse email n\'est pas valide. Exemple : jean@exemple.com'
        });
    }

    try {
        const party = await Party.findOne({ code });
        if (!party) {
            logger.warn(`❌ Party non trouvée : ${code}`);
            return res.status(404).json({
                success: false,
                message: 'Party non trouvée.'
            });
        }

        if (party.drawDone) {
            logger.warn(`❌ Tirage déjà effectué pour la party ${code}, ajout refusé`);
            return res.status(403).json({
                success: false,
                message: 'Le tirage au sort a déjà été effectué. Impossible d\'ajouter de nouveaux participants.'
            });
        }

        // Vérifier que le groupe familial existe dans la party
        if (!party.families.includes(familyGroup)) {
            logger.warn(`❌ Famille invalide : "${familyGroup}" pour la party ${code}. Familles disponibles : ${party.families.join(', ')}`);
            return res.status(400).json({
                success: false,
                message: `La famille "${familyGroup}" n'existe pas dans cette fête. Veuillez choisir une famille dans la liste.`
            });
        }

        // Vérifier la limite des participants (par ex. 100)
        const MAX_PARTICIPANTS = 100;
        const participantCount = await Participant.countDocuments({ partyId: party._id });

        if (participantCount >= MAX_PARTICIPANTS) {
            logger.warn(`❌ Limite de participants atteinte pour la party ${code} (${participantCount}/${MAX_PARTICIPANTS})`);
            return res.status(400).json({
                success: false,
                message: `Limite de participants atteinte (${MAX_PARTICIPANTS} maximum).`
            });
        }

        // Vérifier les doublons (même nom et email dans la même party)
        const existingParticipant = await Participant.findOne({
            partyId: party._id,
            name: name,
            email: email
        });

        if (existingParticipant) {
            logger.warn(`❌ Tentative de doublon : ${name} (${email}) dans la party ${code}`);
            return res.status(409).json({
                success: false,
                message: `Une personne avec le nom "${name}" et l'email "${email}" est déjà inscrite à cette fête.`
            });
        }

        const participant = new Participant({
            partyId: party._id,
            name,
            email,
            familyGroup,
            wishList: wishList ? wishList.filter(item => item.trim()).slice(0, 3) : []
        });

        await participant.save();
        logger.info(`✅ Participant ajouté : ${name} (${email}) - Famille: ${familyGroup} - Party: ${code}`);

        res.status(201).json({
            success: true,
            message: 'Inscription réussie ! 🎉',
            participant: {
                name: participant.name,
                email: participant.email,
                familyGroup: participant.familyGroup
            }
        });
    } catch (error) {
        if (error.code === 11000) {
            logger.warn(`❌ Erreur de clé dupliquée pour ${name} dans la party ${code}`);
            return res.status(409).json({
                success: false,
                message: `Une personne avec le nom "${name}" est déjà inscrite à cette fête.`
            });
        }
        logger.error(`❌ Erreur lors de l'ajout du participant ${name} (${email}): ${error.message}`);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de l\'inscription. Veuillez réessayer.'
        });
    }
}

async function getParticipants(req, res) {
    const { code } = req.params;

    logger.info(`GET /api/participants/party/${code}`);

    try {
        const party = await Party.findOne({ code });

        if (!party) {
            logger.warn(`❌ Party non trouvée : ${code}`);
            return res.status(404).json({
                success: false,
                message: 'Party non trouvée.'
            });
        }

        const participants = await Participant.find({ partyId: party._id })
            .select('name email familyGroup wishList')
            .sort({ createdAt: 1 });

        logger.info(`✅ ${participants.length} participant(s) récupéré(s) pour la party ${code}`);

        res.json({
            success: true,
            participants,
            count: participants.length
        });

    } catch (error) {
        logger.error(`❌ Erreur lors de la récupération des participants pour ${code}: ${error.message}`);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur.'
        });
    }
}

module.exports = {
    addParticipant,
    getParticipants
};