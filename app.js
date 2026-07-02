// ===== Firebase =====
const firebaseConfig = {
  apiKey: "AIzaSyCOLLXFxys_peIkzRY1gdpstkV67O5u1DQ",
  authDomain: "elnumerito.firebaseapp.com",
  databaseURL: "https://elnumerito-default-rtdb.firebaseio.com",
  projectId: "elnumerito",
  storageBucket: "elnumerito.firebasestorage.app",
  messagingSenderId: "245889053539",
  appId: "1:245889053539:web:e4c394949e08b40e3d5956",
  measurementId: "G-N4LNQL9KM1"
};

let db = null;
let firebaseApi = null;

// ===== Estado Local =====
const LS = window.localStorage;
let jugadorId = LS.getItem('jugadorId') || generarId();
LS.setItem('jugadorId', jugadorId);

let miSala = LS.getItem('salaId') || null;
let miRol = LS.getItem('rol') || null;
let miNombre = LS.getItem('nombre') || '';
let datosSala = null;
let listenerSala = null;
let botTimer = null;
let botTurnoEnProceso = false;
let ultimoTurnoBot = null;
let revisandoPartidaTerminada = false;
let leyendaRevisionActivada = false;

const LOCAL_SALA_ID = 'LOCAL';
const LOCAL_MACHINE_KEY = 'partidaMaquinaLocal';
const ENTRENAMIENTO_KEY = 'partidaEntrenamientoLocal';
const LEGENDARIO_KEY = 'partidaLegendarioLocal';
const ENTRENAMIENTO_SALA_ID = 'ENTRENAMIENTO';
const LEGENDARIO_SALA_ID = 'LEGENDARIO';
const DIGITOS_DESCARTE = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const BOT_ID = 'maquina';
const NOMBRES_DIFICULTAD = {
  facil: 'Máquina fácil',
  media: 'Máquina media',
  dificil: 'Máquina difícil'
};
let numerosPosiblesCache = null;

// ===== Elementos DOM =====
const pantallas = {
  lobby: document.getElementById('pantalla-lobby'),
  config: document.getElementById('pantalla-config'),
  juego: document.getElementById('pantalla-juego')
};
const overlayUltimaChance = document.getElementById('overlay-ultima-chance');
const overlayResultado = document.getElementById('overlay-resultado');
const overlayAyuda = document.getElementById('overlay-ayuda');
const btnAyuda = document.getElementById('btn-ayuda');
const btnCerrarAyuda = document.getElementById('btn-cerrar-ayuda');
const btnVerResultado = document.getElementById('btn-ver-resultado');
const btnAbandonarJuego = document.getElementById('btn-abandonar-juego');
const descartesDigitos = document.getElementById('descartes-digitos');
const avisoOffline = document.getElementById('offline-aviso');
const juegoLayoutContainer = document.getElementById('juego-layout-container');

// ===== Utilidades =====
function generarId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function generarCodigoSala() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
function mostrarPantalla(nombre) {
  Object.values(pantallas).forEach(p => p.classList.remove('activa'));
  if (pantallas[nombre]) pantallas[nombre].classList.add('activa');
}
function mostrarError(elId, msg) {
  const el = document.getElementById(elId);
  if (el) { el.textContent = msg; setTimeout(() => { el.textContent = ''; }, 4000); }
}

async function cargarFirebase() {
  if (firebaseApi) return firebaseApi;
  if (!navigator.onLine) throw new Error('Sin conexión para partidas online.');

  const [{ initializeApp }, databaseModule] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js')
  ]);

  const app = initializeApp(firebaseConfig);
  db = databaseModule.getDatabase(app);
  firebaseApi = {
    ref: databaseModule.ref,
    set: databaseModule.set,
    update: databaseModule.update,
    onValue: databaseModule.onValue,
    get: databaseModule.get
  };
  return firebaseApi;
}

function esPartidaLocal(sala = datosSala) {
  return Boolean(sala?.local);
}
function esModoMaquina(sala = datosSala) {
  return sala?.modo === 'maquina';
}
function esModoEntrenamiento(sala = datosSala) {
  return sala?.modo === 'entrenamiento';
}
function esModoLegendario(sala = datosSala) {
  return sala?.modo === 'legendario';
}

function guardarPartidaLocal() {
  if (!datosSala) return;
  if (datosSala.modo === 'maquina') {
    LS.setItem(LOCAL_MACHINE_KEY, JSON.stringify(datosSala));
  } else if (datosSala.modo === 'entrenamiento') {
    LS.setItem(ENTRENAMIENTO_KEY, JSON.stringify(datosSala));
  } else if (datosSala.modo === 'legendario') {
    LS.setItem(LEGENDARIO_KEY, JSON.stringify(datosSala));
  }
}

function cargarPartidaLocal() {
  try {
    const guardada = JSON.parse(LS.getItem(LOCAL_MACHINE_KEY) || 'null');
    if (esPartidaLocal(guardada)) return guardada;
  } catch {}
  try {
    const guardada = JSON.parse(LS.getItem(ENTRENAMIENTO_KEY) || 'null');
    if (esPartidaLocal(guardada)) return guardada;
  } catch {}
  try {
    const guardada = JSON.parse(LS.getItem(LEGENDARIO_KEY) || 'null');
    if (esPartidaLocal(guardada)) return guardada;
  } catch {}
  return null;
}

function aplicarCambioAnidado(obj, ruta, valor) {
  const partes = ruta.split('/');
  let actual = obj;
  partes.slice(0, -1).forEach(parte => {
    if (!actual[parte] || typeof actual[parte] !== 'object') actual[parte] = {};
    actual = actual[parte];
  });
  actual[partes[partes.length - 1]] = valor;
}

function aplicarCambiosLocales(cambios) {
  Object.entries(cambios).forEach(([ruta, valor]) => aplicarCambioAnidado(datosSala, ruta, valor));
  guardarPartidaLocal();
  manejarCambioEstado();
}

function actualizarAvisoOffline(estado = {}) {
  if (!avisoOffline) return;

  avisoOffline.classList.remove('pendiente', 'sin-conexion');
  const offlineListo = estado.listo ?? LS.getItem('offlineListo') === '1';

  if (!navigator.onLine && offlineListo) {
    avisoOffline.textContent = 'Sin conexión: podés jugar contra la máquina.';
    return;
  }

  if (!navigator.onLine) {
    avisoOffline.textContent = 'Sin conexión: abrí la app una vez online para activar el modo offline.';
    avisoOffline.classList.add('sin-conexion');
    return;
  }

  if (offlineListo) {
    avisoOffline.textContent = 'Modo máquina disponible sin conexión.';
    return;
  }

  avisoOffline.textContent = 'Preparando juego sin conexión...';
  avisoOffline.classList.add('pendiente');
}

