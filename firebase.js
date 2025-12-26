// firebase.js (FINAL – DO NOT MIX CDN IMPORTS ANYWHERE ELSE)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  setDoc,
  updateDoc,
  addDoc,
  getDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  getStorage,
  ref,
  uploadString,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// ---------------- FIREBASE CONFIG ----------------
const firebaseConfig = {
  apiKey: "AIzaSyCPcKrHZUtVCJzrpvrP7JZIu89FhMIZByI",
  authDomain: "oroscope-22db8.firebaseapp.com",
  projectId: "oroscope-22db8",
  storageBucket: "oroscope-22db8.firebasestorage.app",   // ✅ correct bucket
  messagingSenderId: "773478582201",
  appId: "1:773478582201:web:245e72d96b4dca8fe55868",
  measurementId: "G-Z8WJ5N63VB"
};

// ---------------- INITIALIZE APP ----------------
const app = initializeApp(firebaseConfig);

// SINGLETONS (IMPORTANT)
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// ---------------- HELPER: Upload from dataURL or blob ----------------
export async function uploadFromSource(storagePath, source) {
  const targetRef = ref(storage, storagePath);

  // Case A: data URL
  if (typeof source === "string" && source.startsWith("data:")) {
    await uploadString(targetRef, source, "data_url");
    return getDownloadURL(targetRef);
  }

  // Case B: HTTP URL (fetch -> blob -> uploadBytes)
  if (typeof source === "string" && source.startsWith("http")) {
    const resp = await fetch(source);
    if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
    const blob = await resp.blob();
    await uploadBytes(targetRef, blob, { contentType: blob.type });
    return getDownloadURL(targetRef);
  }

  throw new Error("Unsupported source format for upload");
}

// ---------------- EXPORTS ----------------
export {
  auth,
  db,
  storage,

  // auth
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,

  // firestore
  collection,
  doc,
  setDoc,
  updateDoc,
  addDoc,
  getDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,

  // storage
  ref,
  uploadString,
  uploadBytes,
  getDownloadURL
};
