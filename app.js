// ===== Firebase =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getDatabase, ref, set, update, onValue, get } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";

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

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ===== Estado Local =====
const LS = window.localStorage;
let jugadorId = LS.getItem('jugadorId') || generarId();
LS.setItem('jugadorId', jugadorId);

let miSala = LS.getItem('salaId') || null;
let miRol = LS.getItem('rol') || null;
let miNombre = LS.getItem('nombre') || '';
let datosSala = null;
let listenerSala = null;

// ===== Elementos DOM =====
const pantallas = {
  lobby: document.getElementById('pantalla-lobby'),
  config: document.getElementById('pantalla-config'),
  juego: document.getElementById('pantalla-juego')
};
const overlayUltimaChance = document.getElementById('overlay-ultima-chance');
const overlayResultado = document.getElementById('overlay-resultado');

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

// ===== Lobby: Crear / Unirse =====
document.getElementById('tab-crear').addEventListener('click', () => {
  document.getElementById('tab-crear').classList.add('active');
  document.getElementById('tab-unirse').classList.remove('active');
  document.getElementById('form-crear').classList.remove('oculto');
  document.getElementById('form-unirse').classList.add('oculto');
});
document.getElementById('tab-unirse').addEventListener('click', () => {
  document.getElementById('tab-unirse').classList.add('active');
  document.getElementById('tab-crear').classList.remove('active');
  document.getElementById('form-unirse').classList.remove('oculto');
  document.getElementById('form-crear').classList.add('oculto');
});

document.getElementById('btn-crear').addEventListener('click', async () => {
  const nombre = document.getElementById('nombre-crear').value.trim();
  if (!nombre) return mostrarError('error-lobby', 'Poné tu nombre.');
  const salaId = generarCodigoSala();
  miNombre = nombre;
  miRol = 'jugador_1';
  miSala = salaId;
  LS.setItem('nombre', nombre);
  LS.setItem('rol', miRol);
  LS.setItem('salaId', salaId);

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

  await update(salaRef, {
    'jugador_2': { id: jugadorId, nombre, secreto: null, intentos: [], conectado: true, listo: false },
    estado: 'configurando'
  });
  iniciarEscuchaSala(codigo);
  mostrarPantalla('config');
  document.getElementById('sala-id-config').textContent = codigo;
  document.getElementById('estado-sala-config').textContent = '¡Oponente conectado!';
});

// ===== Configuración del número secreto =====
document.getElementById('btn-confirmar-secreto').addEventListener('click', async () => {
  const digitos = obtenerDigitosDeInputs('secreto-inputs');
  const error = validarDigitosUnicos(digitos);
  if (error) return mostrarError('error-secreto', error);

  const miRef = ref(db, `partidas/${miSala}/${miRol}`);
  await update(miRef, { secreto: digitos, listo: false });  // reinicia el listo al confirmar
  // La interfaz se actualiza con el listener
});

// ===== Botón "Listo" =====
document.getElementById('btn-listo').addEventListener('click', async () => {
  await update(ref(db, `partidas/${miSala}/${miRol}`), { listo: true });
  // Verificar si ambos están listos
  const snap1 = await get(ref(db, `partidas/${miSala}/jugador_1/listo`));
  const snap2 = await get(ref(db, `partidas/${miSala}/jugador_2/listo`));
  if (snap1.val() && snap2.val()) {
    await update(ref(db, `partidas/${miSala}`), { estado: 'jugando', turno: 'jugador_1' });
  }
});

// ===== Abandonar sala =====
document.getElementById('btn-abandonar-config').addEventListener('click', async () => {
  if (miRol === 'jugador_1') {
    // El creador borra la sala
    await set(ref(db, `partidas/${miSala}`), null);
  } else {
    // El invitado la deja libre
    await update(ref(db, `partidas/${miSala}`), {
      estado: 'esperando',
      'jugador_2': { id: null, nombre: '', secreto: null, intentos: [], conectado: false, listo: false }
    });
  }
  resetearApp();
});