async function prepararJuegoOffline() {
  actualizarAvisoOffline();
  window.addEventListener('online', () => actualizarAvisoOffline());
  window.addEventListener('offline', () => actualizarAvisoOffline());

  if (!('serviceWorker' in navigator)) {
    avisoOffline.textContent = 'Tu navegador no permite guardar el juego sin conexión.';
    avisoOffline.classList.add('sin-conexion');
    return;
  }

  try {
    const registroExistente = await navigator.serviceWorker.getRegistration();
    if (registroExistente || navigator.serviceWorker.controller) {
      LS.setItem('offlineListo', '1');
      actualizarAvisoOffline({ listo: true });
    }

    await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    LS.setItem('offlineListo', '1');
    actualizarAvisoOffline({ listo: true });
  } catch {
    if (LS.getItem('offlineListo') === '1') actualizarAvisoOffline({ listo: true });
    else actualizarAvisoOffline({ listo: false });
  }
}

function obtenerClaveDescartes() {
  if (!miSala || !miRol) return null;
  return `descartes:${jugadorId}:${miSala}:${miRol}`;
}

function cargarDescartes() {
  const clave = obtenerClaveDescartes();
  if (!clave) return {};

  try {
    const guardado = JSON.parse(LS.getItem(clave) || 'null');
    if (Array.isArray(guardado)) {
      const estados = {};
      DIGITOS_DESCARTE.forEach(d => estados[d] = 0);
      guardado.forEach(d => { if (DIGITOS_DESCARTE.includes(d)) estados[d] = 2; });
      guardarDescartes(estados);
      return estados;
    }
    if (guardado && typeof guardado === 'object') {
      DIGITOS_DESCARTE.forEach(d => {
        if (!(d in guardado) || typeof guardado[d] !== 'number') guardado[d] = 0;
      });
      return guardado;
    }
  } catch {}

  const estados = {};
  DIGITOS_DESCARTE.forEach(d => estados[d] = 0);
  return estados;
}

function guardarDescartes(descartes) {
  const clave = obtenerClaveDescartes();
  if (!clave) return;
  const aGuardar = {};
  DIGITOS_DESCARTE.forEach(d => {
    const val = descartes[d];
    aGuardar[d] = (val === 1 || val === 2) ? val : 0;
  });
  LS.setItem(clave, JSON.stringify(aGuardar));
}

function renderizarDescartes() {
  if (!descartesDigitos) return;

  const descartes = cargarDescartes();
  descartesDigitos.innerHTML = '';
  DIGITOS_DESCARTE.forEach(digito => {
    const boton = document.createElement('button');
    const estado = descartes[digito] || 0;
    boton.type = 'button';
    boton.className = 'descarte-btn';
    if (estado === 1) boton.classList.add('marcado');
    else if (estado === 2) boton.classList.add('tachado');
    boton.dataset.digito = digito;
    boton.setAttribute('aria-pressed', estado === 0 ? 'false' : 'true');
    boton.textContent = digito;
    descartesDigitos.appendChild(boton);
  });
}

function limpiarDescartesActuales() {
  const clave = obtenerClaveDescartes();
  if (clave) LS.removeItem(clave);
  renderizarDescartes();
}

// ===== Validación de 4 dígitos sin repetir =====
function obtenerDigitosDeInputs(containerId) {
  const inputs = document.querySelectorAll(`#${containerId} .digito-input`);
  return Array.from(inputs).map(inp => inp.value.trim()).join('');
}
function limpiarInputs(containerId) {
  document.querySelectorAll(`#${containerId} .digito-input`).forEach(inp => { inp.value = ''; });
}
function validarDigitosUnicos(digitosStr) {
  if (digitosStr.length !== 4) return 'Deben ser exactamente 4 dígitos.';
  if (!/^\d{4}$/.test(digitosStr)) return 'Solo se permiten números.';
  if (new Set(digitosStr).size !== 4) return 'Los dígitos no deben repetirse.';
  return null;
}

// ===== Cálculo de Buenos y Regulares =====
function calcularBuenosRegulares(secreto, intento) {
  let buenos = 0, regulares = 0;
  for (let i = 0; i < 4; i++) {
    if (intento[i] === secreto[i]) buenos++;
    else if (secreto.includes(intento[i])) regulares++;
  }
  return { buenos, regulares };
}

function obtenerRolOponente(rol) {
  return rol === 'jugador_1' ? 'jugador_2' : 'jugador_1';
}

function obtenerIntentos(sala, rol) {
  const intentos = sala?.[rol]?.intentos;
  if (Array.isArray(intentos)) return intentos.filter(Boolean);
  if (!intentos) return [];
  return Object.values(intentos).filter(Boolean);
}

function obtenerNumerosPosibles() {
  if (numerosPosiblesCache) return numerosPosiblesCache;

  const numeros = [];
  for (let a = 0; a <= 9; a++) {
    for (let b = 0; b <= 9; b++) {
      for (let c = 0; c <= 9; c++) {
        for (let d = 0; d <= 9; d++) {
          const numero = `${a}${b}${c}${d}`;
          if (new Set(numero).size === 4) numeros.push(numero);
        }
      }
    }
  }
  numerosPosiblesCache = numeros;
  return numerosPosiblesCache;
}

function elegirAleatorio(lista) {
  return lista[Math.floor(Math.random() * lista.length)];
}

function generarNumeroSecreto() {
  return elegirAleatorio(obtenerNumerosPosibles());
}

function obtenerNumeroAleatorioNoUsado(usados) {
  const disponibles = obtenerNumerosPosibles().filter(numero => !usados.has(numero));
  return elegirAleatorio(disponibles.length ? disponibles : obtenerNumerosPosibles());
}

function obtenerCandidatosPorPistas(intentos) {
  return obtenerNumerosPosibles().filter(candidato => {
    return intentos.every(intento => {
      const resultado = calcularBuenosRegulares(candidato, intento.numero);
      return resultado.buenos === intento.buenos && resultado.regulares === intento.regulares;
    });
  });
}

function elegirCandidatoMasPrometedor(candidatos) {
  const posicion = Array.from({ length: 4 }, () => ({}));
  const presencia = {};

  candidatos.forEach(numero => {
    [...numero].forEach((digito, idx) => {
      posicion[idx][digito] = (posicion[idx][digito] || 0) + 1;
      presencia[digito] = (presencia[digito] || 0) + 1;
    });
  });

  return candidatos.reduce((mejor, numero) => {
    const puntaje = [...numero].reduce((total, digito, idx) => {
      return total + (posicion[idx][digito] || 0) * 2 + (presencia[digito] || 0);
    }, 0);
    if (!mejor || puntaje > mejor.puntaje) return { numero, puntaje };
    return mejor;
  }, null)?.numero || elegirAleatorio(candidatos);
}

