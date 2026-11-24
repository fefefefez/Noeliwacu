const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000/api';

// ===== PARTIES =====
export const createParty = async (partyData) => {
    try {
        const response = await fetch(`${API_URL}/parties`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(partyData)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
        }

        return data;
    } catch (error) {
        throw new Error(error.message || 'Erreur de connexion au serveur');
    }
};

export const getParty = async (code) => {
    try {
        const response = await fetch(`${API_URL}/parties/${code}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
        }

        return data;
    } catch (error) {
        throw new Error(error.message || 'Erreur de connexion au serveur');
    }
};

// ===== PARTICIPANTS =====
export const addParticipant = async (code, participantData) => {
    try {
        const response = await fetch(`${API_URL}/participants/party/${code}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(participantData)
        });

        const data = await response.json();

        return data;

    } catch (error) {
        // ✅ Erreur réseau (pas de réponse du serveur)
        throw new Error('Erreur de connexion au serveur. Vérifiez votre connexion internet.');
    }
};

export const getParticipants = async (code, adminPin) => {
    try {
        const response = await fetch(`${API_URL}/participants/party/${code}`, {
            method: 'GET',
            headers: { 'X-Admin-Pin': adminPin }
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
        }

        return data;
    } catch (error) {
        throw new Error(error.message || 'Erreur de connexion au serveur');
    }
};

// ===== DRAW =====
export const generateDrawPreview = async (code, adminPin) => {
    try {
        const response = await fetch(`${API_URL}/parties/${code}/draw/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminPin })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
        }

        return data;
    } catch (error) {
        throw new Error(error.message || 'Erreur de connexion au serveur');
    }
};

// Les erreurs administratives conservent le statut et l'outcome pour que le
// dashboard distingue un refus d'une confirmation perdue. Aucun retry ici.
async function adminRequest(path, adminPin, method, { timeoutMs = 20000, body } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${API_URL}${path}`, {
            method,
            headers: { 'X-Admin-Pin': adminPin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal,
            cache: 'no-store'
        });
        const data = await response.json();
        if (!response.ok || data.success !== true) {
            const error = new Error('La requête administrative n’a pas été confirmée.');
            error.status = response.status;
            error.code = data.code;
            error.outcome = data.outcome;
            error.verificationRequired = data.verificationRequired === true;
            error.detail = data.message;
            throw error;
        }
        return data;
    } finally {
        clearTimeout(timeout);
    }
}

function notificationRequest(code, adminPin, action, method, timeoutMs) {
    return adminRequest(`/parties/${encodeURIComponent(code)}/draw/${action}`, adminPin, method, { timeoutMs });
}

function participantMutation(code, adminPin, method, participantId, body) {
    const target = participantId === undefined ? '' : `/${encodeURIComponent(participantId)}`;
    return adminRequest(`/participants/party/${encodeURIComponent(code)}/admin${target}`, adminPin, method, { body });
}

export const addAdminParticipant = (code, pin, body) => participantMutation(code, pin, 'POST', undefined, body);
export const updateAdminParticipant = (code, pin, id, body) => participantMutation(code, pin, 'PATCH', id, body);
export const deleteAdminParticipant = (code, pin, id) => participantMutation(code, pin, 'DELETE', id);

export const prepareDraw = (code, adminPin) => notificationRequest(code, adminPin, 'prepare', 'POST');
export const getNotifications = (code, adminPin) => notificationRequest(code, adminPin, 'notifications', 'GET');
// Ne pas couper a 20 s une route dont le budget serveur est de 24 s.
// La suspension de la sequence n'annule jamais cette requete.
export const sendNotification = (code, adminPin, participantId) => notificationRequest(code, adminPin,
    `notifications/${encodeURIComponent(participantId)}/send`, 'POST', 35000);

export const getDrawStatus = async (code) => {
    try {
        const response = await fetch(`${API_URL}/parties/${code}/draw/status`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
        }

        return data;
    } catch (error) {
        throw new Error(error.message || 'Erreur de connexion au serveur');
    }
};

// ===== ADMIN PIN =====
export const verifyAdminPin = async (code, adminPin) => {
    try {
        const response = await fetch(`${API_URL}/parties/${code}/verify-pin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminPin })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
        }

        return data;
    } catch (error) {
        throw new Error(error.message || 'Erreur de connexion au serveur');
    }
};

