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
let botTimer = null;
let botTurnoEnProceso = false;
let ultimoTurnoBot = null;

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

function obtenerRolOponente(rol) {
  return rol === 'jugador_1' ? 'jugador_2' : 'jugador_1';
}

function obtenerIntentos(sala, rol) {
  const intentos = sala?.[rol]?.intentos;
  if (Array.isArray(intentos)) return intentos.filter(Boolean);
  if (!intentos) return [];
  return Object.values(intentos).filter(Boolean);
}

function esModoMaquina(sala = datosSala) {
  return sala?.modo === 'maquina';
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
  const intentos = obtenerIntentos(sala, 'jugador_2');
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

// ===== Lobby: Crear / Unirse =====
function activarTabLobby(tabActiva) {
  ['crear', 'unirse', 'maquina'].forEach(tab => {
    document.getElementById(`tab-${tab}`).classList.toggle('active', tab === tabActiva);
    document.getElementById(`form-${tab}`).classList.toggle('oculto', tab !== tabActiva);
  });
}

document.getElementById('tab-crear').addEventListener('click', () => activarTabLobby('crear'));
document.getElementById('tab-unirse').addEventListener('click', () => activarTabLobby('unirse'));
document.getElementById('tab-maquina').addEventListener('click', () => activarTabLobby('maquina'));

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

document.getElementById('btn-jugar-maquina').addEventListener('click', async () => {
  const nombre = document.getElementById('nombre-maquina').value.trim();
  const dificultad = document.getElementById('dificultad-maquina').value;
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
    estado: 'configurando',
    modo: 'maquina',
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
  });

  iniciarEscuchaSala(salaId);
  mostrarPantalla('config');
  document.getElementById('sala-id-config').textContent = salaId;
  document.getElementById('estado-sala-config').textContent = 'La máquina ya eligió su número.';
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

// ===== Juego: Enviar intento =====
async function registrarIntento(rol, digitos) {
  if (!miSala) return false;
  const salaRef = ref(db, `partidas/${miSala}`);
  const snap = await get(salaRef);
  if (!snap.exists()) return false;

  const sala = snap.val();
  const estado = sala.estado;
  if ((estado !== 'jugando' && estado !== 'ultima_chance') || sala.turno !== rol) return false;

  const oponenteRol = obtenerRolOponente(rol);
  const secretoOponente = sala[oponenteRol]?.secreto;
  if (!secretoOponente) return false;

  const { buenos, regulares } = calcularBuenosRegulares(secretoOponente, digitos);
  const intentos = obtenerIntentos(sala, rol);
  intentos.push({ numero: digitos, buenos, regulares });

  const cambios = {
    [`${rol}/intentos`]: intentos
  };

  if (buenos === 4) {
    if (rol === 'jugador_1') {
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
  } else if (estado === 'ultima_chance') {
    cambios.estado = 'terminado';
    cambios.ganador = oponenteRol;
  } else {
    cambios.turno = oponenteRol;
    cambios.ronda = rol === 'jugador_2' ? (sala.ronda || 1) + 1 : (sala.ronda || 1);
    cambios.estado = 'jugando';
  }

  await update(salaRef, cambios);
  return true;
}

document.getElementById('btn-enviar-intento').addEventListener('click', async () => {
  if (!datosSala || (datosSala.estado !== 'jugando' && datosSala.estado !== 'ultima_chance') || datosSala.turno !== miRol) {
    return mostrarError('error-intento', 'No es tu turno.');
  }
  const digitos = obtenerDigitosDeInputs('intento-inputs');
  const error = validarDigitosUnicos(digitos);
  if (error) return mostrarError('error-intento', error);

  const enviado = await registrarIntento(miRol, digitos);
  if (enviado) limpiarInputs('intento-inputs');
});

function programarJugadaMaquina() {
  if (!esModoMaquina() || miRol !== 'jugador_1') return;
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
      const snap = await get(ref(db, `partidas/${miSala}`));
      if (!snap.exists()) return;
      const salaActual = snap.val();
      if (!esModoMaquina(salaActual) || salaActual.turno !== 'jugador_2') return;
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
    else if (esModoMaquina()) espera.textContent = 'La máquina ya eligió su número. Configurá el tuyo.';
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

  document.getElementById('ronda-badge').textContent = `Ronda ${ronda}`;

  const turnoInd = document.getElementById('indicador-turno');
  const turnoTexto = document.getElementById('turno-texto');
  const turnoIcono = document.getElementById('turno-icono');
  turnoInd.classList.remove('mi-turno', 'su-turno', 'ultima');

  if (estado === 'ultima_chance') {
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

  const iconoOponente = contraMaquina ? '🤖' : '🤔';
  document.getElementById('nombre-oponente').textContent = oponenteData?.nombre ? `${iconoOponente} ${oponenteData.nombre}` : `${iconoOponente} Oponente`;

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
  obtenerIntentos(datosSala, oponenteRol).forEach((int, idx) => {
    const fila = document.createElement('div');
    fila.className = 'historial-fila';
    fila.innerHTML = `<span>${idx + 1}</span><span>${int.numero}</span><span class="b">${int.buenos}</span><span class="r">${int.regulares}</span>`;
    listaOponente.appendChild(fila);
  });

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
    pensando.textContent = contraMaquina ? '💭 Calculando...' : '💭 Pensando...';
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
  const contraMaquina = esModoMaquina();

  const miSecreto = datosSala[miRol]?.secreto || '????';
  const opRol = obtenerRolOponente(miRol);
  const opSecreto = datosSala[opRol]?.secreto || '????';

  if (ganador === miRol) {
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
  secretos.textContent = `Tu número: ${miSecreto} | Su número: ${opSecreto}`;

  document.getElementById('btn-revancha').onclick = async () => {
    overlay.classList.add('oculto');
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

    await update(ref(db, `partidas/${miSala}`), cambios);
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
  if (botTimer) clearTimeout(botTimer);
  botTimer = null;
  botTurnoEnProceso = false;
  ultimoTurnoBot = null;
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
  document.getElementById('nombre-maquina').value = miNombre;
  iniciarEscuchaSala(miSala);
  mostrarPantalla('config');
  document.getElementById('sala-id-config').textContent = miSala;
} else {
  mostrarPantalla('lobby');
}
