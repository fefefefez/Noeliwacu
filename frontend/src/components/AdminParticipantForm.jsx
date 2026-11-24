import { useState } from 'react';

export default function AdminParticipantForm({ person, families, disabled, onSave, onCancel }) {
    const [values, setValues] = useState(() => ({
        name: person?.name ?? '', email: person?.email ?? '', familyGroup: person?.familyGroup ?? '',
        wishList: [0, 1, 2].map(index => person?.wishList?.[index] ?? '')
    }));
    const change = (key, value) => setValues(previous => ({ ...previous, [key]: value }));

    return <form onSubmit={event => { event.preventDefault(); onSave(values); }}>
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
            {values.wishList.map((wish, index) => <label key={index}>Souhait {index + 1} (facultatif)
                <input maxLength={100} value={wish} onChange={event => change('wishList',
                    values.wishList.map((item, position) => position === index ? event.target.value : item))} />
            </label>)}
            <button className="primary" type="submit">Enregistrer l’inscription</button>
        </fieldset>
        <button type="button" onClick={onCancel} disabled={disabled}>Annuler</button>
    </form>;
}
