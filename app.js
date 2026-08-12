// ==========================================
// 1. INICIALIZAÇÃO DO FIREBASE
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ⚠️ COLE AS CHAVES DO SEU PROJETO AQUI DENTRO:
const firebaseConfig = {
  apiKey: "AIzaSyBKgqpp7QlIsGopXvstXOQn01v6LvOxqLg",
  authDomain: "controle-presenca-app.firebaseapp.com",
  projectId: "controle-presenca-app",
  storageBucket: "controle-presenca-app.firebasestorage.app",
  messagingSenderId: "140312143617",
  appId: "1:140312143617:web:80ad2fdfd0d532e916dd00",
  measurementId: "G-K7TDGBZKJK"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const db = getFirestore(app);

// ==========================================
// 2. ESTADO GLOBAL DA APLICAÇÃO
// ==========================================
let currentUser = null;
let subjects = [];
let expandedIds = new Set();
let currentDate = new Date();
let selectedCalDate = null;

// PWA Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.log('SW registration failed: ', err));
  });
}

// ==========================================
// 3. TEMA E INTERFACE
// ==========================================
const themeBtn = document.getElementById('btn-theme');
const storedTheme = localStorage.getItem('theme');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

if (storedTheme === 'dark' || (!storedTheme && prefersDark)) {
  document.body.classList.add('dark-theme');
  themeBtn.textContent = '☀️';
}

themeBtn.addEventListener('click', () => {
  const isDark = document.body.classList.toggle('dark-theme');
  document.body.classList.toggle('light-theme', !isDark);
  themeBtn.textContent = isDark ? '☀️' : '🌙';
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
});

// Tab Handling
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.getAttribute('data-tab')).classList.add('active');
    
    // Atualiza views se necessário
    if (btn.getAttribute('data-tab') === 'tab-calendario') renderCalendar();
    if (btn.getAttribute('data-tab') === 'tab-cronograma') renderCronograma();
  });
});

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  void toast.offsetWidth;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

function uid() { return Math.random().toString(36).slice(2, 10); }

// ==========================================
// 4. LÓGICA DE AUTENTICAÇÃO E BANCO (NUVEM)
// ==========================================
const loginScreen = document.getElementById('login-screen');
const mainApp = document.getElementById('app');
const btnLoginGoogle = document.getElementById('btn-login-google');
const btnLogout = document.getElementById('btn-logout');

// Escuta o status do login em tempo real
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    loginScreen.style.display = 'none';
    mainApp.style.display = 'block';
    showToast(`Bem-vindo, ${user.displayName.split(' ')[0]}!`);
    await carregarDoFirebase();
  } else {
    currentUser = null;
    subjects = [];
    loginScreen.style.display = 'flex';
    mainApp.style.display = 'none';
  }
});

btnLoginGoogle.addEventListener('click', () => {
  signInWithPopup(auth, provider).catch(error => {
    console.error(error);
    showToast('Erro ao fazer login', 'error');
  });
});

btnLogout.addEventListener('click', () => {
  signOut(auth);
});

async function carregarDoFirebase() {
  if (!currentUser) return;
  try {
    const docRef = doc(db, "users", currentUser.uid);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      subjects = docSnap.data().subjects || [];
      // Garante que matérias antigas tenham o array schedule
      subjects.forEach(s => { if(!s.schedule) s.schedule = []; });
    } else {
      subjects = [];
    }
    
    render();
    if (document.getElementById('tab-calendario').classList.contains('active')) renderCalendar();
    if (document.getElementById('tab-cronograma').classList.contains('active')) renderCronograma();
  } catch (e) {
    console.error("Erro ao carregar:", e);
    showToast('Erro ao carregar dados', 'error');
  }
}

async function saveSubjects(subs) {
  if (!currentUser) return;
  try {
    const docRef = doc(db, "users", currentUser.uid);
    await setDoc(docRef, { subjects: subs });
  } catch (e) {
    console.error("Erro ao salvar:", e);
    showToast('Erro ao sincronizar com a nuvem', 'error');
  }
}

