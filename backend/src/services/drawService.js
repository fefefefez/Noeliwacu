const logger = require('../../logs/logger');

/**
 * Génère les paires Secret Santa avec algorithme hybride intelligent
 * Favorise les tirages inter-familles tout en gardant une belle part de hasard naturel
 */
function generatePairs(participants, preferCrossFamily = true) {
    if (!participants || participants.length < 2) {
        throw new Error('Il faut au moins deux participants pour generer des paires.');
    }

    logger.info(`🎲 Generation du tirage pour ${participants.length} participants.`);

    // Grouper par famille
    const families = {};
    participants.forEach(participant => {
        if (!families[participant.familyGroup]) {
            families[participant.familyGroup] = [];
        }
        families[participant.familyGroup].push(participant);
    });

    const familyNames = Object.keys(families);

    // Cas simple : 1 seule famille ou pas de préférence
    if (!preferCrossFamily || familyNames.length === 1) {
        const shuffled = [...participants].sort(() => Math.random() - 0.5);
        const pairs = shuffled.map((giver, i) => ({
            giver,
            receiver: shuffled[(i + 1) % shuffled.length]
        }));

        logger.info(`🎯 Tirage simple (1 famille ou pas de préférence)`);
        return pairs;
    }

    // ====== PARAMÈTRES INTELLIGENTS ======
    const totalParticipants = participants.length;

    // Seuil "excellent" : 0 paires intra-famille
    const perfectScore = 0;

    // Seuil "acceptable" : max 15% de paires intra-famille (arrondi vers le haut)
    const acceptableScore = Math.max(1, Math.ceil(totalParticipants * 0.15));

    logger.info(`🎯 Objectif : 0 paires intra-famille (acceptable : ≤${acceptableScore})`);

    let bestPairs = null;
    let bestScore = Infinity;

    // ====== PHASE 1 : RECHERCHE DE PERFECTION (3 tentatives déterministes) ======
    logger.info(`📍 Phase 1 : Recherche de la solution parfaite...`);

    for (let attempt = 0; attempt < 3; attempt++) {
        const shuffledFamilyNames = [...familyNames].sort(() => Math.random() - 0.5);

        const shuffledFamilies = {};
        shuffledFamilyNames.forEach(name => {
            shuffledFamilies[name] = [...families[name]].sort(() => Math.random() - 0.5);
        });

        let currentFamilyIndex = 0;
        let familyPointers = shuffledFamilyNames.map(() => 0);
        const chain = [];

        while (chain.length < totalParticipants) {
            const familyName = shuffledFamilyNames[currentFamilyIndex];
            const familyMembers = shuffledFamilies[familyName];
            const pointer = familyPointers[currentFamilyIndex];

            if (pointer < familyMembers.length) {
                chain.push(familyMembers[pointer]);
                familyPointers[currentFamilyIndex]++;
            }

            currentFamilyIndex = (currentFamilyIndex + 1) % shuffledFamilyNames.length;
        }

        const pairs = chain.map((giver, i) => ({
            giver,
            receiver: chain[(i + 1) % chain.length]
        }));

        const intraFamilyCount = pairs.filter(
            pair => pair.giver.familyGroup === pair.receiver.familyGroup
        ).length;

        if (intraFamilyCount < bestScore) {
            bestScore = intraFamilyCount;
            bestPairs = pairs;
        }

        // Si on trouve la perfection, on s'arrête là ! 🎉
        if (intraFamilyCount === perfectScore) {
            logger.info(`✅ Solution PARFAITE trouvée ! (0 paires intra-famille, tentative ${attempt + 1}/3)`);
            return bestPairs;
        }
    }

    logger.info(`📊 Phase 1 terminée : meilleur score = ${bestScore} paires intra-famille`);

    // ====== PHASE 2 : RECHERCHE "ASSEZ BON" (50 tentatives aléatoires) ======
    if (bestScore > acceptableScore) {
        logger.info(`📍 Phase 2 : Recherche d'une solution acceptable (≤${acceptableScore})...`);

        for (let attempt = 0; attempt < 50; attempt++) {
            const shuffled = [...participants].sort(() => Math.random() - 0.5);

            const pairs = shuffled.map((giver, i) => ({
                giver,
                receiver: shuffled[(i + 1) % shuffled.length]
            }));

            const intraFamilyCount = pairs.filter(
                pair => pair.giver.familyGroup === pair.receiver.familyGroup
            ).length;

            if (intraFamilyCount < bestScore) {
                bestScore = intraFamilyCount;
                bestPairs = pairs;
            }

            // Si on atteint le seuil acceptable, on s'arrête
            if (intraFamilyCount <= acceptableScore) {
                logger.info(`✅ Solution ACCEPTABLE trouvée ! (${intraFamilyCount} paires intra-famille ≤ ${acceptableScore}, tentative ${attempt + 1}/50)`);
                return bestPairs;
            }
        }

        logger.info(`📊 Phase 2 terminée : meilleur score = ${bestScore} paires intra-famille`);
    }

    // ====== PHASE 3 : FALLBACK "AU MIEUX" (100 tentatives finales) ======
    if (bestScore > acceptableScore) {
        logger.info(`📍 Phase 3 : Recherche du meilleur compromis possible...`);

        for (let attempt = 0; attempt < 100; attempt++) {
            const shuffled = [...participants].sort(() => Math.random() - 0.5);

            const pairs = shuffled.map((giver, i) => ({
                giver,
                receiver: shuffled[(i + 1) % shuffled.length]
            }));

            const intraFamilyCount = pairs.filter(
                pair => pair.giver.familyGroup === pair.receiver.familyGroup
            ).length;

            if (intraFamilyCount < bestScore) {
                bestScore = intraFamilyCount;
                bestPairs = pairs;

                logger.info(`🔄 Amélioration : ${bestScore} paires intra-famille (tentative ${attempt + 1}/100)`);
            }
        }

        logger.info(`📊 Phase 3 terminée : meilleur score = ${bestScore} paires intra-famille`);
    }

    // ====== RÉSULTAT FINAL ======
    const percentage = ((bestScore / totalParticipants) * 100).toFixed(1);

    if (bestScore === 0) {
        logger.info(`🎉 RÉSULTAT FINAL : Solution PARFAITE (0 paires intra-famille) !`);
    } else if (bestScore <= acceptableScore) {
        logger.info(`✅ RÉSULTAT FINAL : Solution ACCEPTABLE (${bestScore} paires intra-famille = ${percentage}%)`);
    } else {
        logger.warn(`⚠️ RÉSULTAT FINAL : Meilleur compromis trouvé (${bestScore} paires intra-famille = ${percentage}%)`);
    }

    return bestPairs;
}

