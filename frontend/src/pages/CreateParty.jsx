import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createParty } from '../services/api';

export default function CreateParty() {
    const navigate = useNavigate();
    const [formData, setFormData] = useState({
        name: '',
        adminPin: '',
        families: ['', ''],
        budget: '',
        date: ''
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleAddFamily = () => {
        setFormData({ ...formData, families: [...formData.families, ''] });
    };

    const handleFamilyChange = (index, value) => {
        const newFamilies = [...formData.families];
        newFamilies[index] = value;
        setFormData({ ...formData, families: newFamilies });
    };

    const handleRemoveFamily = (index) => {
        if (formData.families.length > 2) {
            const newFamilies = formData.families.filter((_, i) => i !== index);
            setFormData({ ...formData, families: newFamilies });
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        const validFamilies = formData.families.filter(f => f.trim());

        if (validFamilies.length < 2) {
            setError('Vous devez avoir au moins 2 familles');
            setLoading(false);
            return;
        }

        try {
            const data = await createParty({
                name: formData.name,
                adminPin: formData.adminPin,
                families: validFamilies,
                budget: formData.budget ? parseInt(formData.budget) : undefined,
                date: formData.date || undefined
            });

            if (data.success) {
                const partyCode = data.party?.code;

                if (!partyCode) {
                    setError('Erreur : code de fête non reçu');
                    setLoading(false);
                    return;
                }

                navigate(`/admin/${partyCode}`);
            } else {
                setError(data.message);
            }
        } catch (err) {
            setError('Erreur lors de la création de la fête. Vérifiez que le backend tourne sur le port 3000.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <header>
                <h1>🎅 Créer une Nouvelle Fête</h1>
                <p>Configurez votre événement Secret Santa</p>
            </header>

            <main className="container">
                <div className="card" style={{ maxWidth: '600px', margin: '40px auto' }}>
                    <form onSubmit={handleSubmit}>
                        {/* Party Name */}
                        <div>
                            <label>Nom de la Fête *</label>
                            <input
                                type="text"
                                placeholder="Noël 2025"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                required
                            />
                        </div>

                        {/* Admin PIN */}
                        <div>
                            <label>Creer Votre PIN Administrateur (4 chiffres) *</label>
                            <input
                                type="password"
                                placeholder="1234"
                                pattern="[0-9]{4}"
                                title="Veuillez entrer exactement 4 chiffres"
                                maxLength="4"
                                value={formData.adminPin}
                                onChange={(e) => setFormData({ ...formData, adminPin: e.target.value })}
                                required
                            />
                            <small style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.9rem', display: 'block', marginTop: '5px' }}>
                                Vous aurez besoin de ce nouveau PIN pour gérer la fête
                            </small>
                        </div>

                        {/* Budget */}
                        <div>
                            <label>Budget (optionnel)</label>
                            <input
                                type="number"
                                placeholder="15"
                                min="1"
                                value={formData.budget}
                                onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                            />
                        </div>

                        {/* Date */}
                        <div>
                            <label>Date d'échange de cadeaux (optionnel)</label>
                            <input
                                type="date"
                                value={formData.date}
                                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                            />
                        </div>

                        {/* Family Groups */}
                        <div style={{ marginTop: '20px' }}>
                            <label>Familles * (min. 2)</label>

                            {formData.families.map((family, index) => (
                                <div
                                    key={index}
                                    style={{
                                        display: 'flex',
                                        gap: '10px',
                                        marginBottom: '10px',
                                        alignItems: 'center'
                                    }}
                                >
                                    {/* ✅ INPUT PREND TOUTE LA PLACE DISPONIBLE */}
                                    <input
                                        type="text"
                                        placeholder={`Famille ${index + 1} (ex: Martin, Dupont)`}
                                        value={family}
                                        onChange={(e) => handleFamilyChange(index, e.target.value)}
                                        required
                                        style={{
                                            flex: 1,
                                            margin: 0
                                        }}
                                    />

                                    {/* ✅ BOUTON A UNE LARGEUR FIXE */}
                                    {formData.families.length > 2 && (
                                        <button
                                            type="button"
                                            className="primary"
                                            onClick={() => handleRemoveFamily(index)}
                                            style={{
                                                background: '#dc2626',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '8px',
                                                width: '45px',
                                                height: '45px',
                                                minWidth: '45px',
                                                flexShrink: 0,
                                                cursor: 'pointer',
                                                fontSize: '20px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                transition: 'all 0.2s',
                                                padding: 0
                                            }}
                                            onMouseEnter={(e) => {
                                                e.target.style.background = '#b91c1c';
                                                e.target.style.transform = 'scale(1.05)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.target.style.background = '#dc2626';
                                                e.target.style.transform = 'scale(1)';
                                            }}
                                            aria-label={`Supprimer la famille ${index + 1}`}
                                        >
                                            ✕
                                        </button>
                                    )}
                                </div>
                            ))}

                            <button
                                type="button"
                                className="secondary"
                                onClick={handleAddFamily}
                                style={{ width: '100%', marginTop: '10px' }}
                            >
                                + Ajouter une Famille
                            </button>
                        </div>

                        {/* Error Message */}
                        {error && (
                            <div className="alert alert-error">
                                {error}
                            </div>
                        )}

                        {/* Submit Button */}
                        <button
                            type="submit"
                            className="primary"
                            disabled={loading}
                            style={{ width: '100%', marginTop: '20px' }}
                        >
                            {loading ? 'Création en cours...' : '🎄 Créer la Fête'}
                        </button>
                    </form>

                    {/* Back Button */}
                    <button
                        onClick={() => navigate('/')}
                        style={{
                            width: '100%',
                            marginTop: '10px',
                            background: '#6c757d',
                            color: 'white'
                        }}
                    >
                        ← Retour à l'accueil
                    </button>
                </div>
            </main>
        </>
    );
}