// ==========================================
// 5. RENDERIZAÇÃO MATÉRIAS (E Matemática)
// ==========================================
function computeStats(s) {
  const total = Math.max(0, Number(s.totalClasses) || 0);
  const limitPct = Math.max(1, Math.min(100, Number(s.limitPercent) || 25));
  const faltas = s.log.filter(e => e.status === 'falta').length;
  const dadas = s.log.length;
  const limiteFaltas = Math.floor((total * limitPct) / 100);
  const restantes = limiteFaltas - faltas;
  const pctAusencia = total > 0 ? (faltas / total) * 100 : 0;
  const pctDoLimite = limiteFaltas > 0 ? (faltas / limiteFaltas) * 100 : (faltas > 0 ? 100 : 0);
  
  const pctProgresso = total > 0 ? (dadas / total) * 100 : 0;
  
  let nivel = 'seguro'; let statusLabel = 'Regular';
  if (limiteFaltas > 0) {
    const razao = faltas / limiteFaltas;
    if (razao >= 1) { nivel = 'reprovado'; statusLabel = 'Reprovado por falta'; }
    else if (razao >= 0.75) { nivel = 'perigo'; statusLabel = 'Perigo'; }
    else if (razao >= 0.4) { nivel = 'atencao'; statusLabel = 'Atenção'; }
  } else if (faltas > 0) {
    nivel = 'reprovado'; statusLabel = 'Reprovado por falta';
  }
  
  return { total, limitPct, faltas, dadas, limiteFaltas, restantes, pctAusencia, pctDoLimite, pctProgresso, nivel, statusLabel };
}

const NIVEL_COLOR_VAR = { seguro: 'var(--success)', atencao: 'var(--warning)', perigo: 'var(--danger)', reprovado: 'var(--danger)' };

function ringSVG(pct, colorVar) {
  const r = 24, c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const offset = c - (clamped / 100) * c;
  return `<svg width="56" height="56" viewBox="0 0 56 56">
      <circle cx="28" cy="28" r="${r}" fill="none" stroke="var(--border)" stroke-width="5"/>
      <circle cx="28" cy="28" r="${r}" fill="none" stroke="${colorVar}" stroke-width="5"
        stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${offset}"
        style="transition: stroke-dashoffset 0.4s ease"/>
    </svg>`;
}

function logDots(log) {
  return log.map(entry => {
    const cls = entry.status === 'falta' ? 'falta' : 'presente';
    const title = (entry.status === 'falta' ? 'Falta' : 'Presença') + ' — ' + new Date(entry.date).toLocaleDateString('pt-BR');
    return `<div class="log-dot ${cls}" title="${title}"></div>`;
  }).join('');
}

function logList(log) {
  const items = log.slice().reverse().map(entry => {
    const cls = entry.status === 'falta' ? 'falta' : 'presente';
    const label = entry.status === 'falta' ? 'Falta' : 'Presença';
    const dateLabel = new Date(entry.date).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
    return `<div class="log-item"><span class="dot ${cls}"></span><b>${label}</b> &middot; ${dateLabel}</div>`;
  }).join('');
  return `<div class="log-list">${items}</div>`;
}

function escapeHTML(str) {
  const d = document.createElement('div'); d.textContent = str; return d.innerHTML;
}

