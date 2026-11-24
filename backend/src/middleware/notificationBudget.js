const { performance } = require('node:perf_hooks');

// Le budget commence avant l'authentification. Une authentification ou une
// reservation tardive ne peut donc pas lancer SMTP apres la reponse HTTP.
function createNotificationBudget({ requestBudgetMs = 24000 } = {}) {
    return (req, res, next) => {
        const controller = new AbortController();
        const deadline = performance.now() + requestBudgetMs;
        req.notificationBudget = { signal: controller.signal,
            remaining: () => Math.max(0, deadline - performance.now()) };
        const timer = setTimeout(() => {
            controller.abort(); // Annule reellement le message Nodemailer actif.
            if (!res.headersSent && !res.destroyed) res.status(503).json({ success: false,
                code: 'NOTIFICATION_REQUEST_DEADLINE', verificationRequired: true, retryable: false,
                message: 'Délai atteint. Vérifiez le suivi avant toute nouvelle action.' });
        }, requestBudgetMs);
        const cleanup = () => {
            clearTimeout(timer);
            if (!res.writableFinished) controller.abort();
        };
        res.once('finish', cleanup);
        res.once('close', cleanup);
        next();
    };
}

module.exports = { createNotificationBudget };