function elegirIntentoMaquina(sala) {
  const dificultad = sala.dificultadMaquina || 'media';
  const rolBot = esModoLegendario(sala) ? 'jugador_2' : 'jugador_2';
  const intentos = obtenerIntentos(sala, rolBot);
  const usados = new Set(intentos.map(intento => intento.numero));

  if (dificultad === 'facil') {
    return obtenerNumeroAleatorioNoUsado(usados);
  }

  if (!intentos.length) {
    return obtenerNumeroAleatorioNoUsado(usados);
  }

  let candidatos = obtenerCandidatosPorPistas(intentos).filter(numero => !usados.has(numero));
  if (!candidatos.length) candidatos = obtenerNumerosPosibles().filter(numero => !usados.has(numero));
  if (!candidatos.length) candidatos = obtenerNumerosPosibles();

  if (dificultad === 'media') {
    const seEquivoca = intentos.length < 2 || Math.random() < 0.3;
    return seEquivoca ? obtenerNumeroAleatorioNoUsado(usados) : elegirAleatorio(candidatos);
  }

  return elegirCandidatoMasPrometedor(candidatos);
}

// ===== Lobby: Crear / Unirse / Máquina / Entrenar / Legendario =====
function activarTabLobby(tabActiva) {
  ['crear', 'unirse', 'maquina', 'entrenar', 'legendario'].forEach(tab => {
    document.getElementById(`tab-${tab}`).classList.toggle('active', tab === tabActiva);
    document.getElementById(`form-${tab}`).classList.toggle('oculto', tab !== tabActiva);
  });
}

document.getElementById('tab-crear').addEventListener('click', () => activarTabLobby('crear'));
document.getElementById('tab-unirse').addEventListener('click', () => activarTabLobby('unirse'));
document.getElementById('tab-maquina').addEventListener('click', () => activarTabLobby('maquina'));
document.getElementById('tab-entrenar').addEventListener('click', () => activarTabLobby('entrenar'));
document.getElementById('tab-legendario').addEventListener('click', () => activarTabLobby('legendario'));

document.getElementById('btn-crear').addEventListener('click', async () => {
  const nombre = document.getElementById('nombre-crear').value.trim();
  if (!nombre) return mostrarError('error-lobby', 'Poné tu nombre.');
  const firebase = await cargarFirebase().catch(() => null);
  if (!firebase) return mostrarError('error-lobby', 'Necesitás conexión para crear una sala.');
  const { ref, set } = firebase;
  const salaId = generarCodigoSala();
  miNombre = nombre;
  miRol = 'jugador_1';
  miSala = salaId;
  LS.setItem('nombre', nombre);
  LS.setItem('rol', miRol);
  LS.setItem('salaId', salaId);
  limpiarDescartesActuales();

  const salaRef = ref(db, `partidas/${salaId}`);
  await set(salaRef, {
    estado: 'esperando',
    creadorId: jugadorId,
    turno: 'jugador_1',
    ronda: 1,
    ganador: null,
    jugador_1: { id: jugadorId, nombre, secreto: null, intentos: [], conectado: true, listo: false },
    jugador_2: { id: null, nombre: '', secreto: null, intentos: [], conectado: false, listo: false }
  });
  iniciarEscuchaSala(salaId);
  mostrarPantalla('config');
  document.getElementById('sala-id-config').textContent = salaId;
  document.getElementById('estado-sala-config').textContent = 'Esperando oponente...';
});

document.getElementById('btn-unirse').addEventListener('click', async () => {
  const nombre = document.getElementById('nombre-unirse').value.trim();
  const codigo = document.getElementById('codigo-sala').value.trim().toUpperCase();
  if (!nombre) return mostrarError('error-lobby', 'Poné tu nombre.');
  if (!codigo) return mostrarError('error-lobby', 'Ingresá el código de sala.');

  const firebase = await cargarFirebase().catch(() => null);
  if (!firebase) return mostrarError('error-lobby', 'Necesitás conexión para unirte a una sala.');
  const { ref, get, update } = firebase;

  const salaRef = ref(db, `partidas/${codigo}`);
  const snap = await get(salaRef);
  if (!snap.exists()) return mostrarError('error-lobby', 'Sala no encontrada.');
  const data = snap.val();
  if (data.estado !== 'esperando') return mostrarError('error-lobby', 'Esta sala ya está en juego o llena.');
  if (data.jugador_1.id === jugadorId) return mostrarError('error-lobby', 'No podés unirte a tu propia sala.');

  miNombre = nombre;
  miRol = 'jugador_2';
  miSala = codigo;
  LS.setItem('nombre', nombre);
  LS.setItem('rol', miRol);
  LS.setItem('salaId', codigo);
  limpiarDescartesActuales();

  await update(salaRef, {
    'jugador_2': { id: jugadorId, nombre, secreto: null, intentos: [], conectado: true, listo: false },
    estado: 'configurando'
  });
  iniciarEscuchaSala(codigo);
  mostrarPantalla('config');
  document.getElementById('sala-id-config').textContent = codigo;
  document.getElementById('estado-sala-config').textContent = '¡Oponente conectado!';
});

document.getElementById('btn-jugar-maquina').addEventListener('click', async () => {
  const nombre = document.getElementById('nombre-maquina').value.trim();
  const dificultad = document.getElementById('dificultad-maquina').value;
  if (!nombre) return mostrarError('error-lobby', 'Poné tu nombre.');

  const salaId = LOCAL_SALA_ID;
  miNombre = nombre;
  miRol = 'jugador_1';
  miSala = salaId;
  LS.setItem('nombre', nombre);
  LS.setItem('rol', miRol);
  LS.setItem('salaId', salaId);
  limpiarDescartesActuales();

  datosSala = {
    estado: 'configurando',
    modo: 'maquina',
    local: true,
    salaId,
    dificultadMaquina: dificultad,
    creadorId: jugadorId,
    turno: 'jugador_1',
    ronda: 1,
    ganador: null,
    jugador_1: { id: jugadorId, nombre, secreto: null, intentos: [], conectado: true, listo: false },
    jugador_2: {
      id: BOT_ID,
      nombre: NOMBRES_DIFICULTAD[dificultad] || NOMBRES_DIFICULTAD.media,
      secreto: generarNumeroSecreto(),
      intentos: [],
      conectado: true,
      listo: true
    }
  };
  guardarPartidaLocal();

  mostrarPantalla('config');
  document.getElementById('sala-id-config').textContent = salaId;
  document.getElementById('estado-sala-config').textContent = 'La máquina ya eligió su número.';
  manejarCambioEstado();
});