function render() {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  
  if (subjects.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  grid.innerHTML = subjects.map(s => {
    const stats = computeStats(s);
    const colorVar = NIVEL_COLOR_VAR[stats.nivel];
    const restanteTxt = stats.limiteFaltas > 0 ? (stats.restantes >= 0 ? `pode faltar mais <b>${stats.restantes}</b>` : `<b style="color:var(--danger)">excedeu em ${Math.abs(stats.restantes)}</b>`) : '';
      
    return `<div class="card card-surface" data-id="${s.id}">
        <div class="card-top">
          <div class="ring-wrap">${ringSVG(stats.pctProgresso, colorVar)}<div class="ring-pct" style="color:${colorVar}">${Math.round(stats.pctProgresso)}%</div></div>
          <div><h3>${escapeHTML(s.name)}</h3><div class="subline">${stats.dadas} de ${stats.total} aulas</div></div>
        </div>
        <span class="badge ${stats.nivel}">${stats.statusLabel}</span>
        <div class="stats-row"><span><b>${stats.faltas}</b> falta${stats.faltas === 1 ? '' : 's'}</span><span><b>${stats.pctAusencia.toFixed(1)}%</b> ausência</span><span>${restanteTxt}</span></div>
        ${s.log.length > 0 ? `<div class="legend"><span><i class="dot-presenca"></i>presença</span><span><i class="dot-falta"></i>falta</span></div>
        <div class="log-row">${logDots(s.log)}</div><button class="btn-toggle-log" data-action="toggle-log">${expandedIds.has(s.id) ? 'Ocultar datas' : 'Ver datas'}</button>${expandedIds.has(s.id) ? logList(s.log) : ''}` : `<div class="log-empty" style="margin-bottom:14px;">nenhuma aula registrada ainda</div>`}
        <div class="actions">
          <button class="btn-presenca" data-action="presente">+ Presença</button>
          <button class="btn-falta" data-action="falta">+ Falta</button>
          <button class="btn-undo" data-action="undo" ${s.log.length === 0 ? 'disabled' : ''} aria-label="Desfazer">&#8634;</button>
        </div>
      </div>`;
  }).join('');
}

// ==========================================
// 6. ABA DE CRONOGRAMA & FILTROS
// ==========================================
function renderCronograma() {
  const selectModal = document.getElementById('crono-subject');
  const selectFilter = document.getElementById('filter-subject');
  const typeFilter = document.getElementById('filter-type');
  const listContainer = document.getElementById('crono-list');
  
  // Salva a opção de filtro que já estava selecionada antes de atualizar
  const currentFilterSub = selectFilter.value;
  const currentFilterType = typeFilter.value;

  // Popula os selects de matérias (Tanto o do form modal, quanto o do filtro)
  if(subjects.length === 0) {
    selectModal.innerHTML = '<option value="">Nenhuma matéria...</option>';
    selectFilter.innerHTML = '<option value="all">Todas as Matérias</option>';
    listContainer.innerHTML = '<div class="detail-empty">Nenhuma matéria cadastrada.</div>';
    return;
  }
  
  selectModal.innerHTML = subjects.map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`).join('');
  
  // Atualiza o select de Filtro mantendo a seleção atual
  selectFilter.innerHTML = '<option value="all">Todas as Matérias</option>' + 
    subjects.map(s => `<option value="${s.id}" ${s.id === currentFilterSub ? 'selected' : ''}>${escapeHTML(s.name)}</option>`).join('');
  
  // Reúne os eventos
  let allEvents = [];
  subjects.forEach(sub => {
    if(sub.schedule) {
      sub.schedule.forEach(ev => {
        allEvents.push({ ...ev, subjectId: sub.id, subjectName: sub.name });
      });
    }
  });
  
  // Filtro de Data: Pega apenas de hoje em diante e ordena
  const todayStr = new Date().toISOString().split('T')[0];
  let filteredEvents = allEvents.filter(e => e.date >= todayStr);
  filteredEvents.sort((a, b) => new Date(a.date) - new Date(b.date));
  
  // Aplica os filtros selecionados pelo usuário
  if (currentFilterSub !== 'all' && currentFilterSub !== '') {
    filteredEvents = filteredEvents.filter(e => e.subjectId === currentFilterSub);
  }
  if (currentFilterType !== 'all') {
    filteredEvents = filteredEvents.filter(e => e.type === currentFilterType);
  }

  // Renderiza a lista
  if(filteredEvents.length === 0) {
    listContainer.innerHTML = '<div class="detail-empty" style="margin-top:20px;">Nenhum evento encontrado para estes filtros.</div>';
    return;
  }

  const monthNamesShort = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

  listContainer.innerHTML = filteredEvents.map(ev => {
    let iconStr = 'T'; let cls = 'topico';
    if(ev.type === 'prova') { iconStr = '!'; cls = 'prova'; }
    if(ev.type === 'trabalho') { iconStr = '★'; cls = 'trabalho'; }
    
    // Converte a data para o Bloco de Data (Dia e Mês)
    const [y, m, d] = ev.date.split('-');
    const dayStr = d;
    const monthStr = monthNamesShort[parseInt(m, 10) - 1];

    return `
      <div class="crono-card">
        <div class="crono-date-block">
          <span class="day">${dayStr}</span>
          <span class="month">${monthStr}</span>
        </div>
        <div class="crono-content">
          <div style="display:flex; align-items:center; gap: 10px; flex: 1; overflow:hidden;">
            <div class="detail-status ${cls}">${iconStr}</div>
            <div class="detail-info" style="overflow:hidden; text-overflow:ellipsis;">
              <b style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHTML(ev.title)}</b>
              <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHTML(ev.subjectName)}</span>
            </div>
          </div>
          <button class="btn-del-crono" data-sub="${ev.subjectId}" data-evid="${ev.id}">Apagar</button>
        </div>
      </div>
    `;
  }).join('');
}

// Escuta as mudanças nos filtros para atualizar a lista instantaneamente
document.getElementById('filter-subject').addEventListener('change', renderCronograma);
document.getElementById('filter-type').addEventListener('change', renderCronograma);

// Modal de Adicionar Evento (Cronograma)
const modalAddCronoOverlay = document.getElementById('modal-add-crono-overlay');
document.getElementById('btn-open-add-crono').addEventListener('click', (e) => {
  e.stopPropagation(); dropdown.style.display = 'none'; modalAddCronoOverlay.style.display = 'flex';
});
document.getElementById('btn-close-add-crono-modal').addEventListener('click', () => { 
  modalAddCronoOverlay.style.display = 'none'; 
});
modalAddCronoOverlay.addEventListener('click', (e) => { 
  if (e.target === modalAddCronoOverlay) modalAddCronoOverlay.style.display = 'none'; 
});


// Botão: Salvar no Cronograma
document.getElementById('btn-add-crono').addEventListener('click', () => {
  const subId = document.getElementById('crono-subject').value;
  const dateVal = document.getElementById('crono-date').value;
  const typeVal = document.getElementById('crono-type').value;
  const titleVal = document.getElementById('crono-title').value.trim();
  const errEl = document.getElementById('crono-error');

  if(!subId) { errEl.textContent = 'Cadastre uma matéria primeiro.'; return; }
  if(!dateVal) { errEl.textContent = 'Escolha uma data para o evento.'; return; }
  if(!titleVal) { errEl.textContent = 'Dê um título ao evento (ex: Prova 1).'; return; }

  errEl.textContent = '';
  
  const subject = subjects.find(s => s.id === subId);
  if(subject) {
    if(!subject.schedule) subject.schedule = [];
    subject.schedule.push({ id: uid(), date: dateVal, type: typeVal, title: titleVal });
    saveSubjects(subjects);
    
    // Limpa campos e esconde Modal
    document.getElementById('crono-title').value = '';
    modalAddCronoOverlay.style.display = 'none';
    
    showToast('Evento agendado com sucesso!');
    renderCronograma();
    if(document.getElementById('tab-calendario').classList.contains('active')) renderCalendar();
  }
});

// Botão: Apagar do Cronograma
document.getElementById('crono-list').addEventListener('click', (e) => {
  if (e.target.classList.contains('btn-del-crono')) {
    const subId = e.target.getAttribute('data-sub');
    const evId = e.target.getAttribute('data-evid');
    
    const subject = subjects.find(s => s.id === subId);
    if(subject && subject.schedule) {
      subject.schedule = subject.schedule.filter(ev => ev.id !== evId);
      saveSubjects(subjects);
      renderCronograma();
      showToast('Evento apagado.');
    }
  }
});

// ==========================================
// 7. CALENDÁRIO LOGIC (Com Integração)
// ==========================================
const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function renderCalendar() {
  const monthYearLabel = document.getElementById('calendar-month-year');
  const daysContainer = document.getElementById('calendar-days');
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  monthYearLabel.textContent = `${monthNames[month]} ${year}`;
  
  const eventsByDate = {};
  
  subjects.forEach(sub => {
    sub.log.forEach(entry => {
      const d = new Date(entry.date);
      const dateKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if (!eventsByDate[dateKey]) eventsByDate[dateKey] = [];
      eventsByDate[dateKey].push({ source: 'log', subject: sub.name, status: entry.status, time: entry.date });
    });

    if(sub.schedule) {
      sub.schedule.forEach(ev => {
        if (!eventsByDate[ev.date]) eventsByDate[ev.date] = [];
        eventsByDate[ev.date].push({ source: 'schedule', subject: sub.name, type: ev.type, title: ev.title });
      });
    }
  });

  daysContainer.innerHTML = '';
  const firstDayIndex = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  for (let i = 0; i < firstDayIndex; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'cal-cell empty';
    daysContainer.appendChild(emptyCell);
  }

  for (let i = 1; i <= daysInMonth; i++) {
    const cell = document.createElement('div');
    const dateKey = `${year}-${String(month+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
    cell.className = 'cal-cell';
    if (dateKey === todayKey) cell.classList.add('today');
    if (dateKey === selectedCalDate) cell.classList.add('selected');
    cell.textContent = i;
    cell.setAttribute('data-date', dateKey);
    
    if (eventsByDate[dateKey]) {
      const dotsContainer = document.createElement('div'); dotsContainer.className = 'cal-dots';
      const dayItems = eventsByDate[dateKey];
      
      for (let j = 0; j < Math.min(dayItems.length, 3); j++) {
        const dot = document.createElement('div'); 
        if (dayItems[j].source === 'log') {
          dot.className = `cal-dot ${dayItems[j].status}`; 
        } else {
          dot.className = `cal-dot ${dayItems[j].type}`; 
        }
        dotsContainer.appendChild(dot);
      }
      if (dayItems.length > 3) {
        const dotMore = document.createElement('div'); dotMore.className = 'cal-dot more'; dotsContainer.appendChild(dotMore);
      }
      cell.appendChild(dotsContainer);
    }
    
    cell.addEventListener('click', () => {
      document.querySelectorAll('.cal-cell').forEach(c => c.classList.remove('selected'));
      cell.classList.add('selected');
      selectedCalDate = dateKey;
      showDayDetails(dateKey, eventsByDate[dateKey]);
    });
    daysContainer.appendChild(cell);
  }
}

