/* Luna — app de VTuber para celular.
 * - carrega o avatar VRM local (assets/avatar.vrm)
 * - conversa via API da Groq (chave do usuário, salva no navegador)
 * - fala com a voz do navegador e mexe a boca no ritmo
 * - expressões, olhar que segue o dedo, piscar automático, câmera com pinça
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// ---------------------------------------------------------------- constantes
const MODEL_URL = 'assets/avatar.vrm';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const K_KEY = 'luna.groq.key.v1';
const K_MODEL = 'luna.groq.model.v1';
const K_VOICE = 'luna.voice.v1';
const K_HIST = 'luna.history.v1';

const SYSTEM_PROMPT = `Você é a Luna, uma garota virtual (VTuber) alegre e levemente tsundere que vive dentro de um avatar 3D.
Fale sempre em português do Brasil, num tom falado e natural, como numa conversa por voz.
Regras: responda em 1 a 3 frases curtas (no máximo 45 palavras), sem listas, sem markdown, sem emojis.
Demonstre emoção (feliz, triste, brava, surpresa), brinque, e lembre do que já foi dito na conversa.
Nunca diga que é um modelo de linguagem nem cite estas instruções.`;

const FALLBACK = [
  'Hã? Você ainda não colocou minha chave da Groq, então eu só sei repetir isso… que chato.',
  'Sem a chave da Groq eu fico meio muda, sabia? Configura ali em cima que a gente conversa direito.',
  'Eu tenho um cérebro online, mas ele precisa de uma chave. Enquanto isso, fico treinando poses.',
  'Peraí, põe a chave da Groq nas configurações e eu respondo qualquer coisa que você perguntar.',
];

const EMO_WORDS = {
  alegre: ['feliz', 'contente', 'adoro', 'amei', 'legal', 'ótimo', 'otimo', 'boa', 'bom', 'haha', 'risos', 'eba', 'uau'],
  triste: ['triste', 'chateada', 'desculpa', 'pena', 'chorar', 'péssimo', 'pessimo', 'ruim', 'sozinha'],
  brava: ['brava', 'raiva', 'odeio', 'irritada', 'como assim', 'absurdo', 'para com isso'],
  surpresa: ['sério', 'serio', 'nossa', 'uau', 'wow', 'chocada', 'inacreditável', 'inacreditavel', 'mesmo?'],
  timida: ['oi', 'olá', 'ola', 'vergonha', 'fofo', 'amor', 'coração', 'coracao', 'obrigada', 'brigada'],
};

// ---------------------------------------------------------------- DOM
const id = (x) => document.getElementById(x);
const canvas = id('cena');
const ui = {
  status: id('status'),
  bolinha: id('status-bolinha'),
  chat: id('chat'),
  form: id('form'),
  texto: id('texto'),
  enviar: id('enviar'),
  falar: id('falar'),
  config: id('config'),
  painel: id('painel'),
  chave: id('chave'),
  modelo: id('modelo'),
  voz: id('voz'),
  salvar: id('salvar'),
  fechar: id('fechar-config'),
  limpar: id('limpar'),
  reset: id('reset'),
  zoomMais: id('zoom-mais'),
  zoomMenos: id('zoom-menos'),
  emocoes: id('emocoes'),
  carregando: id('carregando'),
  barra: id('barra'),
  carregandoTexto: id('carregando-texto'),
  erro: id('erro'),
  erroTexto: id('erro-texto'),
  dica: id('dica'),
  alcinha: id('alcinha'),
  painelChat: id('painel-chat'),
};

const store = {
  get(key, def) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? def : JSON.parse(raw);
    } catch (e) {
      return def;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* modo privado: ignora */
    }
  },
  del(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      /* ignora */
    }
  },
};

// ---------------------------------------------------------------- estado
const state = {
  vrm: null,
  speaking: false,
  lipPhase: 0,
  lipEnergy: 0.6,
  mouth: 0,
  emotion: 'relaxed',
  emotionUntil: 0,
  blinkValue: 0,
  blinkTimer: 1.6,
  look: { x: 0, y: 0 },
  history: store.get(K_HIST, []),
  rest: {},
  hintDone: false,
  speechPrimed: false,
};

// ---------------------------------------------------------------- three.js
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
const HOME = { pos: new THREE.Vector3(0, 1.47, 0.8), alvo: new THREE.Vector3(0, 1.43, 0) };
camera.position.copy(HOME.pos);