document.getElementById('btn-entrenar').addEventListener('click', () => {
  const nombre = document.getElementById('nombre-entrenar').value.trim();
  if (!nombre) return mostrarError('error-lobby', 'Poné tu nombre.');

  miNombre = nombre;
  miRol = 'jugador_1';
  miSala = ENTRENAMIENTO_SALA_ID;
  LS.setItem('nombre', nombre);
  LS.setItem('rol', miRol);
  LS.setItem('salaId', miSala);
  limpiarDescartesActuales();

  datosSala = {
    estado: 'jugando',
    modo: 'entrenamiento',
    local: true,
    salaId: miSala,
    turno: 'jugador_1',
    ronda: 1,
    ganador: null,
    jugador_1: { id: jugadorId, nombre, secreto: null, intentos: [] },
    jugador_2: { id: 'sistema', nombre: 'Sistema', secreto: generarNumeroSecreto(), intentos: [], listo: true }
  };
  guardarPartidaLocal();
  mostrarPantalla('juego');
  manejarCambioEstado();
});

// Modo Legendario (local contra máquina)
document.getElementById('btn-legendario-maquina').addEventListener('click', () => {
  const nombre = document.getElementById('nombre-legendario').value.trim();
  const dificultad = document.getElementById('dificultad-legendario').value;
  if (!nombre) return mostrarError('error-lobby', 'Poné tu nombre.');

  leyendaRevisionActivada = false;
  miNombre = nombre;
  miRol = 'jugador_1';
  miSala = LEGENDARIO_SALA_ID;
  LS.setItem('nombre', nombre);
  LS.setItem('rol', miRol);
  LS.setItem('salaId', miSala);
  limpiarDescartesActuales();

  const secretoComun = generarNumeroSecreto();
  datosSala = {
    estado: 'jugando',
    modo: 'legendario',
    local: true,
    salaId: miSala,
    turno: 'jugador_1',
    ronda: 1,
    ganador: null,
    dificultadMaquina: dificultad,
    secretoComun,
    jugador_1: { id: jugadorId, nombre, intentos: [] },
    jugador_2: {
      id: BOT_ID,
      nombre: `Máquina Legendaria (${NOMBRES_DIFICULTAD[dificultad]})`,
      intentos: [],
      conectado: true,
      listo: true
    }
  };
  guardarPartidaLocal();
  mostrarPantalla('juego');
  manejarCambioEstado();
});

// Modo Legendario online (crear sala para amigo)
document.getElementById('btn-legendario-amigo').addEventListener('click', async () => {
  const nombre = document.getElementById('nombre-legendario').value.trim();
  if (!nombre) return mostrarError('error-lobby', 'Poné tu nombre.');
  const firebase = await cargarFirebase().catch(() => null);
  if (!firebase) return mostrarError('error-lobby', 'Necesitás conexión para crear una sala legendaria.');

  const { ref, set } = firebase;
  const salaId = generarCodigoSala();
  leyendaRevisionActivada = false;
  miNombre = nombre;
  miRol = 'jugador_1';
  miSala = salaId;
  LS.setItem('nombre', nombre);
  LS.setItem('rol', miRol);
  LS.setItem('salaId', salaId);
  limpiarDescartesActuales();

  const secretoComun = generarNumeroSecreto();
  const salaRef = ref(db, `partidas/${salaId}`);
  await set(salaRef, {
    estado: 'esperando',
    modo: 'legendario',
    creadorId: jugadorId,
    turno: 'jugador_1',
    ronda: 1,
    ganador: null,
    secretoComun,
    jugador_1: { id: jugadorId, nombre, intentos: [], conectado: true, listo: false },
    jugador_2: { id: null, nombre: '', intentos: [], conectado: false, listo: false }
  });
  iniciarEscuchaSala(salaId);
  mostrarPantalla('config');
  document.getElementById('sala-id-config').textContent = salaId;
  document.getElementById('estado-sala-config').textContent = 'Sala legendaria. Esperando oponente...';
});

// ===== Ayuda =====
btnAyuda.addEventListener('click', () => overlayAyuda.classList.remove('oculto'));
btnCerrarAyuda.addEventListener('click', () => overlayAyuda.classList.add('oculto'));

// ===== Configuración del número secreto (con auto‑listo para máquina) =====
document.getElementById('btn-confirmar-secreto').addEventListener('click', async () => {
  const digitos = obtenerDigitosDeInputs('secreto-inputs');
  const error = validarDigitosUnicos(digitos);
  if (error) return mostrarError('error-secreto', error);

  if (esPartidaLocal()) {
    if (esModoMaquina()) {
      datosSala[miRol].secreto = digitos;
      datosSala[miRol].listo = true;
      datosSala.estado = 'jugando';
      datosSala.turno = 'jugador_1';
      guardarPartidaLocal();
      manejarCambioEstado();
      return;
    }
    aplicarCambiosLocales({
      [`${miRol}/secreto`]: digitos,
      [`${miRol}/listo`]: false
    });
    return;
  }

  const firebase = await cargarFirebase().catch(() => null);
  if (!firebase) return mostrarError('error-secreto', 'Necesitás conexión para jugar online.');
  const { ref, update } = firebase;
  await update(ref(db, `partidas/${miSala}/${miRol}`), { secreto: digitos, listo: false });
});

// ===== Botón "Listo" (solo para partidas humanas) =====
document.getElementById('btn-listo').addEventListener('click', async () => {
  if (esPartidaLocal()) {
    datosSala[miRol].listo = true;
    if (datosSala.jugador_1.listo && datosSala.jugador_2.listo) {
      datosSala.estado = 'jugando';
      datosSala.turno = 'jugador_1';
    }
    guardarPartidaLocal();
    manejarCambioEstado();
    return;
  }

  const firebase = await cargarFirebase().catch(() => null);
  if (!firebase) return mostrarError('error-secreto', 'Necesitás conexión para jugar online.');
  const { ref, update, get } = firebase;
  await update(ref(db, `partidas/${miSala}/${miRol}`), { listo: true });

  const snap1 = await get(ref(db, `partidas/${miSala}/jugador_1/listo`));
  const snap2 = await get(ref(db, `partidas/${miSala}/jugador_2/listo`));
  if (snap1.val() && snap2.val()) {
    await update(ref(db, `partidas/${miSala}`), { estado: 'jugando', turno: 'jugador_1' });
  }
});

// ===== Abandonar =====
async function abandonarPartidaActual() {
  if (esPartidaLocal()) {
    LS.removeItem(LOCAL_MACHINE_KEY);
    LS.removeItem(ENTRENAMIENTO_KEY);
    LS.removeItem(LEGENDARIO_KEY);
    resetearApp();
    return;
  }

  const firebase = await cargarFirebase().catch(() => null);
  if (!firebase) {
    resetearApp();
    return;
  }
  const { ref, set, update } = firebase;
  if (miRol === 'jugador_1') {
    await set(ref(db, `partidas/${miSala}`), null);
  } else {
    await update(ref(db, `partidas/${miSala}`), {
      estado: 'esperando',
      'jugador_2': { id: null, nombre: '', secreto: null, intentos: [], conectado: false, listo: false }
    });
  }
  resetearApp();
}