function showDayDetails(dateKey, dayItems) {
  const detailsBox = document.getElementById('day-details');
  const detailsTitle = document.getElementById('day-details-title');
  const detailsList = document.getElementById('day-details-list');
  const [y, m, d] = dateKey.split('-');
  const dateObj = new Date(y, m-1, d);
  detailsTitle.textContent = dateObj.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  
  if (!dayItems || dayItems.length === 0) {
    detailsList.innerHTML = '<div class="detail-empty">Nenhum evento ou registro.</div>';
  } else {
    detailsList.innerHTML = dayItems.map(item => {
      if (item.source === 'log') {
        const timeStr = new Date(item.time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute:'2-digit' });
        const icon = item.status === 'falta' ? '✕' : '✓';
        return `<div class="detail-item"><div class="detail-status ${item.status}">${icon}</div><div class="detail-info"><b>${escapeHTML(item.subject)}</b><span>${item.status === 'falta' ? 'Falta' : 'Presença'} &middot; às ${timeStr}</span></div></div>`;
      } else {
        let icon = 'T'; let cls = 'topico'; let typeLabel = 'Tópico de Aula';
        if (item.type === 'prova') { icon = '!'; cls = 'prova'; typeLabel = 'Avaliação'; }
        if (item.type === 'trabalho') { icon = '★'; cls = 'trabalho'; typeLabel = 'Trabalho'; }
        return `<div class="detail-item"><div class="detail-status ${cls}">${icon}</div><div class="detail-info"><b>${escapeHTML(item.title)}</b><span>${escapeHTML(item.subject)} &middot; ${typeLabel}</span></div></div>`;
      }
    }).join('');
  }
  detailsBox.style.display = 'block';
}

