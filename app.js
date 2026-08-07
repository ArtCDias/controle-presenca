
const STORAGE_KEY = 'controle-presenca-subjects-v2';

// State
let subjects = loadSubjects();
let expandedIds = new Set();
let currentFilter = 'all'; 

// PWA Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.log('SW registration failed: ', err));
  });
}

// Theme Handling
const themeBtn = document.getElementById('btn-theme');
const storedTheme = localStorage.getItem('theme');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

if (storedTheme === 'dark' || (!storedTheme && prefersDark)) {
  document.body.classList.add('dark-theme');
  themeBtn.textContent = '☀️';
}

themeBtn.addEventListener('click', () => {
  const isDark = document.body.classList.toggle('dark-theme');
  document.body.classList.toggle('light-theme', !isDark); // Override media query
  themeBtn.textContent = isDark ? '☀️' : '🌙';
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
});

// Toast Notifications
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  
  // Trigger reflow to animate
  void toast.offsetWidth;
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// Data Management
function loadSubjects() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('controle-presenca-subjects-v1');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveSubjects(subs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(subs));
  } catch (e) {
    document.getElementById('error').textContent = 'Armazenamento indisponível.';
  }
}

function uid() { return Math.random().toString(36).slice(2, 10); }

// Math & Rendering
function computeStats(s) {
  const total = Math.max(0, Number(s.totalClasses) || 0);
  const limitPct = Math.max(1, Math.min(100, Number(s.limitPercent) || 25));
  const faltas = s.log.filter(e => e.status === 'falta').length;
  const dadas = s.log.length;
  const limiteFaltas = Math.floor((total * limitPct) / 100);
  const restantes = limiteFaltas - faltas;
  const pctAusencia = total > 0 ? (faltas / total) * 100 : 0;
  const pctDoLimite = limiteFaltas > 0 ? (faltas / limiteFaltas) * 100 : (faltas > 0 ? 100 : 0);
  
  let nivel = 'seguro';
  let statusLabel = 'Regular';
  if (limiteFaltas > 0) {
    const razao = faltas / limiteFaltas;
    if (razao >= 1) { nivel = 'reprovado'; statusLabel = 'Reprovado por falta'; }
    else if (razao >= 0.75) { nivel = 'perigo'; statusLabel = 'Perigo'; }
    else if (razao >= 0.4) { nivel = 'atencao'; statusLabel = 'Atenção'; }
  } else if (faltas > 0) {
    nivel = 'reprovado'; statusLabel = 'Reprovado por falta';
  }
  return { total, limitPct, faltas, dadas, limiteFaltas, restantes, pctAusencia, pctDoLimite, nivel, statusLabel };
}

const NIVEL_COLOR_VAR = {
  seguro: 'var(--success)',
  atencao: 'var(--warning)',
  perigo: 'var(--danger)',
  reprovado: 'var(--danger)',
};