/**
 * Valide que le tirage est cohérent
 */
function validatePairs(pairs) {
    const givers = new Set();
    const receivers = new Set();

    for (const pair of pairs) {
        if (pair.giver._id.toString() === pair.receiver._id.toString()) {
            throw new Error(`Le participant ${pair.giver.name} s'est attribué lui-même.`);
        }

        givers.add(pair.giver._id.toString());
        receivers.add(pair.receiver._id.toString());
    }

    if (givers.size !== pairs.length || receivers.size !== pairs.length) {
        throw new Error("Erreur : Le tirage est incomplet !");
    }

    logger.info('✅ Validation du tirage : OK');
    return true;
}

/**
 * Génère un aperçu du tirage sans révéler les paires
 */
function generatePreview(pairs) {
    const stats = {
        totalPairs: pairs.length,
        crossFamily: 0,
        intraFamily: 0,
        percentage: 0,
        quality: '',
        byFamily: {}
    };

    pairs.forEach(pair => {
        const giverFamily = pair.giver.familyGroup;
        const receiverFamily = pair.receiver.familyGroup;

        if (giverFamily === receiverFamily) {
            stats.intraFamily++;
        } else {
            stats.crossFamily++;
        }

        if (!stats.byFamily[giverFamily]) {
            stats.byFamily[giverFamily] = { gives: 0, receives: 0 };
        }
        if (!stats.byFamily[receiverFamily]) {
            stats.byFamily[receiverFamily] = { gives: 0, receives: 0 };
        }

        stats.byFamily[giverFamily].gives++;
        stats.byFamily[receiverFamily].receives++;
    });

    // Calculer le pourcentage et la qualité
    stats.percentage = parseFloat(((stats.intraFamily / stats.totalPairs) * 100).toFixed(1));

    if (stats.intraFamily === 0) {
        stats.quality = 'PARFAIT';
    } else if (stats.intraFamily <= Math.ceil(stats.totalPairs * 0.15)) {
        stats.quality = 'EXCELLENT';
    } else if (stats.intraFamily <= Math.ceil(stats.totalPairs * 0.25)) {
        stats.quality = 'BON';
    } else {
        stats.quality = 'ACCEPTABLE';
    }

    return stats;
}

module.exports = {
    generatePairs,
    validatePairs,
    generatePreview
};