document.getElementById('btn-prev-month').addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar(); });
document.getElementById('btn-next-month').addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(); });

// ==========================================
// 8. CRUD E MENUS (Matérias)
// ==========================================
document.getElementById('btn-add').addEventListener('click', () => {
  const nameEl = document.getElementById('in-name'); const totalEl = document.getElementById('in-total'); const limitEl = document.getElementById('in-limit'); const errEl = document.getElementById('error');
  const name = nameEl.value.trim(); const total = Number(totalEl.value); const limit = Number(limitEl.value) || 25;

  if (!name) { errEl.textContent = 'Dê um nome para a matéria.'; return; }
  if (!total || total <= 0) { errEl.textContent = 'Informe o número total de aulas previstas.'; return; }

  errEl.textContent = '';
  subjects.push({ id: uid(), name, totalClasses: total, limitPercent: limit, log: [], schedule: [] });
  
  saveSubjects(subjects);
  
  nameEl.value = ''; totalEl.value = ''; limitEl.value = '25';
  document.getElementById('modal-add-overlay').style.display = 'none';

  render();
  if (document.getElementById('tab-calendario').classList.contains('active')) renderCalendar();
  showToast('Matéria adicionada!');
});

document.getElementById('grid').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]'); if (!btn) return;
  const card = e.target.closest('.card'); const id = card.getAttribute('data-id'); const action = btn.getAttribute('data-action');
  const subject = subjects.find(s => s.id === id); if (!subject) return;

  if (action === 'presente' || action === 'falta') {
    subject.log.push({ date: new Date().toISOString(), status: action });
    showToast(action === 'presente' ? 'Presença registrada' : 'Falta registrada');
  } else if (action === 'undo') {
    subject.log.pop();
    showToast('Último registro desfeito');
  } else if (action === 'toggle-log') {
    if (expandedIds.has(id)) expandedIds.delete(id); else expandedIds.add(id);
  }
  saveSubjects(subjects);
  render();
});