function ringSVG(pct, colorVar) {
  const r = 24, c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const offset = c - (clamped / 100) * c;
  return `
    <svg width="56" height="56" viewBox="0 0 56 56">
      <circle cx="28" cy="28" r="${r}" fill="none" stroke="var(--border)" stroke-width="5"/>
      <circle cx="28" cy="28" r="${r}" fill="none" stroke="${colorVar}" stroke-width="5"
        stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${offset}"
        style="transition: stroke-dashoffset 0.4s ease"/>
    </svg>
  `;
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
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
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
    const restanteTxt = stats.limiteFaltas > 0
      ? (stats.restantes >= 0 ? `pode faltar mais <b>${stats.restantes}</b>` : `<b style="color:var(--danger)">excedeu em ${Math.abs(stats.restantes)}</b>`)
      : '';
      
    return `
      <div class="card card-surface" data-id="${s.id}">
        <div class="card-top">
          <div class="ring-wrap">
            ${ringSVG(stats.pctDoLimite, colorVar)}
            <div class="ring-pct" style="color:${colorVar}">${Math.round(stats.pctDoLimite)}%</div>
          </div>
          <div>
            <h3>${escapeHTML(s.name)}</h3>
            <div class="subline">${stats.dadas} de ${stats.total} aulas</div>
          </div>
        </div>
        <span class="badge ${stats.nivel}">${stats.statusLabel}</span>
        <div class="stats-row">
          <span><b>${stats.faltas}</b> falta${stats.faltas === 1 ? '' : 's'}</span>
          <span><b>${stats.pctAusencia.toFixed(1)}%</b> ausência</span>
          <span>${restanteTxt}</span>
        </div>
        ${s.log.length > 0 ? `
        <div class="legend">
          <span><i class="dot-presenca"></i>presença</span>
          <span><i class="dot-falta"></i>falta</span>
        </div>
        <div class="log-row">${logDots(s.log)}</div>
        <button class="btn-toggle-log" data-action="toggle-log">${expandedIds.has(s.id) ? 'Ocultar datas' : 'Ver datas'}</button>
        ${expandedIds.has(s.id) ? logList(s.log) : ''}
        ` : `<div class="log-empty" style="margin-bottom:14px;">nenhuma aula registrada ainda</div>`}
        <div class="actions">
          <button class="btn-presenca" data-action="presente">+ Presença</button>
          <button class="btn-falta" data-action="falta">+ Falta</button>
          <button class="btn-undo" data-action="undo" ${s.log.length === 0 ? 'disabled' : ''} aria-label="Desfazer">&#8634;</button>
        </div>
      </div>
    `;
  }).join('');
}

// Add form
document.getElementById('btn-add').addEventListener('click', () => {
  const nameEl = document.getElementById('in-name');
  const totalEl = document.getElementById('in-total');
  const limitEl = document.getElementById('in-limit');
  const errEl = document.getElementById('error');

  const name = nameEl.value.trim();
  const total = Number(totalEl.value);
  const limit = Number(limitEl.value) || 25;

  if (!name) { errEl.textContent = 'Dê um nome para a matéria.'; return; }
  if (!total || total <= 0) { errEl.textContent = 'Informe o número total de aulas previstas.'; return; }

  errEl.textContent = '';
  subjects.push({ id: uid(), name, totalClasses: total, limitPercent: limit, log: [] });
  saveSubjects(subjects);
  
  nameEl.value = ''; totalEl.value = ''; limitEl.value = '25';
  render();
  showToast('Matéria adicionada!');
});

// Card actions
document.getElementById('grid').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const card = e.target.closest('.card');
  const id = card.getAttribute('data-id');
  const action = btn.getAttribute('data-action');
  const subject = subjects.find(s => s.id === id);
  if (!subject) return;

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

// Menus & Modal
const btnMenu = document.getElementById('btn-menu');
const dropdown = document.getElementById('dropdown');
const modalOverlay = document.getElementById('modal-overlay');
const manageList = document.getElementById('manage-list');

btnMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
});
document.addEventListener('click', () => { dropdown.style.display = 'none'; });

function renderManageList() {
  if (subjects.length === 0) {
    manageList.innerHTML = '<div class="manage-empty">Nenhuma matéria cadastrada.</div>';
    return;
  }
  manageList.innerHTML = subjects.map(s => `
    <div style="border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 12px;">
      <div class="manage-row" style="border:none; padding:0;" data-id="${s.id}">
        <div class="manage-row-info">
          <span>${escapeHTML(s.name)}</span>
          <small>${s.totalClasses} aulas &middot; Limite ${s.limitPercent}%</small>
        </div>
        <div class="manage-actions">
          <button class="btn-edit" data-action="edit-subject">Editar</button>
          <button class="btn-delete" data-action="delete-subject">Excluir</button>
        </div>
      </div>
      <div class="edit-form" id="edit-form-${s.id}">
        <input type="text" id="edit-name-${s.id}" value="${escapeHTML(s.name)}" placeholder="Nome">
        <div style="display:flex; gap:8px;">
          <input type="number" id="edit-total-${s.id}" value="${s.totalClasses}" placeholder="Aulas" style="flex:1;">
          <input type="number" id="edit-limit-${s.id}" value="${s.limitPercent}" placeholder="Limite %" style="width:80px;">
        </div>
        <div class="edit-actions">
          <button class="btn-cancel" data-action="cancel-edit">Cancelar</button>
          <button class="btn-save" data-action="save-edit">Salvar</button>
        </div>
      </div>
    </div>
  `).join('');
}