document.getElementById('btn-abandonar-config').addEventListener('click', abandonarPartidaActual);
btnAbandonarJuego.addEventListener('click', abandonarPartidaActual);

// ===== Juego: Enviar intento (soporta legendario) =====
async function registrarIntento(rol, digitos) {
  if (!miSala) return false;

  let salaRef = null;
  let sala = datosSala;
  let firebase = null;

  if (!esPartidaLocal()) {
    firebase = await cargarFirebase().catch(() => null);
    if (!firebase) {
      mostrarError('error-intento', 'Necesitás conexión para jugar online.');
      return false;
    }
    const { ref, get } = firebase;
    salaRef = ref(db, `partidas/${miSala}`);
    const snap = await get(salaRef);
    if (!snap.exists()) return false;
    sala = snap.val();
  }

  const estado = sala.estado;
  const esEntrenamiento = esModoEntrenamiento(sala);
  const esLegendario = esModoLegendario(sala);
  if (!esEntrenamiento && !esLegendario && (estado !== 'jugando' && estado !== 'ultima_chance') || sala.turno !== rol) return false;

  let secretoObjetivo = null;
  if (esLegendario) {
    secretoObjetivo = sala.secretoComun;
  } else if (esEntrenamiento) {
    secretoObjetivo = sala.jugador_2.secreto;
  } else {
    const oponenteRol = obtenerRolOponente(rol);
    secretoObjetivo = sala[oponenteRol]?.secreto;
  }

  if (!secretoObjetivo) return false;

  const { buenos, regulares } = calcularBuenosRegulares(secretoObjetivo, digitos);
  const intentos = obtenerIntentos(sala, rol);
  intentos.push({ numero: digitos, buenos, regulares });

  const cambios = {
    [`${rol}/intentos`]: intentos
  };

  if (buenos === 4) {
    if (esEntrenamiento) {
      cambios.estado = 'terminado';
      cambios.ganador = 'jugador_1';
    } else if (esLegendario) {
      if (rol === 'jugador_1') {
        const rondaActual = sala.ronda || 1;
        const intentosOp = obtenerIntentos(sala, 'jugador_2').length;
        if (intentosOp < rondaActual) {
          cambios.estado = 'ultima_chance';
          cambios.turno = 'jugador_2';
        } else {
          cambios.estado = 'terminado';
          cambios.ganador = 'jugador_1';
        }
      } else if (estado === 'ultima_chance') {
        cambios.estado = 'terminado';
        cambios.ganador = 'empate';
      } else {
        cambios.estado = 'terminado';
        cambios.ganador = 'jugador_2';
      }
    } else if (rol === 'jugador_1') {
      const rondaActual = sala.ronda || 1;
      const intentosJ2 = obtenerIntentos(sala, 'jugador_2').length;
      if (intentosJ2 < rondaActual) {
        cambios.estado = 'ultima_chance';
        cambios.turno = 'jugador_2';
      } else {
        cambios.estado = 'terminado';
        cambios.ganador = 'jugador_1';
      }
    } else if (estado === 'ultima_chance') {
      cambios.estado = 'terminado';
      cambios.ganador = 'empate';
    } else {
      cambios.estado = 'terminado';
      cambios.ganador = 'jugador_2';
    }
  } else if (esEntrenamiento) {
    // En entrenamiento, el turno siempre es del jugador
    cambios.turno = 'jugador_1';
    cambios.estado = 'jugando';
  } else if (esLegendario) {
    cambios.turno = obtenerRolOponente(rol);
    cambios.ronda = rol === 'jugador_2' ? (sala.ronda || 1) + 1 : (sala.ronda || 1);
    cambios.estado = 'jugando';
  } else if (estado === 'ultima_chance') {
    cambios.estado = 'terminado';
    cambios.ganador = obtenerRolOponente(rol);
  } else {
    cambios.turno = obtenerRolOponente(rol);
    cambios.ronda = rol === 'jugador_2' ? (sala.ronda || 1) + 1 : (sala.ronda || 1);
    cambios.estado = 'jugando';
  }

  if (esPartidaLocal()) {
    aplicarCambiosLocales(cambios);
  } else {
    const { update } = firebase;
    await update(salaRef, cambios);
  }
  return true;
}

document.getElementById('btn-enviar-intento').addEventListener('click', async () => {
  const entrenamiento = esModoEntrenamiento();
  // En entrenamiento no se verifica el turno, siempre puede tirar
  if (!entrenamiento && (!datosSala || (datosSala.estado !== 'jugando' && datosSala.estado !== 'ultima_chance') || datosSala.turno !== miRol)) {
    return mostrarError('error-intento', 'No es tu turno.');
  }
  if (entrenamiento && (!datosSala || (datosSala.estado !== 'jugando' && datosSala.estado !== 'ultima_chance'))) {
    // Solo verifica el estado, no el turno
    return mostrarError('error-intento', 'El entrenamiento ya terminó.');
  }

  const digitos = obtenerDigitosDeInputs('intento-inputs');
  const error = validarDigitosUnicos(digitos);
  if (error) return mostrarError('error-intento', error);

  const enviado = await registrarIntento(miRol, digitos);
  if (enviado) limpiarInputs('intento-inputs');
});

function programarJugadaMaquina() {
  if ((!esModoMaquina() && !esModoLegendario()) || miRol !== 'jugador_1') return;
  if (!datosSala || (datosSala.estado !== 'jugando' && datosSala.estado !== 'ultima_chance')) return;
  if (datosSala.turno !== 'jugador_2') return;

  const claveTurno = [
    miSala,
    datosSala.estado,
    datosSala.ronda || 1,
    obtenerIntentos(datosSala, 'jugador_1').length,
    obtenerIntentos(datosSala, 'jugador_2').length
  ].join(':');

  if (botTurnoEnProceso || ultimoTurnoBot === claveTurno) return;

  ultimoTurnoBot = claveTurno;
  botTurnoEnProceso = true;
  if (botTimer) clearTimeout(botTimer);

  const demora = datosSala.estado === 'ultima_chance' ? 1200 : 800 + Math.floor(Math.random() * 900);
  botTimer = setTimeout(async () => {
    try {
      if (!miSala) return;

      let salaActual = datosSala;
      if (!esPartidaLocal()) {
        const firebase = await cargarFirebase().catch(() => null);
        if (!firebase) return;
        const { ref, get } = firebase;
        const snap = await get(ref(db, `partidas/${miSala}`));
        if (!snap.exists()) return;
        salaActual = snap.val();
      }

      if ((!esModoMaquina(salaActual) && !esModoLegendario(salaActual)) || salaActual.turno !== 'jugador_2') return;
      if (salaActual.estado !== 'jugando' && salaActual.estado !== 'ultima_chance') return;

      const intento = elegirIntentoMaquina(salaActual);
      await registrarIntento('jugador_2', intento);
    } catch (error) {
      console.error('No se pudo completar la jugada de la máquina:', error);
      ultimoTurnoBot = null;
    } finally {
      botTurnoEnProceso = false;
      botTimer = null;
    }
  }, demora);
}

