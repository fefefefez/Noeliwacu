const { createLogger, format, transports } = require('winston');

// configuration du logger
const logger = createLogger({
    level: 'info', // Niveau minimal des logs à afficher
    format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), // Ajouter le timestamp
        format.printf(({ timestamp, level, message }) => {
            return `${timestamp} ${level}: ${message}`;
        })
    ),
    transports: [
        new transports.Console(), // Afficher les logs dans la console
        new transports.File({ filename: 'logs/logs.log' }), // Enregistrer les logs dans un fichier
        new transports.File({ filename: 'logs/error.log', level: 'error' }), // Enregistrer les erreurs dans un fichier séparé
        new transports.File({ filename: 'logs/warn.log', level: 'warn' }) // Enregistrer les avertissements dans un fichier séparé
    ]
});

module.exports = logger;