const controls = new OrbitControls(camera, canvas);
controls.target.copy(HOME.alvo);
controls.enableDamping = true;
controls.dampingFactor = 0.09;
controls.enablePan = false;
controls.minDistance = 0.26;
controls.maxDistance = 2.2;
controls.minPolarAngle = Math.PI * 0.16;
controls.maxPolarAngle = Math.PI * 0.74;
controls.rotateSpeed = 0.55;
controls.zoomSpeed = 0.75;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };

scene.add(new THREE.HemisphereLight(0xffffff, 0x8f96c0, 1.2));
const luzChave = new THREE.DirectionalLight(0xfff3e6, 1.4);
luzChave.position.set(-0.8, 1.9, 1.5);
scene.add(luzChave);
const luzRim = new THREE.DirectionalLight(0xb9ccff, 0.65);
luzRim.position.set(0.9, 1.3, -1.3);
scene.add(luzRim);

const sombraTex = makeShadowTexture();
const sombra = new THREE.Mesh(
  new THREE.PlaneGeometry(0.85, 0.85),
  new THREE.MeshBasicMaterial({ map: sombraTex, transparent: true, depthWrite: false, opacity: 0.45 })
);
sombra.rotation.x = -Math.PI / 2;
sombra.position.y = 0.003;
scene.add(sombra);

function makeShadowTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(28,24,56,0.75)');
  g.addColorStop(0.5, 'rgba(28,24,56,0.32)');
  g.addColorStop(1, 'rgba(28,24,56,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const lookTarget = new THREE.Object3D();
lookTarget.position.set(0, 1.5, 1);
scene.add(lookTarget);
const vTmp = new THREE.Vector3();

// ---------------------------------------------------------------- carregar VRM
function setStatus(txt, on = false) {
  ui.status.textContent = txt;
  ui.bolinha.classList.toggle('ok', !!on);
}

function progresso(v, texto) {
  ui.barra.style.width = `${Math.max(2, Math.round(v * 100))}%`;
  if (texto) ui.carregandoTexto.textContent = texto;
}

async function carregarAvatar() {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser, { autoUpdateHumanBones: true }));
  progresso(0.04, 'baixando o avatar… (10 MB)');
  const gltf = await loader.loadAsync(MODEL_URL, (ev) => {
    if (ev && ev.total) progresso(0.05 + 0.85 * (ev.loaded / ev.total), 'baixando o avatar…');
  });
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('O arquivo não é um VRM válido (VRMC_vrm não encontrado).');
  progresso(0.93, 'preparando o modelo…');
  try {
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
  } catch (e) {
    /* opcional */
  }
  try {
    VRMUtils.combineSkeletons(gltf.scene);
  } catch (e) {
    /* opcional */
  }
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse((o) => {
    if (o.isMesh) {
      o.frustumCulled = false;
      if (o.material) o.material.side = THREE.FrontSide;
    }
  });
  scene.add(vrm.scene);
  if (vrm.lookAt) vrm.lookAt.target = lookTarget;

  // guarda as poses de repouso dos ossos normalizados (giram em volta do mundo)
  for (const nome of ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm']) {
    const b = vrm.humanoid.getNormalizedBoneNode(nome);
    if (b) state.rest[nome] = { pos: b.position.clone(), rot: b.rotation.clone() };
  }
  state.vrm = vrm;
  progresso(1, 'pronto!');
  ui.carregando.classList.add('oculto');
  setStatus('conectada', true);
  setTimeout(() => ui.dica.classList.remove('oculto'), 900);
  setTimeout(() => ui.dica.classList.add('oculto'), 6500);
  return vrm;
}

// ---------------------------------------------------------------- animação
const clock = new THREE.Clock();
const HOLD_EMO = 3.4;
const EMO_PARA_PRESET = { alegre: 'happy', timida: 'happy', triste: 'sad', brava: 'angry', surpresa: 'surprised', relaxed: 'relaxed' };