// Menus
const btnMenu = document.getElementById('btn-menu'); const dropdown = document.getElementById('dropdown');
btnMenu.addEventListener('click', (e) => { e.stopPropagation(); dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none'; });
document.addEventListener('click', () => { dropdown.style.display = 'none'; });

// Modal: Gerenciar Matérias
const modalOverlay = document.getElementById('modal-overlay');
const manageList = document.getElementById('manage-list');

function renderManageList() {
  if (subjects.length === 0) { manageList.innerHTML = '<div class="manage-empty">Nenhuma matéria cadastrada.</div>'; return; }
  manageList.innerHTML = subjects.map(s => `
    <div style="border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 12px;">
      <div class="manage-row" style="border:none; padding:0;" data-id="${s.id}">
        <div class="manage-row-info"><span>${escapeHTML(s.name)}</span><small>${s.totalClasses} aulas &middot; Limite ${s.limitPercent}%</small></div>
        <div class="manage-actions"><button class="btn-edit" data-action="edit-subject">Editar</button><button class="btn-delete" data-action="delete-subject">Excluir</button></div>
      </div>
      <div class="edit-form" id="edit-form-${s.id}">
        <input type="text" id="edit-name-${s.id}" value="${escapeHTML(s.name)}" placeholder="Nome">
        <div style="display:flex; gap:8px;"><input type="number" id="edit-total-${s.id}" value="${s.totalClasses}" placeholder="Aulas" style="flex:1;"><input type="number" id="edit-limit-${s.id}" value="${s.limitPercent}" placeholder="Limite %" style="width:80px;"></div>
        <div class="edit-actions"><button class="btn-cancel" data-action="cancel-edit">Cancelar</button><button class="btn-save" data-action="save-edit">Salvar</button></div>
      </div>
    </div>`).join('');
}

document.getElementById('btn-open-materias').addEventListener('click', (e) => { e.stopPropagation(); dropdown.style.display = 'none'; renderManageList(); modalOverlay.style.display = 'flex'; });
document.getElementById('btn-close-modal').addEventListener('click', () => modalOverlay.style.display = 'none');
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) modalOverlay.style.display = 'none'; });

