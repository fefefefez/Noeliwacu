import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import JoinParty from './JoinParty';
import { addParticipant, getParty } from '../services/api';

jest.mock('../services/api');
jest.mock('react-dom/test-utils', () => ({ ...jest.requireActual('react-dom/test-utils'), act: jest.requireActual('react').act }));

beforeEach(() => jest.resetAllMocks());

function openRegistration() {
    return render(<MemoryRouter initialEntries={['/join/TEST21']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes><Route path="/join/:code" element={<JoinParty />} /></Routes>
    </MemoryRouter>);
}

test('un souhait trop long ne quitte pas le formulaire et peut être corrigé', async () => {
    getParty.mockResolvedValue({ success: true, party: { name: 'Fête test', families: ['A'] } });
    addParticipant.mockResolvedValue({ success: true });
    openRegistration();
    const wish = await screen.findByPlaceholderText('Idée cadeau 1');
    expect(screen.getByText(/1000 caractères maximum par souhait/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('ex: Jean Bagabo'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByPlaceholderText('ex: jean@exemple.com'), { target: { value: 'alice@example.invalid' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'A' } });
    fireEvent.change(wish, { target: { value: 'x'.repeat(1001) } });
    fireEvent.submit(wish.form);
    expect(screen.getByText(/Raccourcissez-le ou laissez le champ vide/)).toBeInTheDocument();
    expect(addParticipant).not.toHaveBeenCalled();
    expect(wish).toHaveValue('x'.repeat(1001));

    const link = 'https://shop.example.invalid/produit?reference='.padEnd(1000, 'x');
    fireEvent.change(wish, { target: { value: link } });
    fireEvent.submit(wish.form);
    expect(await screen.findByText(/Vous avez rejoint la fête/)).toBeInTheDocument();
    expect(addParticipant).toHaveBeenCalledTimes(1);
    expect(addParticipant).toHaveBeenCalledWith('TEST21', expect.objectContaining({ wishList: [link] }));
});

test('une réponse tardive ne réaffiche pas le formulaire de l’ancien code', async () => {
    let resolveOldParty;
    getParty.mockImplementationOnce(() => new Promise(resolve => { resolveOldParty = resolve; }))
        .mockRejectedValueOnce(new Error('Fête introuvable'));
    openRegistration();
    fireEvent.change(screen.getByPlaceholderText('ABC123'), { target: { value: 'AUTRE1' } });
    expect(await screen.findByText('Erreur lors du chargement de la fête')).toBeInTheDocument();
    await act(async () => resolveOldParty({ success: true, party: { name: 'Ancienne fête', families: ['A'] } }));
    expect(screen.queryByText(/Ancienne fête/)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Idée cadeau 1')).not.toBeInTheDocument();
});

test('double soumission et réponse perdue : un seul POST et aucun échec affirmé', async () => {
    getParty.mockResolvedValue({ success: true, party: { name: 'Fête test', families: ['A'] } });
    let rejectRegistration;
    addParticipant.mockImplementation(() => new Promise((resolve, reject) => { rejectRegistration = reject; }));
    openRegistration();
    const wish = await screen.findByPlaceholderText('Idée cadeau 1');
    fireEvent.submit(wish.form);
    fireEvent.submit(wish.form);
    expect(addParticipant).toHaveBeenCalledTimes(1);
    expect(screen.getByPlaceholderText('ABC123')).toBeDisabled();
    await act(async () => rejectRegistration(new TypeError('Network error')));
    expect(screen.getByText(/Impossible de confirmer l’inscription/)).toBeInTheDocument();
    expect(addParticipant).toHaveBeenCalledTimes(1);
});

test('fête déjà tirée : le formulaire est remplacé par le message de clôture', async () => {
    getParty.mockResolvedValue({ success: true, party: { name: 'Fête test', families: ['A'], drawDone: true } });
    openRegistration();
    expect(await screen.findByText(/Les inscriptions sont clôturées/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Idée cadeau 1')).not.toBeInTheDocument();
    expect(addParticipant).not.toHaveBeenCalled();
});
