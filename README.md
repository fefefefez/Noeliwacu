# Secret Santa - Noeli Iwacu

Application web permettant d'organiser un Secret Santa entre plusieurs participants.

Le projet a d'abord été créé pour être utilisé avec ma famille, puis amélioré avec une deuxième version comprenant un backend Node.js, une base MongoDB et une interface React.

## Fonctionnalités

- Création d'une fête avec un code unique
- Protection de l'administration avec un PIN
- Ajout des participants avec leur groupe familial
- Wishlist de maximum 3 cadeaux
- Tirage automatique
- Le tirage essaie d'éviter les personnes du même groupe familial
- Envoi du résultat par email
- Tableau de bord pour l'organisateur

## Technologies

### Frontend

- React
- React Router
- CSS
- Fetch API

### Backend

- Node.js
- Express
- MongoDB / Mongoose
- Nodemailer
- bcrypt
- Winston
### Prérequis
- Node.js
- npm
- MongoDB, en local ou avec MongoDB Atlas

Un compte Gmail avec un mot de passe d'application est nécessaire uniquement pour envoyer de vrais emails.

## Installation

Cloner le projet :

```bash
git clone https://github.com/fefefefez/Secret-santa.git
cd Secret-santa
```

Installer le backend :

```bash
cd backend
npm install
```

Installer le frontend :

```bash
cd ../frontend
npm install
```

## Configuration

Créer un fichier `.env` dans le dossier `backend` :

```env
MONGODB_URI=your_mongodb_connection
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:3001

EMAIL=your_email@gmail.com
APP_PASS=your_gmail_app_password

TEST_MODE=true
```

`TEST_MODE=true` permet de tester le tirage sans réellement envoyer les emails. Les variables `EMAIL` et `APP_PASS` sont nécessaires pour l'envoi réel.

Le frontend utilise par défaut l'API locale :

```text
http://localhost:3000/api
```

Une autre URL peut être définie avec :

```env
REACT_APP_API_URL=...
```

## Lancer le projet

Backend :

```bash
cd backend
npm run dev
```

Frontend :

```bash
cd frontend
npm start
```

Le frontend est ensuite disponible sur :

```text
http://localhost:3001
```

## Sécurité

Quelques améliorations ont été ajoutées pendant la V2 :

- PIN administrateur hashé avec bcrypt
- Limitation des tentatives de PIN
- Validation des données reçues par le backend
- Protection de la liste des participants et des actions de tirage avec le PIN administrateur
- Échappement du contenu utilisateur dans les emails HTML
- Génération des codes de fête avec `crypto.randomInt`