document.getElementById('btn-open-materias').addEventListener('click', (e) => {
  e.stopPropagation();
  dropdown.style.display = 'none';
  renderManageList();
  modalOverlay.style.display = 'flex';
});

document.getElementById('btn-close-modal').addEventListener('click', () => modalOverlay.style.display = 'none');
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) modalOverlay.style.display = 'none'; });

// Manage List Actions (Edit & Delete)
manageList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = e.target.closest('.manage-row') ? e.target.closest('.manage-row').getAttribute('data-id') : e.target.closest('.edit-form').id.replace('edit-form-', '');
  const subject = subjects.find(s => s.id === id);
  if (!subject) return;

  const action = btn.getAttribute('data-action');

  if (action === 'delete-subject') {
    if (!btn.classList.contains('confirming')) {
      btn.classList.add('confirming');
      btn.textContent = 'Certeza?';
      btn.style.background = 'var(--danger)';
      btn.style.color = '#FFF';
      setTimeout(() => {
        if (btn && btn.parentNode) {
          btn.classList.remove('confirming');
          btn.textContent = 'Excluir';
          btn.style.background = 'var(--danger-light)';
          btn.style.color = 'var(--danger)';
        }
      }, 3000);
      return;
    }
    subjects = subjects.filter(s => s.id !== id);
    saveSubjects(subjects);
    renderManageList();
    render();
    showToast('Matéria excluída');
  } 
  else if (action === 'edit-subject') {
    document.getElementById(`edit-form-${id}`).classList.add('active');
  }
  else if (action === 'cancel-edit') {
    document.getElementById(`edit-form-${id}`).classList.remove('active');
  }
  else if (action === 'save-edit') {
    const newName = document.getElementById(`edit-name-${id}`).value.trim();
    const newTotal = Number(document.getElementById(`edit-total-${id}`).value);
    const newLimit = Number(document.getElementById(`edit-limit-${id}`).value);
    
    if (newName && newTotal > 0) {
      subject.name = newName;
      subject.totalClasses = newTotal;
      subject.limitPercent = newLimit || 25;
      saveSubjects(subjects);
      renderManageList();
      render();
      showToast('Matéria atualizada!');
    }
  }
});

// Backup: Export
document.getElementById('btn-export').addEventListener('click', () => {
  dropdown.style.display = 'none';
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(subjects));
  const a = document.createElement('a');
  a.setAttribute("href", dataStr);
  a.setAttribute("download", "backup_presencas.json");
  document.body.appendChild(a);
  a.click();
  a.remove();
  showToast('Backup exportado!');
});

// Backup: Import
const btnImport = document.getElementById('btn-import');
const fileImport = document.getElementById('file-import');

btnImport.addEventListener('click', (e) => {
  e.stopPropagation();
  dropdown.style.display = 'none';
  fileImport.click();
});

fileImport.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const imported = JSON.parse(evt.target.result);
      if (Array.isArray(imported)) {
        subjects = imported;
        saveSubjects(subjects);
        render();
        showToast('Backup restaurado com sucesso!');
      } else {
        showToast('Formato de arquivo inválido', 'error');
      }
    } catch(err) {
      showToast('Erro ao ler o arquivo', 'error');
    }
    // reset input
    fileImport.value = '';
  };
  reader.readAsText(file);
});

render();