// ===== Escucha de cambios en la sala =====
async function iniciarEscuchaSala(salaId) {
  if (listenerSala) listenerSala();
  if (esPartidaLocal()) return;

  const firebase = await cargarFirebase().catch(() => null);
  if (!firebase) {
    resetearApp();
    mostrarError('error-lobby', 'Necesitás conexión para recuperar una sala online.');
    return;
  }

  const { ref, onValue } = firebase;
  const salaRef = ref(db, `partidas/${salaId}`);
  listenerSala = onValue(salaRef, (snap) => {
    if (!snap.exists()) {
      resetearApp();
      return;
    }
    datosSala = snap.val();
    manejarCambioEstado();
  });
}

function manejarCambioEstado() {
  const estado = datosSala.estado;
  document.getElementById('sala-id-config').textContent = miSala;
  document.getElementById('sala-id-juego').textContent = miSala;

  if (estado !== 'terminado') {
    revisandoPartidaTerminada = false;
    overlayResultado.classList.add('oculto');
  }

  if (estado === 'esperando' || estado === 'configurando') {
    mostrarPantalla('config');
    const espera = document.getElementById('estado-sala-config');
    if (estado === 'esperando') espera.textContent = 'Esperando oponente...';
    else if (esModoMaquina()) espera.textContent = 'La máquina ya eligió su número. Configurá el tuyo.';
    else if (esModoLegendario()) espera.textContent = 'Sala legendaria. ¡Ambos comparten el mismo número!';
    else espera.textContent = '¡Oponente conectado! Configurá tu número.';

    const miData = datosSala[miRol];
    if (miData && miData.secreto) {
      document.getElementById('btn-confirmar-secreto').disabled = true;
      document.getElementById('btn-confirmar-secreto').textContent = '✅ Número guardado';
      if (!esModoMaquina() && !esModoLegendario()) {
        document.getElementById('seccion-listo').classList.remove('oculto');
        if (miData.listo) {
          document.getElementById('btn-listo').disabled = true;
          document.getElementById('btn-listo').textContent = '✅ Listo ✓';
        } else {
          document.getElementById('btn-listo').disabled = false;
          document.getElementById('btn-listo').textContent = '✅ ¡Listo!';
        }
      } else {
        document.getElementById('seccion-listo').classList.add('oculto');
      }
    } else {
      document.getElementById('btn-confirmar-secreto').disabled = false;
      document.getElementById('btn-confirmar-secreto').textContent = 'Confirmar número';
      document.getElementById('seccion-listo').classList.add('oculto');
    }
  }

  if (estado === 'jugando' || estado === 'ultima_chance') {
    mostrarPantalla('juego');
    renderizarJuego();
    programarJugadaMaquina();
  }

  if (estado === 'terminado') {
    mostrarPantalla('juego');
    renderizarJuego();
    mostrarResultadoFinal();
  }
}

function renderizarJuego() {
  const oponenteRol = obtenerRolOponente(miRol);
  const oponenteData = datosSala[oponenteRol];
  const estado = datosSala.estado;
  const turno = datosSala.turno;
  const ronda = datosSala.ronda || 1;
  const contraMaquina = esModoMaquina();
  const entrenamiento = esModoEntrenamiento();
  const legendario = esModoLegendario();

  document.getElementById('ronda-badge').textContent = entrenamiento ? 'Entrenando' : `Ronda ${ronda}`;
  btnVerResultado.classList.toggle('oculto', estado !== 'terminado');
  renderizarDescartes();

  const ocultarPanelLegendario = legendario && !(estado === 'terminado' && leyendaRevisionActivada);
  juegoLayoutContainer.classList.toggle('entrenamiento', entrenamiento);
  juegoLayoutContainer.classList.toggle('legendario', ocultarPanelLegendario);

  const turnoInd = document.getElementById('indicador-turno');
  const turnoTexto = document.getElementById('turno-texto');
  const turnoIcono = document.getElementById('turno-icono');
  turnoInd.classList.remove('mi-turno', 'su-turno', 'ultima');

  if (entrenamiento) {
    turnoInd.classList.add('mi-turno');
    turnoTexto.textContent = '🎯 Adiviná el número secreto';
    turnoIcono.textContent = '🧠';
  } else if (legendario) {
    turnoInd.classList.add(turno === miRol ? 'mi-turno' : 'su-turno');
    turnoTexto.textContent = turno === miRol ? '⚔️ ¡Tu turno! Adiviná el número común' : '⏳ Tu oponente está pensando...';
    turnoIcono.textContent = turno === miRol ? '🔮' : '⏰';
  } else if (estado === 'ultima_chance') {
    turnoInd.classList.add('ultima');
    turnoTexto.textContent = (turno === miRol) ? '⚠️ ¡ÚLTIMA CHANCE! ¡Adiviná YA!' : (contraMaquina ? '⏳ La máquina tiene la última chance...' : '⏳ Tu oponente tiene la última chance...');
    turnoIcono.textContent = (turno === miRol) ? '🔥' : '😰';
  } else if (turno === miRol) {
    turnoInd.classList.add('mi-turno');
    turnoTexto.textContent = '✅ Es tu turno';
    turnoIcono.textContent = '🎯';
  } else {
    turnoInd.classList.add('su-turno');
    turnoTexto.textContent = contraMaquina ? '⏳ Turno de la máquina' : '⏳ Turno del oponente';
    turnoIcono.textContent = contraMaquina ? '🤖' : '🤔';
  }

  if (!entrenamiento) {
    const iconoOponente = contraMaquina ? '🤖' : legendario ? '🛡️' : '🤔';
    document.getElementById('nombre-oponente').textContent = oponenteData?.nombre ? `${iconoOponente} ${oponenteData.nombre}` : `${iconoOponente} Oponente`;
  } else {
    document.getElementById('nombre-oponente').textContent = '';
  }

  const listaPropia = document.getElementById('lista-propia');
  listaPropia.innerHTML = '';
  obtenerIntentos(datosSala, miRol).forEach((int, idx) => {
    const fila = document.createElement('div');
    fila.className = 'historial-fila';
    fila.innerHTML = `<span>${idx + 1}</span><span>${int.numero}</span><span class="b">${int.buenos}</span><span class="r">${int.regulares}</span>`;
    listaPropia.appendChild(fila);
  });

  const listaOponente = document.getElementById('lista-oponente');
  listaOponente.innerHTML = '';
  if (!entrenamiento && !(legendario && !(estado === 'terminado' && leyendaRevisionActivada))) {
    obtenerIntentos(datosSala, oponenteRol).forEach((int, idx) => {
      const fila = document.createElement('div');
      fila.className = 'historial-fila';
      fila.innerHTML = `<span>${idx + 1}</span><span>${int.numero}</span><span class="b">${int.buenos}</span><span class="r">${int.regulares}</span>`;
      listaOponente.appendChild(fila);
    });
  }

  const inputContainer = document.getElementById('input-intento-container');
  const aviso = document.getElementById('aviso-turno-propio');
  if (entrenamiento) {
    if (estado === 'terminado') {
      inputContainer.classList.add('deshabilitado');
      aviso.textContent = '¡Felicitaciones! Revisá el historial.';
    } else {
      inputContainer.classList.remove('deshabilitado');
      aviso.textContent = 'Ingresá 4 dígitos sin repetir:';
      document.getElementById('btn-enviar-intento').textContent = 'Enviar intento';
    }
  } else {
    if (estado === 'terminado') {
      inputContainer.classList.add('deshabilitado');
      aviso.textContent = 'Juego terminado. Podés revisar el historial.';
    } else if (turno === miRol && (estado === 'jugando' || estado === 'ultima_chance')) {
      inputContainer.classList.remove('deshabilitado');
      aviso.textContent = estado === 'ultima_chance' ? '🔥 ¡Es ahora o nunca!' : 'Ingresá 4 dígitos sin repetir:';
      document.getElementById('btn-enviar-intento').textContent = estado === 'ultima_chance' ? '¡Disparo final!' : 'Enviar intento';
    } else {
      inputContainer.classList.add('deshabilitado');
      aviso.textContent = 'Esperando tu turno...';
    }
  }

  const pensando = document.getElementById('pensando-oponente');
  if (!entrenamiento && estado !== 'terminado' && turno === oponenteRol) {
    pensando.textContent = contraMaquina ? '💭 Calculando...' : legendario ? '💭 Tu oponente descifra el mismo número...' : '💭 Pensando...';
  } else {
    pensando.textContent = '';
  }

  if (!entrenamiento && estado === 'ultima_chance' && turno === miRol) {
    overlayUltimaChance.classList.remove('oculto');
    document.getElementById('ultima-chance-titulo').textContent = '⚠️ ¡Última Chance!';
    const nombreOponente = miRol === 'jugador_1' ? datosSala.jugador_2?.nombre : datosSala.jugador_1?.nombre;
    document.getElementById('ultima-chance-texto').textContent = `¡${nombreOponente || 'Tu oponente'} descifró tu número! Tenés este único intento para empatar.`;
  }
}