manageList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]'); if (!btn) return;
  const id = e.target.closest('.manage-row') ? e.target.closest('.manage-row').getAttribute('data-id') : e.target.closest('.edit-form').id.replace('edit-form-', '');
  const subject = subjects.find(s => s.id === id); if (!subject) return;
  const action = btn.getAttribute('data-action');

  if (action === 'delete-subject') {
    if (!btn.classList.contains('confirming')) {
      btn.classList.add('confirming'); btn.textContent = 'Certeza?'; btn.style.background = 'var(--danger)'; btn.style.color = '#FFF';
      setTimeout(() => { if (btn && btn.parentNode) { btn.classList.remove('confirming'); btn.textContent = 'Excluir'; btn.style.background = 'var(--danger-light)'; btn.style.color = 'var(--danger)'; } }, 3000);
      return;
    }
    subjects = subjects.filter(s => s.id !== id);
    saveSubjects(subjects);
    renderManageList(); render();
    if (document.getElementById('tab-calendario').classList.contains('active')) renderCalendar();
    showToast('Matéria excluída');
  } 
  else if (action === 'edit-subject') { document.getElementById(`edit-form-${id}`).classList.add('active'); }
  else if (action === 'cancel-edit') { document.getElementById(`edit-form-${id}`).classList.remove('active'); }
  else if (action === 'save-edit') {
    const newName = document.getElementById(`edit-name-${id}`).value.trim(); const newTotal = Number(document.getElementById(`edit-total-${id}`).value); const newLimit = Number(document.getElementById(`edit-limit-${id}`).value);
    if (newName && newTotal > 0) {
      subject.name = newName; subject.totalClasses = newTotal; subject.limitPercent = newLimit || 25;
      saveSubjects(subjects);
      renderManageList(); render();
      if (document.getElementById('tab-calendario').classList.contains('active')) renderCalendar();
      showToast('Matéria atualizada!');
    }
  }
});

// Modal: Adicionar Matéria
const modalAddOverlay = document.getElementById('modal-add-overlay');
document.getElementById('btn-open-add').addEventListener('click', (e) => {
  e.stopPropagation(); dropdown.style.display = 'none'; modalAddOverlay.style.display = 'flex';
});
document.getElementById('btn-close-add-modal').addEventListener('click', () => { modalAddOverlay.style.display = 'none'; });
modalAddOverlay.addEventListener('click', (e) => { if (e.target === modalAddOverlay) modalAddOverlay.style.display = 'none'; });

// Backup Export/Import
document.getElementById('btn-export').addEventListener('click', () => {
  dropdown.style.display = 'none';
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(subjects));
  const a = document.createElement('a'); a.setAttribute("href", dataStr); a.setAttribute("download", "backup_presencas.json"); document.body.appendChild(a); a.click(); a.remove();
  showToast('Backup exportado!');
});

const btnImport = document.getElementById('btn-import'); const fileImport = document.getElementById('file-import');
btnImport.addEventListener('click', (e) => { e.stopPropagation(); dropdown.style.display = 'none'; fileImport.click(); });
fileImport.addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const imported = JSON.parse(evt.target.result);
      if (Array.isArray(imported)) {
        subjects = imported;
        saveSubjects(subjects); 
        render();
        if (document.getElementById('tab-calendario').classList.contains('active')) renderCalendar();
        showToast('Backup restaurado com sucesso!');
      } else { showToast('Formato inválido', 'error'); }
    } catch(err) { showToast('Erro ao ler o arquivo', 'error'); }
    fileImport.value = '';
  };
  reader.readAsText(file);
});
