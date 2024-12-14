require("dotenv").config(); // Importer le module dotenv pour gérer les variables d'environnement
const express = require("express"); // Importer le module express
const nodemailer = require("nodemailer"); // Importer le module nodemailer
const cors = require("cors");       // Importer le module cors
const morgan = require("morgan");  // Importer le module morgan
const logger = require("./logger"); // Importer le module winston
const mongoose = require("mongoose"); // Importer le module mongoose
const { error } = require("winston");

const app = express();             // Créer une application express
const port = process.env.PORT || 3000; // Utilisez $PORT fourni par Heroku ou 3000 par défaut

// middleware http 
app.use((req, res, next) => {
    if (req.headers["x-forwarded-proto"] !== "https") {
        return res.redirect(`https://${req.headers.host}${req.url}`);
    }
    next();
});

// Activer les middlewares
app.use(cors());              // Activer CORS
app.use(express.json());     // Activer le middleware pour le JSON
app.use(express.static("public"));  // Activer le middleware pour les fichiers statiques

//Morgan middleware
app.use(
    morgan('combined', {
        stream: {
            write: message => logger.info(message.trim()) // Utiliser winston pour enregistrer les logs
        }
    })
);
//test de la configuration de winston
logger.info(`Serveur démarré`); // Enregistrer un message d'information

// Connexion à la base de données MongoDB
mongoose.connect(process.env.MONGODB_URI)  
    .then(() => {
                logger.info("Connexion à la base de données établie");
    })  
    .catch((error) => {

                        logger.info(process.env.MONGODB_URI);
                        logger.error("Erreur de connexion à la base de données:", error);
                        return process.exit(1);
    });

const participantSchema = new mongoose.Schema({
    name:   {type: String, required: true},
    email:  {type: String, required: true},
});

const Participant = mongoose.model("Participant", participantSchema);

// Mot de passe Admin
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Route pour la page d'accueil
app.get("/", (req, res) => {
    res.send("Bienvenue sur le serveur Secret Santa 🎅"); // Envoyer un message de bienvenue
    logger.warn("Page visitée"); // Enregistrer l'accès à la page d'accueil
});

// Route pour vérifier le mot de passe
app.post("/check-password", (req, res) => {
    const { password } = req.body; // Récupérer le mot de passe de la requête
    const correctPassword = process.env.SHARED_PASSWORD; // Récupérer le mot de passe de l'environnement
    if (password === correctPassword) {
        logger.info("Mot de passe correct."); // Enregistrer un message d'information
        return res.json({ success: true });
        
    } else {
        logger.warn("Mot de passe incorrect."); // Enregistrer un avertissement
        return res.json({ success: false });
    }
});

// Route pour vérifier le mot de passe Admin
app.post("/check-admin-password", (req, res) => {
    const { password } = req.body; // Récupérer le mot de passe de la requête
    
    if (password === ADMIN_PASSWORD) {
        logger.info("Acces Admin accordé."); // Enregistrer un message d'information
        return res.json({ success: true });
    } else {
        logger.warn("Mot de passe Admin incorrect."); // Enregistrer un avertissement
        return res.json({ success: false });
    }
});

// Fonction pour vérifier si l'email est valide
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Fonction pour verifier si le nom est valide
function isValidName(name) {
    const nameRegex = /^[a-zA-Z]+$/; // Le nom ne doit contenir que des lettres
    return nameRegex.test(name);
}

// Fonction pour envoyer un email
async function sendEmail(recepientEmail, secretSantaName) {
    try {      
            //Configuration de Nodemailer
            const transporter = nodemailer.createTransport({
                service: "gmail",
                auth: {
                    user: process.env.EMAIL, // utilisation de la variable d'environnement pour l'email
                    pass: process.env.APP_PASS// Utilisation de la variable d'environnement pour le mot de passe
                },
            });

            //Contenu de l'email
            const mailOptions = {
                from: `"Secret Santa 🎅" <${process.env.EMAIL}>`, // Adresse de l'expéditeur
                to: recepientEmail,
                subject: "Votre Secret Santa 🎄",
                text: `Bonjour ! Vous êtes le Secret Santa de ${secretSantaName},Joyeux Noël !🎁`
            };

            //Envoyer l'email
            const info = await transporter.sendMail(mailOptions);
            console.log(`Email envoyé: ${info.response}`);
        } catch (error) {
            console.error("Erreur lors de l'envoi de l'email:", error);
        }
}