function mostrarResultadoFinal(forzar = false) {
  if (revisandoPartidaTerminada && !forzar) return;

  const ganador = datosSala.ganador;
  const overlay = overlayResultado;
  overlay.classList.remove('oculto');
  const titulo = document.getElementById('resultado-titulo');
  const detalle = document.getElementById('resultado-detalle');
  const secretos = document.getElementById('resultado-secretos');
  const contraMaquina = esModoMaquina();
  const entrenamiento = esModoEntrenamiento();
  const legendario = esModoLegendario();

  const miSecreto = datosSala[miRol]?.secreto || '????';
  const opRol = obtenerRolOponente(miRol);
  const opSecreto = legendario ? datosSala.secretoComun : (datosSala[opRol]?.secreto || '????');

  if (entrenamiento) {
    titulo.textContent = '🎉 ¡Acertaste!';
    titulo.style.color = 'var(--exito)';
    const totalIntentos = obtenerIntentos(datosSala, miRol).length;
    detalle.textContent = `Descubriste el número en ${totalIntentos} intento${totalIntentos !== 1 ? 's' : ''}.`;
    secretos.textContent = `El número era: ${opSecreto}`;
  } else if (legendario) {
    if (ganador === miRol) {
      titulo.textContent = '🎉 ¡Ganaste!';
      titulo.style.color = 'var(--exito)';
      detalle.textContent = 'Descifraste el número legendario antes que tu oponente.';
    } else if (ganador === 'empate') {
      titulo.textContent = '🤝 ¡Empate!';
      titulo.style.color = 'var(--bueno)';
      detalle.textContent = 'Ambos descifraron el número legendario en la misma ronda.';
    } else {
      titulo.textContent = '😞 Perdiste';
      titulo.style.color = 'var(--error)';
      detalle.textContent = 'Tu oponente descifró el número legendario primero.';
    }
    secretos.textContent = `El número legendario era: ${datosSala.secretoComun}`;
  } else if (ganador === miRol) {
    titulo.textContent = '🎉 ¡Ganaste!';
    titulo.style.color = 'var(--exito)';
    detalle.textContent = contraMaquina ? 'Descifraste el número de la máquina.' : 'Descifraste el número de tu oponente.';
  } else if (ganador === 'empate') {
    titulo.textContent = '🤝 ¡Empate!';
    titulo.style.color = 'var(--bueno)';
    detalle.textContent = 'Ambos descifraron el número en la misma ronda.';
  } else {
    titulo.textContent = '😞 Perdiste';
    titulo.style.color = 'var(--error)';
    detalle.textContent = contraMaquina ? 'La máquina descifró tu número primero.' : 'Tu oponente descifró tu número primero.';
  }

  if (!entrenamiento && !legendario) {
    secretos.textContent = `Tu número: ${miSecreto} | Su número: ${opSecreto}`;
  }

  document.getElementById('btn-ver-partida').onclick = () => {
    revisandoPartidaTerminada = true;
    overlay.classList.add('oculto');
    if (esModoLegendario()) {
      leyendaRevisionActivada = true;
      renderizarJuego();
    }
    btnVerResultado.focus();
  };

  document.getElementById('btn-revancha').classList.toggle('oculto', entrenamiento);
  document.getElementById('btn-revancha').onclick = async () => {
    revisandoPartidaTerminada = false;
    overlay.classList.add('oculto');

    if (entrenamiento) {
      const nuevoSecreto = generarNumeroSecreto();
      datosSala.estado = 'jugando';
      datosSala.ronda = 1;
      datosSala.ganador = null;
      datosSala.jugador_1.intentos = [];
      datosSala.jugador_2.secreto = nuevoSecreto;
      guardarPartidaLocal();
      limpiarInputs('intento-inputs');
      limpiarDescartesActuales();
      mostrarPantalla('juego');
      manejarCambioEstado();
      return;
    }

    if (legendario) {
      leyendaRevisionActivada = false;
      if (esPartidaLocal()) {
        const nuevoSecreto = generarNumeroSecreto();
        datosSala.estado = 'jugando';
        datosSala.ronda = 1;
        datosSala.ganador = null;
        datosSala.secretoComun = nuevoSecreto;
        datosSala.jugador_1.intentos = [];
        datosSala.jugador_2.intentos = [];
        guardarPartidaLocal();
        limpiarInputs('intento-inputs');
        limpiarDescartesActuales();
        mostrarPantalla('juego');
        manejarCambioEstado();
        return;
      } else {
        const firebase = await cargarFirebase().catch(() => null);
        if (!firebase) return mostrarError('error-intento', 'Necesitás conexión para pedir revancha online.');
        const { ref, update } = firebase;
        const nuevoSecreto = generarNumeroSecreto();
        await update(ref(db, `partidas/${miSala}`), {
          estado: 'jugando',
          turno: 'jugador_1',
          ronda: 1,
          ganador: null,
          secretoComun: nuevoSecreto,
          'jugador_1/intentos': [],
          'jugador_2/intentos': []
        });
        mostrarPantalla('juego');
        limpiarInputs('intento-inputs');
        limpiarDescartesActuales();
        manejarCambioEstado();
        return;
      }
    }

    const cambios = {
      estado: 'configurando',
      turno: 'jugador_1',
      ronda: 1,
      ganador: null,
      'jugador_1/secreto': null,
      'jugador_1/intentos': [],
      'jugador_1/listo': false,
      'jugador_2/intentos': []
    };

    if (contraMaquina) {
      cambios['jugador_2/secreto'] = generarNumeroSecreto();
      cambios['jugador_2/listo'] = true;
    } else {
      cambios['jugador_2/secreto'] = null;
      cambios['jugador_2/listo'] = false;
    }

    ultimoTurnoBot = null;
    if (botTimer) clearTimeout(botTimer);
    botTimer = null;
    botTurnoEnProceso = false;

    if (esPartidaLocal()) {
      aplicarCambiosLocales(cambios);
    } else {
      const firebase = await cargarFirebase().catch(() => null);
      if (!firebase) return mostrarError('error-intento', 'Necesitás conexión para pedir revancha online.');
      const { ref, update } = firebase;
      await update(ref(db, `partidas/${miSala}`), cambios);
    }
    document.getElementById('btn-confirmar-secreto').disabled = false;
    document.getElementById('btn-confirmar-secreto').textContent = 'Confirmar número';
    document.getElementById('seccion-listo').classList.add('oculto');
    limpiarInputs('secreto-inputs');
    limpiarInputs('intento-inputs');
    limpiarDescartesActuales();
    mostrarPantalla('config');
  };

  document.getElementById('btn-salir').onclick = () => {
    revisandoPartidaTerminada = false;
    resetearApp();
    overlay.classList.add('oculto');
  };
}

