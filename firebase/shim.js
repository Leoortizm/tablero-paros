/* Puente a Firebase: hace que la página use Firestore (datos) y Google (acceso del administrador).
   Define window.claude.use('db') con la misma forma que usa el tablero. */
const FB_CONFIG = /*FIREBASE_CONFIG*/;
const FB_V = '10.14.1';
const fbReady = (async () => {
  const base = 'https://www.gstatic.com/firebasejs/' + FB_V + '/';
  const [A, F, U] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-firestore.js'), import(base + 'firebase-auth.js')]);
  const app = A.initializeApp(FB_CONFIG);
  const fs = F.getFirestore(app);
  const auth = U.getAuth(app);
  const db = {
    doc: (path) => ({ set: (data) => F.setDoc(F.doc(fs, path), data) }),
    collection: (name) => ({
      onSnapshot: (next, err) => F.onSnapshot(F.collection(fs, name), (snap) => next({ size: snap.size, docs: snap.docs.map((d) => ({ data: () => d.data() })) }), err),
    }),
  };
  U.onAuthStateChanged(auth, async (u) => {
    let admin = false;
    if (u) { try { admin = (await F.getDoc(F.doc(fs, 'admins', u.uid))).exists(); } catch (e) { admin = false; } }
    const detail = { admin, email: u ? u.email : null, uid: u ? u.uid : null };
    window.__auth = detail;
    window.dispatchEvent(new CustomEvent('tablero-auth', { detail }));
  });
  return { db, auth, U };
})();
window.claude = { use: async (n) => (n === 'db' ? (await fbReady).db : null) };
window.TableroAuth = {
  signIn: async () => { const r = await fbReady; return r.U.signInWithPopup(r.auth, new r.U.GoogleAuthProvider()); },
  signOut: async () => { const r = await fbReady; return r.U.signOut(r.auth); },
};