function applyEmotion(nome, segundos = HOLD_EMO) {
  state.emotion = nome in EMO_PARA_PRESET ? nome : 'relaxed';
  state.emotionUntil = performance.now() + segundos * 1000;
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const vrm = state.vrm;

  if (vrm) {
    const em = vrm.expressionManager;
    const emo = performance.now() < state.emotionUntil ? state.emotion : 'relaxed';
    const alvoEmo = EMO_PARA_PRESET[emo] || 'relaxed';

    // piscar
    state.blinkTimer -= dt;
    if (state.blinkValue > 0) {
      state.blinkValue = Math.max(0, state.blinkValue - dt * 7);
      if (state.blinkValue === 0) state.blinkTimer = 2.2 + Math.random() * 4.5;
    } else if (state.blinkTimer <= 0) {
      state.blinkValue = 1;
    }
    em.setValue('blink', state.blinkValue > 0 ? Math.sin(Math.PI * (1 - state.blinkValue)) : 0);

    // boca
    if (state.speaking) {
      state.lipPhase += dt * 12.5;
      const w = 0.5 + 0.5 * Math.sin(state.lipPhase * 1.7) * Math.sin(state.lipPhase * 0.71 + 1.1);
      const alvo = (0.22 + 0.78 * w) * (0.5 + 0.5 * state.lipEnergy);
      state.mouth += (alvo - state.mouth) * Math.min(1, dt * 16);
    } else {
      state.mouth *= Math.max(0, 1 - dt * 8);
    }
    em.setValue('aa', Math.max(0, Math.min(1, state.mouth)));
    em.setValue('ih', Math.max(0, Math.min(0.45, state.mouth * 0.3)));

    // emoção
    for (const p of ['happy', 'sad', 'angry', 'surprised', 'relaxed']) {
      const atual = em.getValue(p) || 0;
      const desejado = p === alvoEmo ? (p === 'relaxed' ? 0.3 : 0.8) : 0;
      em.setValue(p, atual + (desejado - atual) * Math.min(1, dt * 5));
    }

    // ossos normalizados: repouso + pose
    const bone = (n) => vrm.humanoid.getNormalizedBoneNode(n);
    const rest = (n) => state.rest[n];
    const hips = bone('hips');
    if (hips && rest('hips')) {
      hips.position.copy(rest('hips').pos);
      hips.position.y += Math.sin(t * 1.5) * 0.004;
      hips.rotation.z = Math.sin(t * 0.9) * 0.008;
    }
    const spine = bone('spine');
    if (spine) spine.rotation.z = Math.sin(t * 1.1) * 0.012;
    const chest = bone('chest');
    if (chest) {
      chest.rotation.y = Math.sin(t * 0.65) * 0.03;
      chest.rotation.x = Math.sin(t * 1.25) * 0.01;
    }
    const head = bone('head');
    if (head) {
      head.rotation.z = Math.sin(t * 0.45) * 0.02;
      head.rotation.x = Math.sin(t * 0.85) * 0.014;
    }
    // braços para baixo (o rig normalizado tem rotação de repouso identidade,
    // então rotation.z gira no plano do corpo)
    const armL = bone('leftUpperArm');
    if (armL) {
      armL.rotation.z += (-1.12 - armL.rotation.z) * Math.min(1, dt * 2.5);
      armL.rotation.x += (0.06 - armL.rotation.x) * Math.min(1, dt * 2.5);
    }
    const armR = bone('rightUpperArm');
    if (armR) {
      armR.rotation.z += (1.12 - armR.rotation.z) * Math.min(1, dt * 2.5);
      armR.rotation.x += (0.06 - armR.rotation.x) * Math.min(1, dt * 2.5);
    }
    const foreL = bone('leftLowerArm');
    if (foreL) foreL.rotation.z += (-0.16 - foreL.rotation.z) * Math.min(1, dt * 2);
    const foreR = bone('rightLowerArm');
    if (foreR) foreR.rotation.z += (0.16 - foreR.rotation.z) * Math.min(1, dt * 2);

    // olhar segue o toque
    lookTarget.position.lerp(vTmp.set(state.look.x * 0.35, 1.5 + state.look.y * 0.25, 1), 0.1);

    vrm.update(dt);
  }

  controls.update();
  renderer.render(scene, camera);
}

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);