// ===== Juego: Enviar intento (sin cambios) =====
document.getElementById('btn-enviar-intento').addEventListener('click', async () => {
  if (!datosSala || (datosSala.estado !== 'jugando' && datosSala.estado !== 'ultima_chance') || datosSala.turno !== miRol) {
    return mostrarError('error-intento', 'No es tu turno.');
  }
  const digitos = obtenerDigitosDeInputs('intento-inputs');
  const error = validarDigitosUnicos(digitos);
  if (error) return mostrarError('error-intento', error);

  const secretoOponente = miRol === 'jugador_1' ? datosSala.jugador_2.secreto : datosSala.jugador_1.secreto;
  const { buenos, regulares } = calcularBuenosRegulares(secretoOponente, digitos);

  const intentosRef = ref(db, `partidas/${miSala}/${miRol}/intentos`);
  const snap = await get(intentosRef);
  const intentos = snap.val() || [];
  const nuevoIntento = { numero: digitos, buenos, regulares };
  intentos.push(nuevoIntento);
  await set(intentosRef, intentos);
  limpiarInputs('intento-inputs');

  if (buenos === 4) {
    if (miRol === 'jugador_1') {
      const rondaActual = datosSala.ronda || 1;
      const intentosJ2 = datosSala.jugador_2?.intentos?.length || 0;
      if (intentosJ2 < rondaActual) {
        await update(ref(db, `partidas/${miSala}`), { estado: 'ultima_chance', turno: 'jugador_2' });
      } else {
        await update(ref(db, `partidas/${miSala}`), { estado: 'terminado', ganador: 'jugador_1' });
      }
    } else {
      if (datosSala.estado === 'ultima_chance') {
        await update(ref(db, `partidas/${miSala}`), { estado: 'terminado', ganador: 'empate' });
      } else {
        await update(ref(db, `partidas/${miSala}`), { estado: 'terminado', ganador: 'jugador_2' });
      }
    }
  } else {
    const nuevoTurno = miRol === 'jugador_1' ? 'jugador_2' : 'jugador_1';
    const nuevaRonda = miRol === 'jugador_2' ? (datosSala.ronda || 1) + 1 : (datosSala.ronda || 1);
    await update(ref(db, `partidas/${miSala}`), { turno: nuevoTurno, ronda: nuevaRonda, estado: 'jugando' });
  }
});

