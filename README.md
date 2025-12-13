# 🎄 Secret Santa V2.0 - Noeli Iwacu

A modern, elegant Secret Santa organizer application with family grouping and intelligent assignment algorithm.

![Secret Santa Banner](https://img.shields.io/badge/Secret_Santa-V2.0-red?style=for-the-badge&logo=christmas)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)
![React](https://img.shields.io/badge/React-18.0+-blue?style=for-the-badge&logo=react)
![Node](https://img.shields.io/badge/Node.js-18.0+-green?style=for-the-badge&logo=node.js)

---

## ✨ Features

### 🎁 **Core Functionality**
- ✅ **Create & Manage Parties** - Organize multiple Secret Santa events
- ✅ **Family Grouping** - Define family groups to avoid intra-family assignments
- ✅ **Intelligent Algorithm** - Smart pairing that prioritizes cross-family assignments
- ✅ **Wish Lists** - Participants can add up to 3 gift ideas
- ✅ **Email Notifications** - Automatic email delivery with assignment details
- ✅ **Admin Dashboard** - Full control over participants and draw status

### 🎨 **Design**
- ✅ **Glassmorphism UI** - Modern, elegant interface with blur effects
- ✅ **Animated Snowflakes** - Festive Christmas atmosphere
- ✅ **Fully Responsive** - Works perfectly on desktop, tablet, and mobile
- ✅ **Dark Theme** - Eye-friendly gradient background

### 🔒 **Security**
- ✅ **Admin PIN Protection** - Secure access to admin features
- ✅ **Unique Party Codes** - 6-character codes for joining parties
- ✅ **Email Verification** - Only participants receive their assignments
- ✅ **One-time Draw** - Prevent accidental re-draws

---

## 🚀 Installation

### **Prerequisites**
- Node.js 18.0 or higher
- MongoDB (local or Atlas)
- Gmail account (for sending emails)

### **1. Clone the Repository**
```bash
git clone https://github.com/yourusername/Secret-Santa-2.0.git
cd Secret-Santa-2.0
```

### **2. Install Backend Dependencies**
```bash
cd backend
npm install
```

### **3. Install Frontend Dependencies**
```bash
cd ../frontend
npm install
```

---

## ⚙️ Configuration

### **Backend Configuration**

Create a `.env` file in the `backend/` folder:

```env
# MongoDB Connection
MONGODB_URI=mongodb://localhost:27017/secretsanta

# Server Configuration
PORT=3000
NODE_ENV=development

# Email Configuration (Gmail)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=Secret Santa <your-email@gmail.com>

# Test Mode (set to false for production)
TEST_MODE=true
```

### **How to Get Gmail App Password:**

1. Go to [Google Account Settings](https://myaccount.google.com/apppasswords)
2. Enable 2-Factor Authentication if not already enabled
3. Generate an "App Password" for "Mail"
4. Copy the 16-character password to `SMTP_PASSWORD`

### **Frontend Configuration**

The frontend automatically connects to `http://localhost:3000/api`.

If you deploy to production, update `frontend/src/services/api.js`:

```javascript
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000/api';
```

---

## 🧪 Usage

### **1. Start the Backend Server**

```bash
cd backend
npm run dev
```

**Expected output:**
```
✅ Connecté à la base de données MongoDB
🚀 Serveur démarré sur le port 3000
📧 Email: your-email@gmail.com
🧪 TEST_MODE: ACTIVÉ ⚠️
```

### **2. Start the Frontend**

```bash
cd frontend
npm start
```

**Expected output:**
```
Compiled successfully!
Local:            http://localhost:3001
```

### **3. Access the Application**

Open your browser and go to **http://localhost:3001**

---

## 📖 How It Works

### **For Admins:**

1. **Create a Party**
   - Click "🎅 Create a New Party"
   - Enter party name, budget, date, and admin PIN
   - Define family groups (e.g., Dupont, Martin, Leclerc)
   - Submit and receive a unique 6-character code

2. **Share the Code**
   - Share the party code with participants
   - Monitor participants joining via the Admin Dashboard

3. **Perform the Draw**
   - Once all participants have joined, click "🎁 Effectuer le Tirage et Envoyer les Emails"
   - The algorithm generates optimal assignments (max cross-family pairs)
   - Emails are sent automatically to all participants

### **For Participants:**

1. **Join a Party**
   - Click "🎁 Join a Party"
   - Enter the 6-character party code
   - Fill in your name, email, family group, and wish list (optional)
   - Submit to join

2. **Receive Assignment**
   - After the admin performs the draw, you'll receive an email
   - The email contains the name and wish list of the person you're buying for
   - Keep it secret! 🤫

---

## 🛠️ Technologies Used

### **Frontend**
- **React** 18.3.1 - UI framework
- **React Router** 6.28.0 - Navigation
- **Axios** - HTTP client
- **CSS3** - Glassmorphism design

### **Backend**
- **Node.js** 18+ - Runtime environment
- **Express** 4.21.2 - Web framework
- **MongoDB** - Database (via Mongoose 8.9.3)
- **Nodemailer** 6.9.16 - Email delivery
- **Bcrypt** 5.1.1 - Password hashing
- **Winston** 3.17.0 - Logging

### **Development Tools**
- **Nodemon** - Auto-restart server
- **dotenv** - Environment variables
- **CORS** - Cross-origin resource sharing

---

## 📂 Project Structure

```
Secret-Santa-2.0/
├── backend/
│   ├── src/
│   │   ├── controllers/      # Business logic
│   │   ├── models/           # MongoDB schemas
│   │   ├── routes/           # API endpoints
│   │   ├── services/         # Email & draw services
│   │   ├── middleware/       # Auth middleware
│   │   └── utils/            # Helpers & validators
│   ├── logs/                 # Winston logger
│   ├── tests/                # Test files
│   ├── server.js             # Entry point
│   └── .env                  # Environment variables
│
├── frontend/
│   ├── src/
│   │   ├── components/       # Reusable components
│   │   ├── pages/            # Main pages
│   │   ├── services/         # API service
│   │   ├── utils/            # Helper functions
│   │   ├── App.js            # Main app component
│   │   └── App.css           # Global styles
│   └── public/               # Static assets
│
└── README.md                 # You are here!
```

---

## 🎲 Algorithm Explanation

The assignment algorithm uses a **shuffling + validation** approach:

1. **Shuffle participants** randomly
2. **Create pairs** where each person gives to the next in line
3. **Validate constraints:**
   - No one gives to themselves
   - No one receives from themselves
   - Minimize intra-family assignments
4. **Re-shuffle if needed** (max 100 attempts)
5. **Return best solution** (prioritizes cross-family pairs)

**Example:**
```
Alice Dupont (Dupont)    →  Bob Martin (Martin)     ✅ Cross-family
Bob Martin (Martin)      →  Charlie Leclerc (Leclerc) ✅ Cross-family
Charlie Leclerc (Leclerc) → Diana Dupont (Dupont)    ✅ Cross-family
Diana Dupont (Dupont)    →  Alice Dupont (Dupont)    ⚠️ Intra-family (if unavoidable)
```

---

## 🧪 Testing

### **Test Mode**

When `TEST_MODE=true` in `.env`:
- Emails are **not actually sent**
- Email content is logged to the console
- Perfect for development and testing

**Example log:**
```bash
✉️ [TEST MODE] Email simulé pour Alice Dupont (alice@test.com)
======================================================================
Bonjour ALICE DUPONT ! 🎄
🎁 Tu es le Secret Santa de : BOB MARTIN
Liste de souhaits : Montre, Parfum, Vin
======================================================================
```

### **Production Mode**

Set `TEST_MODE=false` to send real emails via Gmail.

---

## 🐛 Troubleshooting

### **Email Not Sending**

1. Check Gmail App Password is correct
2. Ensure 2FA is enabled on Gmail
3. Check `SMTP_USER` and `SMTP_PASSWORD` in `.env`
4. Set `TEST_MODE=true` to see logs

### **Database Connection Error**

1. Ensure MongoDB is running: `mongod` or check MongoDB Atlas connection string
2. Verify `MONGODB_URI` in `.env`

### **Port Already in Use**

```bash
# Kill process on port 3000
npx kill-port 3000

# Or change PORT in .env
PORT=3001
```

---

## 📧 Contact

**Developer:** Ruremesha Fernand  
**Email:** ruremesha2015@gmail.com
---

## 📜 License

MIT License - see [LICENSE](LICENSE) file for details

---

## 🎉 Acknowledgments

- Inspired by the Christmas tradition of Secret Santa
- Built with ❤️ for family and friends
- Special thanks to all contributors

---

## 🎅 Happy Holidays! 🎄

**Made by Ruremesha Fernand • Secret Santa V2.0 • © 2025**