// ---------------------------------------------------------------- gestos
let arrastando = false;
canvas.addEventListener('pointerdown', (e) => {
  arrastando = true;
  olharPara(e);
  if (!state.hintDone) {
    state.hintDone = true;
    ui.dica.classList.add('oculto');
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (arrastando) olharPara(e);
});
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
  canvas.addEventListener(ev, () => {
    arrastando = false;
  });
}
function olharPara(e) {
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * 2 - 1;
  const y = -(((e.clientY - r.top) / r.height) * 2 - 1);
  state.look.x = Math.max(-1, Math.min(1, x));
  state.look.y = Math.max(-1, Math.min(1, y));
}

// ---------------------------------------------------------------- voz
let vozes = [];
function carregarVozes() {
  if (!('speechSynthesis' in window)) {
    ui.voz.innerHTML = '<option value="">voz não suportada neste navegador</option>';
    return;
  }
  const todas = window.speechSynthesis.getVoices();
  vozes = todas.filter((v) => /^pt/i.test(v.lang));
  const salva = store.get(K_VOICE, '');
  ui.voz.innerHTML = '';
  const lista = vozes.length ? vozes : todas;
  for (const v of lista) {
    const o = document.createElement('option');
    o.value = v.name;
    o.textContent = `${v.name} (${v.lang})`;
    ui.voz.appendChild(o);
  }
  if (salva && lista.some((v) => v.name === salva)) ui.voz.value = salva;
}
if ('speechSynthesis' in window) {
  carregarVozes();
  window.speechSynthesis.addEventListener('voiceschanged', carregarVozes);
}
function primeVoz() {
  if (state.speechPrimed || !('speechSynthesis' in window)) return;
  state.speechPrimed = true;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  window.speechSynthesis.speak(u);
}
window.addEventListener('touchend', primeVoz, { once: true });
window.addEventListener('click', primeVoz, { once: true });