document.getElementById('btn-cerrar-overlay').addEventListener('click', () => {
  overlayUltimaChance.classList.add('oculto');
});

btnVerResultado.addEventListener('click', () => {
  if (!datosSala || datosSala.estado !== 'terminado') return;
  revisandoPartidaTerminada = false;
  mostrarResultadoFinal(true);
});

descartesDigitos.addEventListener('click', (e) => {
  const boton = e.target.closest('.descarte-btn');
  if (!boton || !descartesDigitos.contains(boton)) return;

  const digito = boton.dataset.digito;
  const descartes = cargarDescartes();
  const actual = descartes[digito] || 0;
  descartes[digito] = (actual + 1) % 3;
  guardarDescartes(descartes);
  renderizarDescartes();
});

// Navegación entre inputs de dígitos
document.addEventListener('input', (e) => {
  if (e.target.classList.contains('digito-input')) {
    const val = e.target.value;
    if (val.length > 1) e.target.value = val.slice(-1);
    if (e.target.value && e.target.nextElementSibling?.classList.contains('digito-input')) {
      e.target.nextElementSibling.focus();
    }
  }
});
document.addEventListener('keydown', (e) => {
  if (e.target.classList.contains('digito-input') && e.key === 'Backspace' && !e.target.value) {
    if (e.target.previousElementSibling?.classList.contains('digito-input')) {
      e.target.previousElementSibling.focus();
    }
  }
});

// ===== Reset =====
function resetearApp() {
  if (listenerSala) { listenerSala(); listenerSala = null; }
  if (botTimer) clearTimeout(botTimer);
  botTimer = null;
  botTurnoEnProceso = false;
  ultimoTurnoBot = null;
  revisandoPartidaTerminada = false;
  leyendaRevisionActivada = false;
  limpiarDescartesActuales();
  datosSala = null;
  miSala = null;
  miRol = null;
  LS.removeItem('salaId');
  LS.removeItem('rol');
  LS.removeItem(LOCAL_MACHINE_KEY);
  LS.removeItem(ENTRENAMIENTO_KEY);
  LS.removeItem(LEGENDARIO_KEY);
  mostrarPantalla('lobby');
  limpiarInputs('secreto-inputs');
  limpiarInputs('intento-inputs');
  document.getElementById('btn-confirmar-secreto').disabled = false;
  document.getElementById('btn-confirmar-secreto').textContent = 'Confirmar número';
  document.getElementById('seccion-listo').classList.add('oculto');
  document.getElementById('input-intento-container').classList.remove('deshabilitado');
  overlayUltimaChance.classList.add('oculto');
  overlayResultado.classList.add('oculto');
  btnVerResultado.classList.add('oculto');
  juegoLayoutContainer.classList.remove('entrenamiento');
}

// ===== Reconexión al cargar =====
prepararJuegoOffline();

const partidaLocal = cargarPartidaLocal();
if (miSala === ENTRENAMIENTO_SALA_ID && miRol && miNombre && partidaLocal && partidaLocal.modo === 'entrenamiento') {
  document.getElementById('nombre-entrenar').value = miNombre;
  datosSala = partidaLocal;
  mostrarPantalla('juego');
  manejarCambioEstado();
} else if (miSala === LOCAL_SALA_ID && miRol && miNombre && partidaLocal) {
  document.getElementById('nombre-maquina').value = miNombre;
  datosSala = partidaLocal;
  mostrarPantalla(partidaLocal.estado === 'jugando' || partidaLocal.estado === 'ultima_chance' || partidaLocal.estado === 'terminado' ? 'juego' : 'config');
  manejarCambioEstado();
} else if (miSala === LEGENDARIO_SALA_ID && miRol && miNombre && partidaLocal && partidaLocal.modo === 'legendario') {
  document.getElementById('nombre-legendario').value = miNombre;
  datosSala = partidaLocal;
  mostrarPantalla('juego');
  manejarCambioEstado();
} else if (miSala && miRol && miNombre) {
  document.getElementById('nombre-crear').value = miNombre;
  document.getElementById('nombre-unirse').value = miNombre;
  document.getElementById('nombre-maquina').value = miNombre;
  document.getElementById('nombre-entrenar').value = miNombre;
  document.getElementById('nombre-legendario').value = miNombre;
  iniciarEscuchaSala(miSala);
  mostrarPantalla('config');
  document.getElementById('sala-id-config').textContent = miSala;
} else {
  mostrarPantalla('lobby');
}