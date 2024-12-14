const API_URL = "http://localhost:3000"; // URL de l'API
// Vérifier le mot de passe partagé
async function checkPassword() {
    const enteredPassword = document.getElementById("password-input").value;
    const modal = document.getElementById("password-modal"); // Récupérer la fenêtre modale
    const mainContainer = document.getElementById("main-container"); // Récupérer le conteneur principal
    const modalError = document.getElementById("modal-error"); // Message d'erreur

    try {
        //envoyer une requête POST du mot de passe
        const response = await fetch(`${API_URL}/check-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: enteredPassword }),
        });
        const result = await response.json();

        if (result.success) {
            modal.classList.add("hidden"); // Masquer la fenêtre modale
            mainContainer.classList.remove("hidden"); // Afficher le conteneur principal
            console.log("Mot de passe correct.");
        } else {
            console.log("Mot de passe incorrect.");
            modalError.classList.remove("hidden");
            modalError.textContent = "Mot de passe incorrect.";
            modalError.classList.add("visible"); // Afficher le message d'erreur
    
            setTimeout(() => {
                modalError.classList.remove("visible");
                modalError.classList.add("hidden");
            }, 2000);
        }
        
    } catch (error) {
        // Afficher une erreur si la requête échoue
        console.error("Erreur lors de l'envoi de la requête POST:", error);
        modalError.classList.remove("hidden");
        modalError.textContent = "Une erreur s'est produite lors de la vérification du mot de passe.";
        modalError.classList.add("visible"); // Afficher le message d'erreur

        setTimeout(() => {
            modalError.classList.remove("visible");
            modalError.classList.add("hidden");
        }, 2000);
        
    }

    
}
// Vérifier le mot de passe admin
async function authenticateAdmin() {
    const adminPassword = document.getElementById("admin-password-input").value;
    const adminModal = document.getElementById("admin-modal");
    const adminError = document.getElementById("admin-modal-error");

    try {
        const response = await fetch(`${API_URL}/check-admin-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: adminPassword }),
        });
        const result = await response.json();

        if (result.success) {
            adminModal.classList.add("hidden"); // Masquer la modale
            console.log("Accès administrateur accordé.");
            enableAdminFeatures(); // Activer les fonctionnalités Admin
        } else {
            adminError.classList.remove("hidden");
            adminError.textContent = "Mot de passe incorrect.";
            setTimeout(() => adminError.classList.add("hidden"), 2000);
            console.log("Mot de passe administrateur incorrect.");
        }
    } catch (error) {
        console.error("Erreur lors de l'authentification admin :", error);
        adminError.classList.remove("hidden");
        adminError.textContent = "Erreur de connexion.";
        setTimeout(() => adminError.classList.add("hidden"), 2000);
    }
}
// Vérifier si l'email est valide
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}
// Masquer le message d'erreur
function hideErrorMessage() {
    const errorMessageDiv = document.getElementById("error-message");
    errorMessageDiv.textContent = ""; // Effacer le message d'erreur
    errorMessageDiv.classList.remove("visible"); // Rendre le message d'erreur invisible
}
// Afficher un message de succès
function showSuccessMessage(message) {
    const successMessageDiv = document.getElementById("success-message");
    successMessageDiv.textContent = message; // Afficher le message de succès
    successMessageDiv.classList.add("visible"); // Rendre le message de succès visible

    setTimeout(hideSuccessMessage, 2000); // Masquer le message de succès après 5 secondes
}
// Afficher un message d'erreur
function showErrorMessage(message) {
    const errorMessageDiv = document.getElementById("error-message");
    errorMessageDiv.textContent = message; // Afficher le message d'erreur
    errorMessageDiv.classList.add("visible"); // Rendre le message d'erreur visible

    setTimeout(hideErrorMessage, 2000); // Masquer le message d'erreur après 5 secondes
}
// Masquer le message de succès
function hideSuccessMessage() {
    const successMessageDiv = document.getElementById("success-message");
    successMessageDiv.textContent = ""; // Effacer le message de succès
    successMessageDiv.classList.remove("visible"); // Rendre le message de succès invisible
}
// Ajouter un participant
async function addParticipant() {
    let name = document.getElementById("participant-name").value.trim();
    let email = document.getElementById("participant-email").value.trim();

    if (!name || !email)
    {
        showErrorMessage("Veuillez entrer un nom et une adresse email.");
        return;
    }
    if (!isValidEmail(email))
    {
        showErrorMessage("Veuillez entrer une adresse email valide.");
        return; // Arrêter la fonction si l'email est invalide
    }

    //longueur du nom et de l'email
    if (name.length > 50)
    {
        showErrorMessage("Izina ni rinini gose .");
        return;
    }
    if (email.length > 100)
    {
        showErrorMessage("Iyo email ni ndende gose .");
        return;
    }
    //convertir le nom et l'email en majuscules
    name = name.toUpperCase();
    email = email.toUpperCase();

    try {
        const response = await fetch(`${API_URL}/add-participant`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, email }),
        });
    
    const result = await response.json();
    console.log("Reponse Backend : ",result);
    if (result.success) {
        // Mettre à jour la liste des participants
        updateParticipantsList(result.participants);
        document.getElementById("participant-name").value = "";
        document.getElementById("participant-email").value = "";

        // Afficher un message de succès
        showSuccessMessage("Vous avez été ajouté avec succès !");
    } else {
        showErrorMessage(result.message || "Une erreur s'est produite lors de l'ajout du participant.");
    }
    }
    catch (error) {
        showErrorMessage(error.message || "Une erreur s'est produite lors de l'envoi de la requête POST.");
        console.error("Erreur lors de l'envoi de la requête POST:", error);
    }

}