// Route pour ajouter un participant
app.post("/add-participant", async (req, res) => {
    let { name, email } = req.body;
    // Convertir le nom et l'email en majuscules
    name = name.toUpperCase();
    email = email.toUpperCase();

    // Vérifier si le nom et l'email sont fournis
    if (!name || !email) {
        logger.warn("Nom ou email manquant."); // Enregistrer une erreur
        return res.json({ success: false, message: "Nom ou email manquant." });
    }
    
    // Vérifier le nom unique
    const existingParticipant = await Participant.findOne({name});
    if (existingParticipant) {
        logger.warn("Nom déjà ajouté."); // Enregistrer un avertissement
        return res.json({ success: false, message: "Nom déjà ajouté." });
    }

    // vérifier la validité du nom
    if (!isValidName(name)) {
        logger.warn("Nom invalide"); // Enregistrer un avertissement
        return res.json({ success: false, message: "Nom invalide." });
    }

     // Vérifier l'email valide
     if (!isValidEmail(email)) {
        logger.warn("Email invalide"); // Enregistrer un avertissement
        return res.json({ success: false, message: "Format d'Email invalide." });
    }
    
    try {
        const newParticipant = new Participant({ name, email });
        await newParticipant.save();

        const participants = await Participant.find(); // Récupérer la liste des participants
        
        logger.info(`Participant ajouté: Nom:=${name}, Email=${email}`); // Enregistrer l'ajout du participant
        res.json({ success: true, message: "Participant ajouté avec succès.", participants });
    } catch (error) {
            logger.error("Erreur lors de l'ajout du participant:", error); // Enregistrer une erreur
            return res.json({ success: false, message: "Erreur lors de l'ajout du participant." });
        }
    }
);
// Route pour afficher les participants
app.get("/participants", async(req, res) => {
    try {
        const participants = await Participant.find(); // Récupérer la liste des participants
        res.json({ success: true, participants });
    } catch (error) {
        logger.error("Erreur lors de la récupération des participants:", error); // Enregistrer une erreur
        res.json({ success: false, message: "Erreur lors de la récupération des participants." });
    }
});

// Route pour générer les paires
app.get("/generate-pairs", async(req, res) => {

    const adminPassword = req.headers["x-admin-password"]; // Récupérer le mot de passe Admin du header

    if (adminPassword !== ADMIN_PASSWORD) {
        logger.warn("Accès non autorisé."); // Enregistrer un avertissement
        return res.json({ success: false, message: "Accès non autorisé." });
    }

    try {
        const participants = await Participant.find(); // Récupérer la liste des participants
        if (participants.length < 2) {
            logger.warn("Pas assez de participants."); // Enregistrer un avertissement
            return res.json({ success: false, message: "Pas assez de participants." });
        }
    //Melanger les participants
    const shuffledParticipants = [...participants].sort(() => 0.5 - Math.random());

    //Generer les paires
    const pairs = shuffledParticipants.map((_, i, arr) => ({
            giver: arr[i],
            receiver: arr[(i + 1) % arr.length], // Le receveur est le participant suivant
        }));

    //Envoyer les emails
    for (const pair of pairs) {
        try {
            await sendEmail(pair.receiver.email, pair.giver.name); // Envoyer l'email à chaque participant
        } catch (error) {
            logger.error("Erreur lors de l'envoi de l'email:", error); // Enregistrer une erreur
            return res.json({ success: false, message: "Erreur lors de l'envoi de l'email." });
        }
    }
    logger.info("Paires générées et emails envoyés."); // Enregistrer un message d'information
    res.json({ success: true, pairs });

    }   catch (error) {
            logger.error("Erreur lors de la génération des paires:", error); // Enregistrer une erreur
            res.json({ success: false, message: "Erreur lors de la génération des paires." });
    }

});

// Route pour réinitialiser les participants
app.get("/reset", async (req, res) => {
    const { password } = req.body;

    if (password !== process.env.ADMIN_PASSWORD) {
        logger.warn("Tentative de réinitialisation avec un mot de passe incorrect.");
        return res.json({ success: false, message: "Accès non autorisé." });
    }
    try {
        await Participant.deleteMany(); // Supprimer tous
        logger.info("Participants réinitialisés."); // Enregistrer un message d'information
        res.json({ success: true, message: "Participants réinitialisés." });
    } catch (error) {
        logger.error("Erreur lors de la réinitialisation des participants:", error); // Enregistrer une erreur
        res.json({ success: false, message: "Erreur lors de la réinitialisation des participants." });
    }
}); 

// Démarrer le serveur
app.listen(port, () => {
    logger.info(`Serveur en cours d'exécution sur http://localhost:${port}`);
    console.log(`Server running on http://localhost:${port}`);
}
);
   
