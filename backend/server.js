require("dotenv").config(); // Importer le module dotenv pour gérer les variables d'environnement
const express = require("express"); // Importer le module express
const cors = require("cors");       // Importer le module cors
const logger = require("./logs/logger"); // Importer le module winston
const mongoose = require("mongoose"); // Importer le module mongoose

// Import des routes
const partyRoutes = require("./src/routes/parties");
const participantRoutes = require("./src/routes/participants");
const drawRoutes = require("./src/routes/draw");

const app = express();
const PORT = process.env.PORT || 3000;

// ====== MIDDLEWARE ======
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json()); // Middleware pour parser le JSON

// Logger les requetes HTTP entrantes
app.use((req, res, next) => {
    logger.info(`${req.method} request`);
    next();
});

// ====== ROUTES ======

// Route racine
app.get("/", (req, res) => {
    res.json({
        message: "Secret Santa API V2",
        version: "2.0",
        endpoints: {
            parties: {
                createParty: 'POST /api/parties',
                getParty: 'GET /api/parties/:code',
                updateParty: 'PUT /api/parties/:code',
                deleteParty: 'DELETE /api/parties/:code'
            },
            participants: {
                addParticipant: 'POST /api/participants/:code',
                getParticipants: 'GET /api/participants/party/:code',
                updateParticipant: 'PUT /api/participants/:id',
                deleteParticipant: 'DELETE /api/participants/:id'
            },
            draw: {
                preview: 'POST /api/parties/:code/draw/preview',
                send: 'POST /api/parties/:code/draw/send',
                status: 'GET /api/parties/:code/draw/status'
            }
        }
    });
});

// Routes principales
app.use("/api/parties", partyRoutes);
app.use("/api/participants", participantRoutes);
app.use("/api/parties", drawRoutes);

// Route 404
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Route non trouvée",
    });
});

// ===== connection à la BD =====
mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => {
        logger.info("✅ Connecté à la base de données MongoDB");

        // Démarrer le serveur
        app.listen(PORT, () => {
            logger.info(`🚀 Serveur démarré sur le port ${PORT}`);
            logger.info(`📍 Mode: ${process.env.NODE_ENV || 'development'}`);
            logger.info(`📧 Email configuré: ${process.env.EMAIL ? 'oui' : 'non'}`);
            logger.info(`🧪 TEST_MODE: ${process.env.TEST_MODE === 'true' ? 'ACTIVÉ ⚠️' : 'DÉSACTIVÉ'}`);
        });
    })
    .catch((error) => {
        logger.error('❌ Erreur de connexion à la base de données MongoDB');
        process.exit(1);
    });

// Gestion des erreurs non capturées
process.on("unhandledRejection", (err) => {
    logger.error('❌ Erreur non gérée ');
    process.exit(1);
});