//anonymiser les emails
function anonymizeEmail(email) {
    const [username, domain] = email.split("@");
    const maskedDomain = domain.replace(/./g, "*");
    return `${username.slice(0, 2)}******@${maskedDomain}`;
}

// Mettre à jour la liste des participants
function updateParticipantsList(participants) {
    const list = document.getElementById("participants-list");

    list.innerHTML = participants.map((p) => `<li>
                                                <span>🎅 ${p.name}</span>
                                                <span class = "email">${anonymizeEmail(p.email)}</span>
                                                </li>`).join("");
}

// Afficher la liste des participants
async function getParticipants() {
    try {

        const response = await fetch(`${API_URL}/participants`);
        const result = await response.json();

        console.log("Reponse Backend : ",result);

        if (result.success) {
            updateParticipantsList(result.participants);
        } else {
            showErrorMessage("Une erreur s'est produite lors de la récupération des participants.");
            console.error(result.message);
        }
    } catch (error) {
        showErrorMessage("Une erreur s'est produite lors de la récupération des participants.");
        console.error("Erreur lors de l'envoi de la requête GET:", error);
    }
}
//charger les participants
document.addEventListener("DOMContentLoaded", getParticipants);
async function generatePairs() {
    const adminPassword = prompt("Veuillez entrer le mot de passe Admin pour continuer.");
    
    if (!adminPassword){
        showErrorMessage("Mot de passe Admin requis pour générer les paires.");
        return;
    }

    const confirmMessage = "Êtes-vous sûr de vouloir générer les paires ? Cette action ne peut pas être annulée.";
    if (!confirm(confirmMessage)) return;


    try {
        const response = await fetch(`${API_URL}/generate-pairs`, {
            method: "GET",
            headers: { "Content-Type": "application/json" ,
                        "x-admin-password": adminPassword, // Ajouter le mot de passe Admin dans les en-têtes
            },
        });

    const result = await response.json();

    if (result.success) {
        showSuccessMessage("Les paires ont été générées avec succès !");
    } else {
        showErrorMessage(result.message || "Une erreur s'est produite lors de la génération des paires.");
    }
        
    } catch (error) {
        showErrorMessage(error.message || "Une erreur s'est produite lors de l'envoi de la requête GET.");
        console.error("Erreur lors de l'envoi de la requête GET:", error);
    }

    
}

// Activer  les fonctionnalités Admin
function enableAdminFeatures() {
    const generatePairsButton = document.querySelector("button[onclick='generatePairs()']");
    generatePairsButton.style.display = "block"; // Afficher le bouton pour les utilisateurs Admin
}
// desactiver le bouton de génération des paires pour les utilisateurs non autorisés
function disableAdminButtons() {
    const generatePairsButton = document.querySelector("button[onclick='generatePairs()']");
    generatePairsButton.style.display = "none"; // Masquer le bouton pour les utilisateurs normaux
}

// Appeler la fonction pour désactiver les boutons Admin
document.addEventListener("DOMContentLoaded", () => {
    const isAdmin = confirm("Etes-vous un Admin ?");
    if (!isAdmin) {
        disableAdminButtons();
    } 
    else {
       const adminModal = document.getElementById("admin-modal");
       adminModal.classList.remove("hidden");  // Afficher la fenêtre modale Admin
    }
});

// Ajouter les flocons de neige
const MAX_SNOWFLAKES = 100;
const snowflakes = [];

function createSnowflakes() {
    if (snowflakes.length >= MAX_SNOWFLAKES) {
        // Retirer les anciens flocons si la limite est atteinte
        snowflakes.shift().remove();
    }

    const snowflake = document.createElement("div");
    snowflake.classList.add("snowflake");
    snowflake.textContent = "❄";
    snowflake.style.left = `${Math.random() * 100}vw`;
    snowflake.style.animationDuration = `${Math.random() * 3 + 2}s`;
    snowflake.style.fontSize = `${Math.random() * 10 + 10}px`;

    document.body.appendChild(snowflake);
    snowflakes.push(snowflake);

    setTimeout(() => {
        snowflake.remove();
        const index = snowflakes.indexOf(snowflake);
        if (index > -1) snowflakes.splice(index, 1);
    }, 5000);
}
// Générer des flocons en boucle toutes les 50ms
setInterval(createSnowflakes, 50);
