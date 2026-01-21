import { initializeApp } from "firebase/app";
// 1. We must import the specific Auth tools
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCM1f1G__zAuLXSJhYV8s9x0VqjSUfTL2A",
  authDomain: "waypoint-dcc15.firebaseapp.com",
  projectId: "waypoint-dcc15",
  storageBucket: "waypoint-dcc15.firebasestorage.app",
  messagingSenderId: "573545074735",
  appId: "1:573545074735:web:c93099efe4adeb18ff76da",
  measurementId: "G-BV8DZEGERB"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// 2. Export these variables so App.js can use them
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export { signInWithPopup };