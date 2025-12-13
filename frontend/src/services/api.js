const API_URL = 'http://localhost:3000/api';

// ===== PARTIES =====
export const createParty = async (partyData) => {
    try {
        const response = await fetch(`${API_URL}/parties`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(partyData)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        throw new Error(`Failed to create party: ${error.message}`);
    }
};

export const getParty = async (code) => {
    try {
        const response = await fetch(`${API_URL}/parties/${code}`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        throw new Error(`Failed to fetch party: ${error.message}`);
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

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        throw new Error(`Failed to add participant: ${error.message}`);
    }
};

export const getParticipants = async (code) => {
    try {
        const response = await fetch(`${API_URL}/participants/party/${code}`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        throw new Error(`Failed to fetch participants: ${error.message}`);
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

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        throw new Error(`Failed to generate draw preview: ${error.message}`);
    }
};

export const sendDraw = async (code, adminPin) => {
    try {
        const response = await fetch(`${API_URL}/parties/${code}/draw/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminPin })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        throw new Error(`Failed to send draw emails: ${error.message}`);
    }
};

export const getDrawStatus = async (code) => {
    try {
        const response = await fetch(`${API_URL}/parties/${code}/draw/status`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        throw new Error(`Failed to fetch draw status: ${error.message}`);
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

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        throw new Error(`Failed to verify admin PIN: ${error.message}`);
    }
};