// ===== Escucha de cambios en la sala =====
function iniciarEscuchaSala(salaId) {
  if (listenerSala) listenerSala();
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

  if (estado === 'esperando' || estado === 'configurando') {
    mostrarPantalla('config');
    const espera = document.getElementById('estado-sala-config');
    if (estado === 'esperando') espera.textContent = 'Esperando oponente...';
    else espera.textContent = '¡Oponente conectado! Configurá tu número.';

    const miData = datosSala[miRol];
    if (miData && miData.secreto) {
      document.getElementById('btn-confirmar-secreto').disabled = true;
      document.getElementById('btn-confirmar-secreto').textContent = '✅ Número guardado';
      document.getElementById('seccion-listo').classList.remove('oculto');
      if (miData.listo) {
        document.getElementById('btn-listo').disabled = true;
        document.getElementById('btn-listo').textContent = '✅ Listo ✓';
      } else {
        document.getElementById('btn-listo').disabled = false;
        document.getElementById('btn-listo').textContent = '✅ ¡Listo!';
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
  }

  if (estado === 'terminado') {
    mostrarPantalla('juego');
    renderizarJuego();
    mostrarResultadoFinal();
  }
}

// (renderizarJuego, mostrarResultadoFinal, etc. sin cambios, sólo ajusté el texto de la última chance)
function renderizarJuego() {
  const miData = datosSala[miRol];
  const oponenteRol = miRol === 'jugador_1' ? 'jugador_2' : 'jugador_1';
  const oponenteData = datosSala[oponenteRol];
  const estado = datosSala.estado;
  const turno = datosSala.turno;
  const ronda = datosSala.ronda || 1;

  document.getElementById('ronda-badge').textContent = `Ronda ${ronda}`;

  const turnoInd = document.getElementById('indicador-turno');
  const turnoTexto = document.getElementById('turno-texto');
  const turnoIcono = document.getElementById('turno-icono');
  turnoInd.classList.remove('mi-turno', 'su-turno', 'ultima');

  if (estado === 'ultima_chance') {
    turnoInd.classList.add('ultima');
    turnoTexto.textContent = (turno === miRol) ? '⚠️ ¡ÚLTIMA CHANCE! ¡Adiviná YA!' : '⏳ Tu oponente tiene la última chance...';
    turnoIcono.textContent = (turno === miRol) ? '🔥' : '😰';
  } else if (turno === miRol) {
    turnoInd.classList.add('mi-turno');
    turnoTexto.textContent = '✅ Es tu turno';
    turnoIcono.textContent = '🎯';
  } else {
    turnoInd.classList.add('su-turno');
    turnoTexto.textContent = '⏳ Turno del oponente';
    turnoIcono.textContent = '🤔';
  }

  document.getElementById('nombre-oponente').textContent = oponenteData?.nombre ? `🤔 ${oponenteData.nombre}` : '🤔 Oponente';

  const listaPropia = document.getElementById('lista-propia');
  listaPropia.innerHTML = '';
  if (miData?.intentos) {
    miData.intentos.forEach((int, idx) => {
      const fila = document.createElement('div');
      fila.className = 'historial-fila';
      fila.innerHTML = `<span>${idx + 1}</span><span>${int.numero}</span><span class="b">${int.buenos}</span><span class="r">${int.regulares}</span>`;
      listaPropia.appendChild(fila);
    });
  }

  const listaOponente = document.getElementById('lista-oponente');
  listaOponente.innerHTML = '';
  if (oponenteData?.intentos) {
    oponenteData.intentos.forEach((int, idx) => {
      const fila = document.createElement('div');
      fila.className = 'historial-fila';
      fila.innerHTML = `<span>${idx + 1}</span><span>${int.numero}</span><span class="b">${int.buenos}</span><span class="r">${int.regulares}</span>`;
      listaOponente.appendChild(fila);
    });
  }

  const inputContainer = document.getElementById('input-intento-container');
  const aviso = document.getElementById('aviso-turno-propio');
  if (estado === 'terminado') {
    inputContainer.classList.add('deshabilitado');
    aviso.textContent = 'Juego terminado.';
  } else if (turno === miRol && (estado === 'jugando' || estado === 'ultima_chance')) {
    inputContainer.classList.remove('deshabilitado');
    aviso.textContent = estado === 'ultima_chance' ? '🔥 ¡Es ahora o nunca!' : 'Ingresá 4 dígitos sin repetir:';
    document.getElementById('btn-enviar-intento').textContent = estado === 'ultima_chance' ? '¡Disparo final!' : 'Enviar intento';
  } else {
    inputContainer.classList.add('deshabilitado');
    aviso.textContent = 'Esperando tu turno...';
  }

  const pensando = document.getElementById('pensando-oponente');
  if (estado !== 'terminado' && turno === oponenteRol) {
    pensando.textContent = '💭 Pensando...';
  } else {
    pensando.textContent = '';
  }

  if (estado === 'ultima_chance' && turno === miRol) {
    overlayUltimaChance.classList.remove('oculto');
    document.getElementById('ultima-chance-titulo').textContent = '⚠️ ¡Última Chance!';
    const nombreOponente = miRol === 'jugador_1' ? datosSala.jugador_2?.nombre : datosSala.jugador_1?.nombre;
    document.getElementById('ultima-chance-texto').textContent = `¡${nombreOponente || 'Tu oponente'} descifró tu número! Tenés este único intento para empatar.`;
  }
}

function mostrarResultadoFinal() {
  const ganador = datosSala.ganador;
  const overlay = overlayResultado;
  overlay.classList.remove('oculto');
  const titulo = document.getElementById('resultado-titulo');
  const detalle = document.getElementById('resultado-detalle');
  const secretos = document.getElementById('resultado-secretos');

  const miSecreto = datosSala[miRol]?.secreto || '????';
  const opRol = miRol === 'jugador_1' ? 'jugador_2' : 'jugador_1';
  const opSecreto = datosSala[opRol]?.secreto || '????';

  if (ganador === miRol) {
    titulo.textContent = '🎉 ¡Ganaste!';
    titulo.style.color = 'var(--exito)';
    detalle.textContent = 'Descifraste el número de tu oponente.';
  } else if (ganador === 'empate') {
    titulo.textContent = '🤝 ¡Empate!';
    titulo.style.color = 'var(--bueno)';
    detalle.textContent = 'Ambos descifraron el número en la misma ronda.';
  } else {
    titulo.textContent = '😞 Perdiste';
    titulo.style.color = 'var(--error)';
    detalle.textContent = 'Tu oponente descifró tu número primero.';
  }
  secretos.textContent = `Tu número: ${miSecreto} | Su número: ${opSecreto}`;

  document.getElementById('btn-revancha').onclick = async () => {
    overlay.classList.add('oculto');
    await update(ref(db, `partidas/${miSala}`), {
      estado: 'configurando',
      turno: 'jugador_1',
      ronda: 1,
      ganador: null,
      'jugador_1/secreto': null,
      'jugador_1/intentos': [],
      'jugador_1/listo': false,
      'jugador_2/secreto': null,
      'jugador_2/intentos': [],
      'jugador_2/listo': false
    });
    document.getElementById('btn-confirmar-secreto').disabled = false;
    document.getElementById('btn-confirmar-secreto').textContent = 'Confirmar número';
    document.getElementById('seccion-listo').classList.add('oculto');
    limpiarInputs('secreto-inputs');
    limpiarInputs('intento-inputs');
    mostrarPantalla('config');
  };

  document.getElementById('btn-salir').onclick = () => {
    resetearApp();
    overlay.classList.add('oculto');
  };
}

document.getElementById('btn-cerrar-overlay').addEventListener('click', () => {
  overlayUltimaChance.classList.add('oculto');
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
  datosSala = null;
  miSala = null;
  miRol = null;
  LS.removeItem('salaId');
  LS.removeItem('rol');
  mostrarPantalla('lobby');
  limpiarInputs('secreto-inputs');
  limpiarInputs('intento-inputs');
  document.getElementById('btn-confirmar-secreto').disabled = false;
  document.getElementById('btn-confirmar-secreto').textContent = 'Confirmar número';
  document.getElementById('seccion-listo').classList.add('oculto');
  document.getElementById('input-intento-container').classList.remove('deshabilitado');
  overlayUltimaChance.classList.add('oculto');
  overlayResultado.classList.add('oculto');
}

// ===== Reconexión al cargar =====
if (miSala && miRol && miNombre) {
  document.getElementById('nombre-crear').value = miNombre;
  document.getElementById('nombre-unirse').value = miNombre;
  iniciarEscuchaSala(miSala);
  mostrarPantalla('config');
  document.getElementById('sala-id-config').textContent = miSala;
} else {
  mostrarPantalla('lobby');
}