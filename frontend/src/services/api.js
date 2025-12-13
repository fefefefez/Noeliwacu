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

export const getParticipants = async (code) => {
    try {
        const response = await fetch(`${API_URL}/participants/party/${code}`);
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

export const sendDraw = async (code, adminPin) => {
    try {
        const response = await fetch(`${API_URL}/parties/${code}/draw/send`, {
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

