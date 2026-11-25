import { useState } from 'react';
import { MAX_WISH_LENGTH, WISH_LENGTH_ERROR } from '../utils/helpers';

export default function AdminParticipantForm({ person, families, disabled, onSave, onCancel }) {
    const [values, setValues] = useState(() => ({
        name: person?.name ?? '', email: person?.email ?? '', familyGroup: person?.familyGroup ?? '',
        wishList: [0, 1, 2].map(index => person?.wishList?.[index] ?? '')
    }));
    const change = (key, value) => setValues(previous => ({ ...previous, [key]: value }));
    const wishTooLong = values.wishList.some(wish => wish.trim().length > MAX_WISH_LENGTH);

    return <form onSubmit={event => { event.preventDefault(); if (!wishTooLong) onSave(values); }}>
        <h3>{person ? `Modifier ${person.name}` : 'Nouvelle inscription'}</h3>
        <fieldset disabled={disabled}>
            <label>Nom<input required minLength={2} maxLength={50} value={values.name}
                onChange={event => change('name', event.target.value)} /></label>
            <label>Email<input required type="email" value={values.email}
                onChange={event => change('email', event.target.value)} /></label>
            <label>Famille<select required value={values.familyGroup} onChange={event => change('familyGroup', event.target.value)}>
                <option value="">Choisir une famille</option>
                {families.map(family => <option key={family} value={family}>{family}</option>)}
            </select></label>
            <small>Lien de produit accepté. {MAX_WISH_LENGTH} caractères maximum par souhait.</small>
            {values.wishList.map((wish, index) => <label key={index}>Souhait {index + 1} (facultatif)
                <input value={wish} onChange={event => change('wishList',
                    values.wishList.map((item, position) => position === index ? event.target.value : item))} />
            </label>)}
            {wishTooLong && <p role="alert">{WISH_LENGTH_ERROR}</p>}
            <button className="primary" type="submit" disabled={wishTooLong}>Enregistrer l’inscription</button>
        </fieldset>
        <button type="button" onClick={onCancel} disabled={disabled}>Annuler</button>
    </form>;
}