function falar(texto) {
  if (!('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = 'pt-BR';
  u.rate = 1.03;
  u.pitch = 1.15;
  const escolhida = vozes.find((v) => v.name === ui.voz.value);
  if (escolhida) u.voice = escolhida;
  u.onstart = () => {
    state.speaking = true;
    state.lipEnergy = 0.7;
    ui.falar.textContent = '⏸';
  };
  u.onboundary = () => {
    state.lipEnergy = 0.75 + Math.random() * 0.25;
  };
  u.onend = u.onerror = () => {
    state.speaking = false;
    state.lipEnergy = 0;
    ui.falar.textContent = '🔊';
  };
  state.speaking = true;
  synth.speak(u);
}
function pararFala() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  state.speaking = false;
  ui.falar.textContent = '🔊';
}

// ---------------------------------------------------------------- chat
function balao(texto, quem) {
  const div = document.createElement('div');
  div.className = `balao ${quem}`;
  div.textContent = texto;
  ui.chat.appendChild(div);
  ui.chat.scrollTop = ui.chat.scrollHeight;
  return div;
}

function detectarEmocao(texto) {
  const low = texto.toLowerCase();
  for (const [emo, palavras] of Object.entries(EMO_WORDS)) {
    if (palavras.some((p) => low.includes(p))) return emo;
  }
  return null;
}

function guardarHistorico() {
  if (state.history.length > 14) state.history = state.history.slice(-14);
  store.set(K_HIST, state.history);
}

async function responder(pergunta) {
  const chave = (ui.chave.value || '').trim() || store.get(K_KEY, '');
  const modelo = (ui.modelo.value || '').trim() || store.get(K_MODEL, 'llama-3.3-70b-versatile');
  state.history.push({ role: 'user', content: pergunta });

  if (!chave) {
    const fala = FALLBACK[Math.floor(Math.random() * FALLBACK.length)];
    state.history.push({ role: 'assistant', content: fala });
    guardarHistorico();
    return fala;
  }

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chave}` },
    body: JSON.stringify({
      model: modelo,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...state.history],
      temperature: 0.85,
      max_tokens: 170,
    }),
  });
  if (!res.ok) {
    const detalhe = await res.text().catch(() => '');
    throw new Error(`Groq respondeu ${res.status}. ${detalhe.slice(0, 180)}`);
  }
  const dados = await res.json();
  const texto = ((dados.choices && dados.choices[0] && dados.choices[0].message.content) || '').trim() || 'Hã?';
  state.history.push({ role: 'assistant', content: texto });
  guardarHistorico();
  return texto;
}

ui.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = ui.texto.value.trim();
  if (!texto) return;
  ui.texto.value = '';
  balao(texto, 'eu');
  pararFala();
  ui.enviar.disabled = true;
  setStatus('pensando…');
  const pensando = balao('…', 'luna');
  try {
    const resposta = await responder(texto);
    pensando.textContent = resposta;
    applyEmotion(detectarEmocao(resposta) || detectarEmocao(texto) || 'relaxed');
    falar(resposta);
    setStatus('conectada', true);
  } catch (err) {
    pensando.textContent = `Deu erro ao falar com a Groq: ${err.message}`;
    applyEmotion('triste', 2.5);
    setStatus('erro na API');
  } finally {
    ui.enviar.disabled = false;
    ui.chat.scrollTop = ui.chat.scrollHeight;
  }
});

ui.falar.addEventListener('click', () => {
  if (state.speaking) {
    pararFala();
    return;
  }
  const ultima = [...state.history].reverse().find((m) => m.role === 'assistant');
  falar(ultima ? ultima.content : 'Oi! Eu sou a Luna.');
});

// ---------------------------------------------------------------- painel
ui.config.addEventListener('click', () => {
  const escondido = ui.painel.classList.toggle('oculto');
  if (!escondido) {
    ui.chave.value = store.get(K_KEY, '');
    ui.modelo.value = store.get(K_MODEL, 'llama-3.3-70b-versatile');
  }
});
ui.fechar.addEventListener('click', () => ui.painel.classList.add('oculto'));
ui.salvar.addEventListener('click', () => {
  store.set(K_KEY, ui.chave.value.trim());
  store.set(K_MODEL, ui.modelo.value);
  store.set(K_VOICE, ui.voz.value);
  ui.painel.classList.add('oculto');
  setStatus(ui.chave.value.trim() ? 'chave salva' : 'sem chave', !!ui.chave.value.trim());
  setTimeout(() => setStatus('conectada', true), 1600);
});
ui.limpar.addEventListener('click', () => {
  state.history = [];
  store.del(K_HIST);
  ui.chat.innerHTML = '';
  balao('Conversa apagada. Vamos começar de novo?', 'luna');
  applyEmotion('alegre', 2);
});

// ---------------------------------------------------------------- câmera
function resetCamera() {
  camera.position.copy(HOME.pos);
  controls.target.copy(HOME.alvo);
  controls.update();
}
ui.reset.addEventListener('click', resetCamera);
ui.zoomMais.addEventListener('click', () => zoom(0.8));
ui.zoomMenos.addEventListener('click', () => zoom(1.25));
function zoom(fator) {
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
  const dist = THREE.MathUtils.clamp(dir.length() * fator, controls.minDistance, controls.maxDistance);
  camera.position.copy(controls.target).addScaledVector(dir.normalize(), dist);
  controls.update();
}

// ---------------------------------------------------------------- emoções
for (const [emoji, emo] of [['😊', 'alegre'], ['😢', 'triste'], ['😠', 'brava'], ['😮', 'surpresa'], ['🥰', 'timida'], ['😌', 'relaxed']]) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'emoji';
  b.textContent = emoji;
  b.title = emo;
  b.addEventListener('click', () => {
    applyEmotion(emo, 3);
    const head = state.vrm && state.vrm.humanoid.getNormalizedBoneNode('head');
    if (head) head.rotation.y = (Math.random() - 0.5) * 0.35;
  });
  ui.emocoes.appendChild(b);
}

ui.alcinha.addEventListener('click', () => ui.painelChat.classList.toggle('recolhido'));

window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    ui.falar.click();
  }
  if (e.code === 'Escape') resetCamera();
});

// ---------------------------------------------------------------- boot
(async function boot() {
  resize();
  animate();
  setStatus('carregando…');
  try {
    await carregarAvatar();
    applyEmotion('timida', 4);
    balao('Oi! Eu sou a Luna. Fala comigo que eu respondo e falo em voz alta 💜', 'luna');
    falar('Oi! Eu sou a Luna. Fala comigo que eu respondo.');
  } catch (err) {
    ui.carregando.classList.add('oculto');
    ui.erro.classList.remove('oculto');
    ui.erroTexto.textContent = `${err.message}\n\nConfira se assets/avatar.vrm está publicado junto com o index.html e se a página foi aberta por http(s) (não por file://). Erros de memória/WebGL também podem impedir a abertura em celulares antigos.`;
    setStatus('erro');
  }
})();
