// script_home.js (MUST BE type="module")
// ================= IMPORTS =================
import {
  auth,
  db,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "./firebase.js";


import {
  collection,
  query,
  orderBy,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";



// ---------------------------
// LOCAL ELEMENTS
// ---------------------------
const emailEl = document.getElementById("authEmail");
const passEl  = document.getElementById("authPass");

const signInBtn  = document.getElementById("signInBtn");
const signUpBtn  = document.getElementById("signUpBtn");
const signOutBtn = document.getElementById("signOutBtn");
const userInfo   = document.getElementById("userInfo");

// The Add Case button exists ONLY on home page
const addCaseBtn = document.getElementById("addCaseBtn");

if (addCaseBtn) {
  addCaseBtn.addEventListener("click", () => {
    window.location.href = "case.html?new=1";
  });
}

// ---------------------------
// DEFINE AUTH HELPERS HERE
// ---------------------------
async function signup(email, password) {
  return await createUserWithEmailAndPassword(auth, email, password);
}

async function login(email, password) {
  return await signInWithEmailAndPassword(auth, email, password);
}

async function logout() {
  return await signOut(auth);
}

// ---------------------------
// FRIENDLY ERROR TRANSLATION
// ---------------------------
function prettyError(error) {
  if (!error || !error.code) return "Unknown error";

  switch (error.code) {
    case "auth/network-request-failed":
      return "Network error. Check your internet connection.";
    case "auth/invalid-email":
      return "Invalid email format.";
    case "auth/missing-password":
      return "Password cannot be empty.";
    case "auth/email-already-in-use":
      return "This email is already registered.";
    case "auth/wrong-password":
      return "Incorrect password.";
    case "auth/user-not-found":
      return "No user exists with this email.";
    default:
      return error.message || "Authentication failed.";
  }
}

// ---------------------------
// SIGN UP
// ---------------------------
signUpBtn.addEventListener("click", async () => {
  const email = emailEl.value.trim();
  const pass = passEl.value.trim();

  if (!email || !pass) {
    alert("Enter email and password.");
    return;
  }

  try {
    await signup(email, pass);
    alert("Signup successful.");
  } catch (e) {
    alert("Signup failed: " + prettyError(e));
    console.error("Signup error:", e);
  }
});

// ---------------------------
// SIGN IN
// ---------------------------
signInBtn.addEventListener("click", async () => {
  const email = emailEl.value.trim();
  const pass = passEl.value.trim();

  if (!email || !pass) {
    alert("Enter email and password.");
    return;
  }

  try {
    await login(email, pass);
    alert("Login successful.");
  } catch (e) {
    alert("Login failed: " + prettyError(e));
    console.error("Login error:", e);
  }
});

// ---------------------------
// SIGN OUT
// ---------------------------
signOutBtn.addEventListener("click", async () => {
  try {
    await logout();
  } catch (e) {
    alert("Sign-out error: " + prettyError(e));
  }
});

// ---------------------------
// AUTH STATE LISTENER
// ---------------------------
onAuthStateChanged(auth, user => {
  if (user) {
    userInfo.textContent = `Logged in as: ${user.email}`;

    signOutBtn.style.display = "inline-block";
    signInBtn.style.display  = "none";
    signUpBtn.style.display  = "none";
    loadCasesForUser(user);
  } else {
    userInfo.textContent = "Not signed in";

    signOutBtn.style.display = "none";
    signInBtn.style.display  = "inline-block";
    signUpBtn.style.display  = "inline-block";
  }
});

async function loadCasesForUser(user) {

  const emailKey = user.email.toLowerCase().replace(/\./g, "_");
  const listEl = document.getElementById("casesList");

  listEl.innerHTML = "<p>Loading cases...</p>";

  try {
    const qy = query(
      collection(db, "users", emailKey, "cases"),
      orderBy("updatedAt", "desc")
    );

    const snap = await getDocs(qy);

    if (snap.empty) {
      listEl.innerHTML = "<p>No cases found.</p>";
      return;
    }

    listEl.innerHTML = "";

    snap.forEach(docSnap => {
      const d = docSnap.data();

      const div = document.createElement("div");
      div.className = "case-card";

      div.innerHTML = `
        <b>Case No:</b> ${d.caseNumber || "-"}<br>
        <b>Name:</b> ${d.name || "-"}<br>
        <b>Updated:</b> ${d.updatedAt?.toDate().toLocaleString() || "-"}
        <br><br>
        <button onclick="openCase('${docSnap.id}')">Open</button>
        <button onclick="exportPDF('${docSnap.id}')">PDF</button>
      `;

      listEl.appendChild(div);
    });

  } catch (e) {
    console.error("Failed to load cases", e);
    listEl.innerHTML = "<p>Error loading cases</p>";
  }
}
window.openCase = function(caseId){
  window.location.href = `case.html?caseId=${caseId}`;
};



