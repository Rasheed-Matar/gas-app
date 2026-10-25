/* المزامنة مع Firebase: تسجيل دخول بكلمة سر الفريق + Firestore يعمل دون إنترنت */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, setDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBBuslvRDVLY4MaoN7O4uhtORIL-hR5hEU',
  authDomain: 'gas-point-c698b.firebaseapp.com',
  projectId: 'gas-point-c698b',
  storageBucket: 'gas-point-c698b.firebasestorage.app',
  messagingSenderId: '662712100944',
  appId: '1:662712100944:web:2a3e0dd97c43d8a19bc955'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

const clean = o => JSON.parse(JSON.stringify(o)); // يحذف undefined الذي ترفضه Firestore
const quiet = () => { }; // مرفوض لأن العملية موجودة مسبقاً = طبيعي
const st = { ready: false, started: false, pend: {}, cache: {}, unsubs: [] };

function status() {
  if (!window.onSyncStatus) return;
  const pending = Object.values(st.pend).some(Boolean);
  const fromCache = Object.keys(st.cache).length < 3 || Object.values(st.cache).some(Boolean);
  window.onSyncStatus(!navigator.onLine ? '🟡 دون اتصال' : (pending || fromCache) ? '🟡 جارٍ المزامنة' : '🟢 متزامن');
}
window.addEventListener('online', status);
window.addEventListener('offline', status);

function watch(name, toItems, onServerConfirmed) {
  return onSnapshot(collection(db, name), snap => {
    st.pend[name] = snap.metadata.hasPendingWrites;
    st.cache[name] = snap.metadata.fromCache;
    const items = snap.docs.map(toItems);
    if (window.onRemote) window.onRemote(name, items, !snap.metadata.fromCache);
    // بعد تأكد الخادم: ارفع ما هو موجود محلياً ولم يصل بعد
    if (!snap.metadata.fromCache && onServerConfirmed) onServerConfirmed(new Set(snap.docs.map(d => d.id)));
    status();
  }, err => {
    if (window.onSyncError) window.onSyncError(err && err.code ? err.code : String(err));
  });
}

const Sync = {
  get ready() { return st.ready; },
  login: (email, pw) => signInWithEmailAndPassword(auth, email, pw),
  logout: () => signOut(auth),
  pushEntry(e) { setDoc(doc(db, 'entries', e.id), clean(e)).catch(quiet); },
  pushWorker(w) { setDoc(doc(db, 'workers', w.id), clean(w), { merge: true }).catch(quiet); },
  pushClose(ts) { setDoc(doc(db, 'closes', String(ts)), { ts }).catch(quiet); },
  start() {
    if (st.started) return;
    st.started = true;
    const local = () => (window.getLocal ? window.getLocal() : { entries: [], workers: [], closes: [] });
    st.unsubs = [
    watch('entries', d => d.data(), ids => local().entries.filter(e => !ids.has(e.id)).forEach(e => Sync.pushEntry(e))),
    watch('workers', d => d.data(), ids => local().workers.filter(w => !ids.has(w.id)).forEach(w => Sync.pushWorker(w))),
    watch('closes', d => d.data().ts, ids => local().closes.filter(t => !ids.has(String(t))).forEach(t => Sync.pushClose(t)))
    ];
  }
};

window.Sync = Sync;
onAuthStateChanged(auth, u => {
  st.ready = !!u;
  if (!u) { st.unsubs.forEach(f => { try { f(); } catch (e) { } }); st.unsubs = []; st.started = false; st.pend = {}; st.cache = {}; }
  if (window.onAuth) window.onAuth(u ? 'in' : 'out');
});
