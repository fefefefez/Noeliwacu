require('dotenv').config();

const API_URL = 'http://localhost:3000/api';

const testData = {
    party: {
        name: 'Test Noël 2025 - Automatisé',
        adminPin: '1234',
        date: '2025-12-25',
        budget: 30,
        families: ['Martin', 'Dupont', 'Amis'],
        preferCrossFamily: true
    },
    participants: [
        { name: 'Jean Martin', email: 'jean@test.com', familyGroup: 'Martin', wishList: ['Livre', 'Chocolat'] },
        { name: 'Sophie Martin', email: 'sophie@test.com', familyGroup: 'Martin', wishList: ['Pull'] },
        { name: 'Lucas Martin', email: 'lucas@test.com', familyGroup: 'Martin', wishList: [] },
        { name: 'Pierre Dupont', email: 'pierre@test.com', familyGroup: 'Dupont', wishList: ['Montre'] },
        { name: 'Marie Dupont', email: 'marie@test.com', familyGroup: 'Dupont', wishList: ['Sac'] },
        { name: 'Alice', email: 'alice@test.com', familyGroup: 'Amis', wishList: ['Bougie'] }
    ]
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const separator = () => console.log('─'.repeat(70));
const title = (text) => {
    console.log('\n' + '═'.repeat(70));
    console.log(`  ${text}`);
    console.log('═'.repeat(70));
};

async function runTests() {
    console.log('\n\n');
    title('🧪 TEST AUTOMATISÉ - SECRET SANTA V2.0');
    console.log(`📅 Date : ${new Date().toLocaleString('fr-FR')}`);
    console.log(`🌐 API : ${API_URL}`);
    console.log(`🧪 TEST_MODE : ${process.env.TEST_MODE || 'false'}`);

    let partyCode = null;

    try {
        // ÉTAPE 1 : Créer la Party
        title('📝 ÉTAPE 1/6 : Création de la Party');

        console.log(`\n⏳ Envoi de la requête POST /api/parties...`);
        const partyRes = await fetch(`${API_URL}/parties`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testData.party)
        });

        const partyData = await partyRes.json();

        if (!partyData.success) {
            throw new Error(`Échec création party: ${partyData.message}`);
        }

        partyCode = partyData.party.code;

        console.log(`✅ Party créée avec succès !`);
        console.log(`   📌 Code : ${partyCode}`);
        console.log(`   📛 Nom : ${partyData.party.name}`);

        await sleep(500);

        // ÉTAPE 2 : Ajouter les Participants
        title('👥 ÉTAPE 2/6 : Ajout des Participants');

        console.log(`\n⏳ Ajout de ${testData.participants.length} participants...`);
        separator();

        for (let i = 0; i < testData.participants.length; i++) {
            const participant = testData.participants[i];

            // ✅ CORRECTION : Utiliser /api/participants/:code (pas /api/participants)
            const res = await fetch(`${API_URL}/participants/${partyCode}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(participant)
            });

            const data = await res.json();

            if (!data.success) {
                throw new Error(`Échec ajout ${participant.name}: ${data.message}`);
            }

            console.log(`  ${i + 1}. ✅ ${participant.name.padEnd(20)} | ${participant.familyGroup.padEnd(10)} | ${participant.email}`);

            await sleep(200);
        }

        console.log(separator());
        console.log(`✅ ${testData.participants.length} participants ajoutés avec succès !`);

        await sleep(500);

        // ÉTAPE 3 : Vérifier le Statut
        title('📊 ÉTAPE 3/6 : Vérification du Statut');

        console.log(`\n⏳ Récupération du statut...`);
        const statusRes = await fetch(`${API_URL}/parties/${partyCode}/draw/status`);
        const statusData = await statusRes.json();

        if (!statusData.success) {
            throw new Error(`Échec récupération statut: ${statusData.message}`);
        }

        console.log(`✅ Statut récupéré :`);
        console.log(`   👥 Participants : ${statusData.status.participantCount}`);
        console.log(`   🎲 Tirage effectué : ${statusData.status.drawDone ? 'OUI' : 'NON'}`);
        console.log(`   ✅ Peut tirer : ${statusData.status.canDraw ? 'OUI' : 'NON'}`);

        if (!statusData.status.canDraw) {
            throw new Error('Impossible d\'effectuer le tirage');
        }

        await sleep(500);

        // ÉTAPE 4 : Aperçu
        title('🎲 ÉTAPE 4/6 : Aperçu du Tirage');

        console.log(`\n⏳ Génération de l'aperçu...`);
        const previewRes = await fetch(`${API_URL}/parties/${partyCode}/draw/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminPin: '1234' })
        });

        const previewData = await previewRes.json();

        if (!previewData.success) {
            throw new Error(`Échec aperçu: ${previewData.message}`);
        }

        const p = previewData.preview;

        console.log(`✅ Aperçu généré :`);
        console.log(`   🎯 Qualité : ${p.quality}`);
        console.log(`   🔀 Inter-familles : ${p.crossFamily} (${((p.crossFamily / p.totalPairs) * 100).toFixed(1)}%)`);

        await sleep(500);

        // ÉTAPE 5 : Tirage Final
        title('📧 ÉTAPE 5/6 : Tirage et Envoi');

        console.log(`\n⏳ Lancement du tirage...`);

        const drawRes = await fetch(`${API_URL}/parties/${partyCode}/draw/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminPin: '1234' })
        });

        const drawData = await drawRes.json();

        if (!drawData.success) {
            throw new Error(`Échec tirage: ${drawData.message}`);
        }

        console.log(`✅ Tirage effectué !`);
        console.log(`   📧 Emails : ${drawData.results.emailsSent}/${drawData.results.totalParticipants}`);
        console.log(`   🎯 Qualité : ${drawData.results.stats.quality}`);

        await sleep(500);

        // ÉTAPE 6 : Blocage
        title('🔒 ÉTAPE 6/6 : Vérification Blocage');

        console.log(`\n⏳ Tentative de double tirage...`);
        const retryRes = await fetch(`${API_URL}/parties/${partyCode}/draw/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminPin: '1234' })
        });

        const retryData = await retryRes.json();

        if (retryData.success) {
            throw new Error('🚨 Le tirage a été effectué 2 fois !');
        }

        console.log(`✅ Blocage OK : ${retryData.message}`);

        title('🎉 TOUS LES TESTS SONT PASSÉS !');
        console.log(`\n💡 Prochaine étape : Frontend React\n`);

    } catch (error) {
        title('❌ ÉCHEC DU TEST');
        console.error(`\n🚨 Erreur : ${error.message}`);
        if (partyCode) {
            console.log(`\n📌 Code party : ${partyCode}`);
        }
        process.exit(1);
    }
}

console.log('\n⏳ Démarrage dans 2 secondes...');
setTimeout(runTests, 2000);