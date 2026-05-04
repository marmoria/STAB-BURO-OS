'use strict';

// ─── CONFIG ───────────────────────────────────────────────────
const SB_URL = 'https://pjrvjlpjyfvlkobzkhtp.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqcnZqbHBqeWZ2bGtvYnpraHRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MjQ2NzksImV4cCI6MjA4OTAwMDY3OX0.hGPjFpMQ7n_xh-XE9qIINFpSPiOrK-zgYn_qY5TPDnY';

// ─── RUSSIAN PRODUCTION CALENDAR 2026 ─────────────────────────
const RU_HOLIDAYS_2026 = new Set([
  '2026-01-01','2026-01-02','2026-01-03','2026-01-04','2026-01-05',
  '2026-01-06','2026-01-07','2026-01-08','2026-01-09',
  '2026-02-23','2026-02-24',
  '2026-03-06','2026-03-09',
  '2026-05-01','2026-05-04','2026-05-05','2026-05-11',
  '2026-06-12',
  '2026-11-04',
  '2026-12-31',
]);

// ─── SECTION LABELS ───────────────────────────────────────────
const SECTION_LABELS = {
  projects:  '🏗 Проекты',
  bureau:    '🏢 Бюро',
  marketing: '📣 Маркетинг',
  finance:   '💰 Финансы',
  partners:  '👥 Смежники',
  growth:    '📈 Развитие',
};

const TYPE_LABELS = {
  task:     'Задача',
  meeting:  'Встреча',
  call:     'Звонок',
  trip:     'Поездка',
  deadline: 'Дедлайн',
  payment:  'Оплата',
};

const TYPE_COLORS = {
  task:     '#3d3d3a',
  meeting:  '#534AB7',
  call:     '#1D9E75',
  trip:     '#185FA5',
  deadline: '#a84332',
  payment:  '#BA7517',
};

// ─── STATE ────────────────────────────────────────────────────
let SB = null;
let currentUser = null;
let currentProfile = null;
let profiles = {};

let state = {
  tasks: [],
  subtasks: {},   // taskId → []
  projects: [],
  filter: { date: 'today', section: 'all' },
  calMonth: new Date().getMonth(),
  calYear: new Date().getFullYear(),
  editingTaskId: null,
  formSubtasks: [],  // подзадачи в форме
};

// ─── INIT ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  try {
    SB = supabase.createClient(SB_URL, SB_KEY, {
    auth: {
      storage: window.localStorage,
      storageKey: 'bb-auth',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      lock: async (name, acquireTimeout, fn) => fn(),
    }
  });
  } catch (e) {
    showToast('Ошибка подключения к базе данных', 'error');
  }
  initAuth();
  initNav();
  initModal();
});

// ─── AUTH ──────────────────────────────────────────────────────
let authMode = 'login'; // 'login' | 'register'

function initAuth() {
  SB.auth.onAuthStateChange(async (event, session) => {
    if (session) {
      currentUser = session.user;
      await loadProfile();
      showApp();
    } else {
      currentUser = null;
      showAuthScreen();
    }
  });

  document.getElementById('auth-submit').addEventListener('click', doAuth);
  document.getElementById('auth-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') doAuth();
  });
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await SB.auth.signOut();
  });

  // Tabs
  document.getElementById('tab-login').addEventListener('click', () => setAuthMode('login'));
  document.getElementById('tab-register').addEventListener('click', () => setAuthMode('register'));
}

function setAuthMode(mode) {
  authMode = mode;
  document.getElementById('tab-login').classList.toggle('active', mode === 'login');
  document.getElementById('tab-register').classList.toggle('active', mode === 'register');
  document.getElementById('field-name-wrap').style.display = mode === 'register' ? '' : 'none';
  document.getElementById('auth-btn-text').textContent = mode === 'login' ? 'Войти' : 'Зарегистрироваться';
  document.getElementById('auth-error').classList.add('hidden');
}

async function doAuth() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const name = document.getElementById('auth-name')?.value.trim();
  const errEl = document.getElementById('auth-error');
  const btnText = document.getElementById('auth-btn-text');
  const btnSpin = document.getElementById('auth-btn-spin');
  const btn = document.getElementById('auth-submit');

  if (!email || !password) {
    errEl.textContent = 'Введите email и пароль';
    errEl.classList.remove('hidden');
    return;
  }
  if (authMode === 'register' && !name) {
    errEl.textContent = 'Введите ваше имя';
    errEl.classList.remove('hidden');
    return;
  }

  errEl.classList.add('hidden');
  btnText.textContent = authMode === 'login' ? 'Вхожу...' : 'Регистрирую...';
  btnSpin.classList.remove('hidden');
  btn.disabled = true;

  if (authMode === 'login') {
    const { error } = await SB.auth.signInWithPassword({ email, password });
    if (error) {
      errEl.textContent = 'Неверный email или пароль';
      errEl.classList.remove('hidden');
    }
  } else {
    const { data, error } = await SB.auth.signUp({ email, password });
    if (error) {
      errEl.textContent = error.message || 'Ошибка регистрации';
      errEl.classList.remove('hidden');
    } else if (data.user) {
      // Создаём профиль
      const initials = name ? name.slice(0,2).toUpperCase() : email.slice(0,2).toUpperCase();
      await SB.from('profiles').upsert({
        id: data.user.id,
        name: name || email.split('@')[0],
        avatar_initials: initials,
        color: '#a84332',
      });
      showToast('Аккаунт создан. Проверьте email для подтверждения.', 'success');
      setAuthMode('login');
    }
  }

  btnText.textContent = authMode === 'login' ? 'Войти' : 'Зарегистрироваться';
  btnSpin.classList.add('hidden');
  btn.disabled = false;
}

async function loadProfile() {
  // Загружаем свой профиль
  const { data } = await SB.from('profiles').select('*').eq('id', currentUser.id).single();
  if (data) {
    currentProfile = data;
  } else {
    // Создаём профиль если нет
    const initials = (currentUser.email || 'U').charAt(0).toUpperCase();
    const name = currentUser.email.split('@')[0];
    const { data: created } = await SB.from('profiles').insert({
      id: currentUser.id,
      name: name.charAt(0).toUpperCase() + name.slice(1),
      avatar_initials: initials,
    }).select().single();
    currentProfile = created;
  }

  // Загружаем все профили для отображения аватаров
  const { data: allProfiles } = await SB.from('profiles').select('*');
  if (allProfiles) {
    allProfiles.forEach(p => { profiles[p.id] = p; });
  }

  // Обновляем UI
  document.getElementById('user-avatar').textContent = currentProfile?.avatar_initials || '?';
  document.getElementById('user-name').textContent = currentProfile?.name || 'Пользователь';
}

function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

async function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  await Promise.all([loadTasks(), loadProjects()]);
  initCalendar();
  renderTodayHeader();
  renderTasks();
}

// ─── NAV ──────────────────────────────────────────────────────
function initNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      const page = item.dataset.page;
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById('page-' + page)?.classList.add('active');
    });
  });

  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
  });
}

// ─── LOAD DATA ────────────────────────────────────────────────
async function loadTasks() {
  const { data, error } = await SB.from('bb_tasks')
    .select('*')
    .order('date_due', { ascending: true, nullsFirst: false });

  if (error) { showToast('Ошибка загрузки задач', 'error'); return; }
  state.tasks = data || [];

  // Загружаем подзадачи
  const ids = state.tasks.map(t => t.id);
  if (ids.length) {
    const { data: subs } = await SB.from('bb_subtasks')
      .select('*')
      .in('task_id', ids)
      .order('order_num');
    if (subs) {
      state.subtasks = {};
      subs.forEach(s => {
        if (!state.subtasks[s.task_id]) state.subtasks[s.task_id] = [];
        state.subtasks[s.task_id].push(s);
      });
    }
  }
}

async function loadProjects() {
  const { data } = await SB.from('projects').select('id, name, color').eq('status', 'active').order('name');
  state.projects = data || [];
}

// ─── CALENDAR ─────────────────────────────────────────────────
function initCalendar() {
  renderCalendar();
  // Date shortcuts
  document.querySelectorAll('.ds-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ds-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filter.date = btn.dataset.filter;
      renderTodayHeader();
      renderTasks();
    });
  });
  // Section tags
  document.querySelectorAll('.tag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filter.section = btn.dataset.section;
      renderTasks();
    });
  });
}

function renderCalendar() {
  const cal = document.getElementById('mini-cal');
  const y = state.calYear, m = state.calMonth;
  const today = todayStr();
  const firstDay = new Date(y, m, 1);
  const lastDay = new Date(y, m + 1, 0);
  const startDow = (firstDay.getDay() + 6) % 7; // 0=Mon

  // Task dates set for dots
  const taskDates = new Set(state.tasks
    .filter(t => t.date_due)
    .map(t => t.date_due.slice(0, 10)));

  const MNAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь',
    'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const DOWS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

  let html = `
    <div class="mc-header">
      <button class="mc-nav" id="mc-prev">‹</button>
      <div class="mc-title">${MNAMES[m]} ${y}</div>
      <button class="mc-nav" id="mc-next">›</button>
    </div>
    <div class="mc-grid">
      ${DOWS.map(d => `<div class="mc-dow">${d}</div>`).join('')}
  `;

  // Empty cells before month start
  for (let i = 0; i < startDow; i++) {
    const d = new Date(y, m, -startDow + i + 1);
    html += `<div class="mc-day other-month">${d.getDate()}</div>`;
  }

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const ds = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dow = new Date(y, m, d).getDay(); // 0=Sun
    const isWeekend = dow === 0 || dow === 6;
    const isHoliday = RU_HOLIDAYS_2026.has(ds);
    const isToday = ds === today;
    const hasTasks = taskDates.has(ds);

    let cls = 'mc-day';
    if (isToday) cls += ' today';
    if (isWeekend) cls += ' weekend';
    if (isHoliday) cls += ' holiday';
    if (hasTasks) cls += ' has-tasks';

    html += `<div class="${cls}" data-date="${ds}">${d}</div>`;
  }

  html += `</div>`;
  cal.innerHTML = html;

  // Events
  document.getElementById('mc-prev').addEventListener('click', e => {
    e.stopPropagation();
    state.calMonth--;
    if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
    renderCalendar();
  });
  document.getElementById('mc-next').addEventListener('click', e => {
    e.stopPropagation();
    state.calMonth++;
    if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
    renderCalendar();
  });
  cal.querySelectorAll('.mc-day[data-date]').forEach(el => {
    el.addEventListener('click', () => {
      const ds = el.dataset.date;
      // переключаем на выбранную дату
      document.querySelectorAll('.ds-btn').forEach(b => b.classList.remove('active'));
      state.filter.date = ds; // конкретная дата
      renderTodayHeader();
      renderTasks();
    });
  });
}

// ─── TODAY HEADER ─────────────────────────────────────────────
function renderTodayHeader() {
  const td = todayStr();
  const MNAMES = ['января','февраля','марта','апреля','мая','июня',
    'июля','августа','сентября','октября','ноября','декабря'];
  const MONTHS_SHORT = ['ЯНВ','ФЕВ','МАР','АПР','МАЙ','ИЮН','ИЮЛ','АВГ','СЕН','ОКТ','НОЯ','ДЕК'];
  const DAYS = ['ВОСКРЕСЕНЬЕ','ПОНЕДЕЛЬНИК','ВТОРНИК','СРЕДА','ЧЕТВЕРГ','ПЯТНИЦА','СУББОТА'];
  const wrap = document.getElementById('today-date-big');

  let d, dayName, dateNum, dateYear, dateMon;
  if (state.filter.date === 'today') {
    d = new Date();
    dayName = DAYS[d.getDay()];
    dateNum = String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0');
    dateYear = '.' + String(d.getFullYear()).slice(2);
  } else if (state.filter.date === 'tomorrow') {
    d = new Date(); d.setDate(d.getDate()+1);
    dayName = 'ЗАВТРА';
    dateNum = String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0');
    dateYear = '.' + String(d.getFullYear()).slice(2);
  } else if (state.filter.date === 'nodate') {
    wrap.innerHTML = `<div class="today-day-name">ФИЛЬТР</div><div class="today-date-num">БЕЗ ДАТЫ</div>`;
    return;
  } else {
    d = new Date(state.filter.date + 'T00:00:00');
    dayName = DAYS[d.getDay()];
    dateNum = String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0');
    dateYear = '.' + String(d.getFullYear()).slice(2);
  }

  wrap.innerHTML = `
    <div class="today-day-name">${dayName}</div>
    <div class="today-date-num">${dateNum}<span class="today-date-year">${dateYear}</span></div>
  `;
}

// ─── TASKS RENDER ─────────────────────────────────────────────
function getFilteredTasks() {
  const td = todayStr();
  let tasks = state.tasks;

  // Скрываем личные задачи других пользователей
  tasks = tasks.filter(t => {
    if (t.is_personal && t.created_by !== currentUser?.id) return false;
    return true;
  });

  // Фильтр по дате
  if (state.filter.date === 'today') {
    tasks = tasks.filter(t => t.date_due === td || (!t.date_due && t.type === 'task'));
    // Для "сегодня" показываем и регулярные
  } else if (state.filter.date === 'tomorrow') {
    const tom = addDays(td, 1);
    tasks = tasks.filter(t => t.date_due === tom);
  } else if (state.filter.date === 'nodate') {
    tasks = tasks.filter(t => !t.date_due);
  } else {
    // конкретная дата
    tasks = tasks.filter(t => t.date_due === state.filter.date);
  }

  // Фильтр по разделу
  if (state.filter.section !== 'all') {
    tasks = tasks.filter(t => t.section === state.filter.section);
  }

  return tasks;
}

function renderTasks() {
  const tasks = getFilteredTasks();
  const groups = document.getElementById('task-groups');
  const empty = document.getElementById('empty-state');

  // Stats
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;
  const pct = total ? Math.round(done / total * 100) : 0;
  const statsEl = document.getElementById('today-stats');
  if (statsEl) statsEl.innerHTML = `
    <div class="ts-block">
      <div class="ts-label">Всего на день</div>
      <div class="ts-num">${total}</div>
    </div>
    <div class="ts-block">
      <div class="ts-label">Выполнено</div>
      <div class="ts-num">${done}<span class="ts-num-sub">/${total}</span></div>
    </div>
    <div class="ts-block">
      <div class="ts-label">Прогресс</div>
      <div class="ts-progress-wrap">
        <div class="ts-progress-bar"><div class="ts-progress-fill" id="ts-progress-fill" style="width:${pct}%"></div></div>
        <div class="ts-pct">${pct}%</div>
      </div>
    </div>
  `;

  if (!total) {
    empty.classList.remove('hidden');
    groups.innerHTML = '';
    groups.appendChild(empty);
    return;
  }
  empty.classList.add('hidden');

  // Группируем по типу: сначала встречи/звонки/поездки (с временем), потом задачи
  const timed = tasks.filter(t => ['meeting','call','trip'].includes(t.type) && t.time_start);
  const deadlines = tasks.filter(t => ['deadline','payment'].includes(t.type));
  const regular = tasks.filter(t => !['meeting','call','trip','deadline','payment'].includes(t.type) || (['meeting','call','trip'].includes(t.type) && !t.time_start));

  let html = '';

  if (timed.length) {
    timed.sort((a,b) => (a.time_start||'') < (b.time_start||'') ? -1 : 1);
    html += `<div class="task-group"><div class="task-group-title">По времени</div>`;
    timed.forEach(t => { html += buildTaskCard(t); });
    html += `</div>`;
  }
  if (deadlines.length) {
    html += `<div class="task-group"><div class="task-group-title">Дедлайны и оплаты</div>`;
    deadlines.forEach(t => { html += buildTaskCard(t); });
    html += `</div>`;
  }
  if (regular.length) {
    // Разбиваем по разделам
    const sections = [...new Set(regular.map(t => t.section))];
    sections.forEach(sec => {
      const secTasks = regular.filter(t => t.section === sec);
      html += `<div class="task-group"><div class="task-group-title">${SECTION_LABELS[sec] || sec}</div>`;
      secTasks.forEach(t => { html += buildTaskCard(t); });
      html += `</div>`;
    });
  }

  groups.innerHTML = html;

  // Events
  groups.querySelectorAll('.task-card').forEach(card => {
    const id = parseInt(card.dataset.id);
    card.addEventListener('click', e => {
      if (e.target.closest('.task-check') || e.target.closest('.subtask-check') || e.target.closest('.btn-gantt')) return;
      openTaskModal(id);
    });
  });
  groups.querySelectorAll('.task-check').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      toggleTask(parseInt(el.dataset.id));
    });
  });
  groups.querySelectorAll('.subtask-check').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      toggleSubtask(parseInt(el.dataset.id), el.dataset.taskId);
    });
  });
}

function buildTaskCard(task) {
  const subs = state.subtasks[task.id] || [];
  const subDone = subs.filter(s => s.done).length;
  const subPct = subs.length ? Math.round(subDone / subs.length * 100) : null;
  const isDone = task.status === 'done';
  const today = todayStr();
  const isOverdue = task.date_due && task.date_due < today && !isDone;

  const typeColor = TYPE_COLORS[task.type] || '#3d3d3a';
  const secBadge = `<span class="task-badge sec-badge-${task.section}">${SECTION_LABELS[task.section] || task.section}</span>`;
  const typeBadge = task.type !== 'task'
    ? `<span class="task-badge" style="background:${typeColor}18;color:${typeColor}">${TYPE_LABELS[task.type]}</span>`
    : '';

  // Time
  let timeStr = '';
  if (task.time_start) {
    timeStr = `<span class="task-time">${task.time_start.slice(0,5)}`;
    if (task.time_end) timeStr += `–${task.time_end.slice(0,5)}`;
    timeStr += `</span>`;
  }
  if (task.travel_time) {
    timeStr += `<span class="task-travel">+${task.travel_time} мин в дороге</span>`;
  }

  // Author
  const author = profiles[task.created_by];
  const authorHtml = author
    ? `<div class="task-author" style="background:${author.color||'#a84332'}22;color:${author.color||'#a84332'}">${author.avatar_initials || '?'}</div>`
    : '';

  // Assignee (if different from author)
  const assignee = task.assigned_to && task.assigned_to !== task.created_by ? profiles[task.assigned_to] : null;
  const assigneeHtml = assignee
    ? `<div class="task-author" style="background:${assignee.color||'#534AB7'}22;color:${assignee.color||'#534AB7'}">${assignee.avatar_initials || '?'}</div>`
    : '';

  // Priority
  const prioHtml = `<div class="task-prio prio-${task.priority}">${task.priority}</div>`;

  // Date
  let dateHtml = '';
  if (task.date_due && state.filter.date !== 'today' && state.filter.date !== task.date_due) {
    const d = new Date(task.date_due + 'T00:00:00');
    const MNAMES = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
    dateHtml = `<span class="task-date-badge ${isOverdue ? 'overdue' : ''}">${isOverdue ? '⚠ ' : ''}${d.getDate()} ${MNAMES[d.getMonth()]}</span>`;
  }

  // Subtasks
  let subsHtml = '';
  if (subs.length) {
    const visibleSubs = isDone ? [] : subs; // если задача выполнена — не показываем подзадачи
    if (visibleSubs.length) {
      subsHtml = `<div class="task-subtasks">`;
      visibleSubs.forEach(s => {
        subsHtml += `
          <div class="subtask-row">
            <div class="subtask-check ${s.done ? 'checked' : ''}" data-id="${s.id}" data-task-id="${task.id}">
              ${s.done ? '✓' : ''}
            </div>
            <span class="subtask-title ${s.done ? 'done' : ''}">${escHtml(s.title)}</span>
          </div>`;
      });
      subsHtml += `</div>`;
    }
    if (!isDone && subPct !== null) {
      subsHtml += `<div class="task-progress-bar"><div class="task-progress-fill" style="width:${subPct}%"></div></div>`;
    }
  }

  // Blueprint style: dots for priority, triangles for urgency
  const prioDots = [1,2,3].map(i =>
    `<div class="prio-dot ${i <= (task.priority||2) ? 'filled' : ''}"></div>`).join('');
  const urgTris = [1,2,3].map(i =>
    `<div class="urg-tri ${i <= (task.urgency||2) ? 'filled' : ''}"></div>`).join('');

  const ctxLabel = {
    task:'ЗАДАЧ', meeting:'ВСТР', call:'ЗВНК', trip:'ПОЕЗД',
    deadline:'ДЕДЛ', payment:'ОПЛТ'
  }[task.type] || 'ЗАДАЧ';

  const secColor = {
    projects:'var(--c-projects)', bureau:'var(--c-bureau)',
    marketing:'var(--c-marketing)', finance:'var(--c-finance)',
    partners:'var(--c-partners)', growth:'var(--c-growth)'
  }[task.section] || 'var(--c-bureau)';

  return `
    <div class="task-card ${isDone ? 'done' : ''}" data-id="${task.id}">
      <div class="task-author-dot">
        <div class="task-avatar" style="background:${secColor}18;color:${secColor}">
          ${author ? author.avatar_initials : '?'}
        </div>
      </div>
      <div class="task-body">
        <div class="task-title-row">
          <span class="task-ctx">${ctxLabel}</span>
          <span class="task-title">${task.is_personal && task.created_by !== currentUser?.id ? '[ЗАНЯТ]' : escHtml(task.title)}</span>
          ${task.time_start ? `<span class="task-time">${task.time_start.slice(0,5)}${task.time_end ? '–'+task.time_end.slice(0,5) : ''}</span>` : ''}
        </div>
        <div class="task-meta-row">
          ${task.travel_time ? `<span class="task-travel">+${task.travel_time} мин дорога</span>` : ''}
          ${task.date_due && state.filter.date !== 'today' && state.filter.date !== task.date_due
            ? `<span class="task-date-badge ${task.date_due < todayStr() && !isDone ? 'overdue' : ''}">${task.date_due < todayStr() && !isDone ? '⚠ ' : ''}${fmtDateShort(task.date_due)}</span>`
            : ''}
        </div>
        ${subsHtml}
      </div>
      <div class="task-right">
        <div class="prio-dots">${prioDots}</div>
        <div class="urg-tris">${urgTris}</div>
        <div class="task-check ${isDone ? 'checked' : ''}" data-id="${task.id}" onclick="event.stopPropagation()">${isDone ? '✓' : ''}</div>
      </div>
    </div>`;
}

// ─── TOGGLE TASK ──────────────────────────────────────────────
async function toggleTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  const newStatus = task.status === 'done' ? 'active' : 'done';
  task.status = newStatus;

  const { error } = await SB.from('bb_tasks').update({
    status: newStatus,
    updated_by: currentUser.id,
  }).eq('id', id);

  if (error) { task.status = task.status === 'done' ? 'active' : 'done'; }
  renderTasks();
}

async function toggleSubtask(subId, taskId) {
  const subs = state.subtasks[taskId] || [];
  const sub = subs.find(s => s.id === subId);
  if (!sub) return;
  sub.done = !sub.done;

  await SB.from('bb_subtasks').update({ done: sub.done }).eq('id', subId);

  // Обновляем прогресс задачи
  const allDone = subs.every(s => s.done);
  const task = state.tasks.find(t => t.id === parseInt(taskId));
  if (task && allDone) { task.status = 'done'; await SB.from('bb_tasks').update({ status: 'done', updated_by: currentUser.id }).eq('id', taskId); }
  else if (task && task.status === 'done') { task.status = 'active'; await SB.from('bb_tasks').update({ status: 'active', updated_by: currentUser.id }).eq('id', taskId); }

  renderTasks();
}

// ─── MODAL ────────────────────────────────────────────────────
function initModal() {
  document.getElementById('btn-add-task').addEventListener('click', () => openTaskModal(null));
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('task-modal').addEventListener('click', e => {
    if (e.target.id === 'task-modal') closeModal();
  });
  document.getElementById('btn-save').addEventListener('click', saveTask);
  document.getElementById('btn-delete').addEventListener('click', deleteTask);
  document.getElementById('btn-add-subtask').addEventListener('click', addFormSubtask);
  document.getElementById('subtask-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addFormSubtask();
  });

  // Type seg
  document.getElementById('f-type-seg').addEventListener('click', e => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    document.querySelectorAll('#f-type-seg .seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const type = btn.dataset.val;
    // Показываем/скрываем поля
    document.getElementById('f-travel-wrap').style.display =
      ['meeting','trip'].includes(type) ? '' : 'none';
  });

  // Section change
  document.getElementById('f-section').addEventListener('change', e => {
    document.getElementById('f-project-row').style.display =
      e.target.value === 'projects' ? '' : 'none';
  });

  // Priority/urgency
  ['f-priority','f-urgency'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => {
      const btn = e.target.closest('.prio-btn');
      if (!btn) return;
      document.querySelectorAll(`#${id} .prio-btn`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Recurrence
  document.getElementById('f-recurrence').addEventListener('change', e => {
    document.getElementById('f-recurrence-end-wrap').style.display =
      e.target.value && e.target.value !== 'custom' ? '' : 'none';
  });
}

function openTaskModal(taskId) {
  state.editingTaskId = taskId;
  state.formSubtasks = [];
  const modal = document.getElementById('task-modal');
  const metaEl = document.getElementById('modal-meta');

  // Populate assignee options
  const assignEl = document.getElementById('f-assignee');
  assignEl.innerHTML = `<option value="">— назначить —</option>`;
  Object.values(profiles).forEach(p => {
    assignEl.innerHTML += `<option value="${p.id}">${p.name}</option>`;
  });

  // Populate projects
  const projEl = document.getElementById('f-project');
  projEl.innerHTML = `<option value="">— без проекта —</option>`;
  state.projects.forEach(p => {
    projEl.innerHTML += `<option value="${p.id}">${p.name}</option>`;
  });

  // Populate depends
  const depsEl = document.getElementById('f-depends');
  depsEl.innerHTML = `<option value="">— нет зависимости —</option>`;
  state.tasks.filter(t => t.id !== taskId).forEach(t => {
    depsEl.innerHTML += `<option value="${t.id}">${escHtml(t.title)}</option>`;
  });

  if (taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    document.getElementById('modal-title').textContent = 'Редактировать задачу';
    document.getElementById('btn-delete').classList.remove('hidden');

    // Author info
    const author = profiles[task.created_by];
    const updatedBy = profiles[task.updated_by];
    let metaText = '';
    if (author) metaText += `Создал: ${author.name}`;
    if (task.created_at) metaText += ` · ${fmtDateShort(task.created_at)}`;
    if (updatedBy && task.updated_by !== task.created_by) metaText += ` · Изменил: ${updatedBy.name}`;
    metaEl.textContent = metaText;

    // Fill fields
    document.getElementById('f-title').value = task.title || '';
    setSegActive('f-type-seg', task.type || 'task');
    document.getElementById('f-section').value = task.section || 'bureau';
    document.getElementById('f-project-row').style.display = task.section === 'projects' ? '' : 'none';
    document.getElementById('f-project').value = task.project_id || '';
    document.getElementById('f-assignee').value = task.assigned_to || '';
    setPrioActive('f-priority', task.priority || 2);
    setPrioActive('f-urgency', task.urgency || 2);
    document.getElementById('f-date').value = task.date_due || '';
    document.getElementById('f-time-start').value = task.time_start?.slice(0,5) || '';
    document.getElementById('f-time-end').value = task.time_end?.slice(0,5) || '';
    document.getElementById('f-travel').value = task.travel_time || '';
    document.getElementById('f-travel-wrap').style.display = ['meeting','trip'].includes(task.type) ? '' : 'none';
    document.getElementById('f-recurrence').value = task.recurrence || '';
    document.getElementById('f-recurrence-end-wrap').style.display = task.recurrence && task.recurrence !== 'custom' ? '' : 'none';
    document.getElementById('f-recurrence-end').value = task.recurrence_end || '';
    document.getElementById('f-depends').value = task.depends_on || '';
    document.getElementById('f-notes').value = task.notes || '';
    document.getElementById('f-personal').checked = task.is_personal || false;

    // Subtasks
    state.formSubtasks = (state.subtasks[taskId] || []).map(s => ({ ...s }));
  } else {
    document.getElementById('modal-title').textContent = 'Новая задача';
    document.getElementById('btn-delete').classList.add('hidden');
    metaEl.textContent = `Создаёт: ${currentProfile?.name || ''}`;
    // Reset
    document.getElementById('f-title').value = '';
    setSegActive('f-type-seg', 'task');
    document.getElementById('f-section').value = 'bureau';
    document.getElementById('f-project-row').style.display = 'none';
    document.getElementById('f-project').value = '';
    document.getElementById('f-assignee').value = '';
    setPrioActive('f-priority', 2);
    setPrioActive('f-urgency', 2);
    document.getElementById('f-date').value = state.filter.date !== 'today' && state.filter.date !== 'tomorrow' && state.filter.date !== 'nodate' ? state.filter.date : '';
    document.getElementById('f-time-start').value = '';
    document.getElementById('f-time-end').value = '';
    document.getElementById('f-travel').value = '';
    document.getElementById('f-travel-wrap').style.display = 'none';
    document.getElementById('f-recurrence').value = '';
    document.getElementById('f-recurrence-end-wrap').style.display = 'none';
    document.getElementById('f-recurrence-end').value = '';
    document.getElementById('f-depends').value = '';
    document.getElementById('f-notes').value = '';
    document.getElementById('f-personal').checked = false;
    state.formSubtasks = [];
  }

  renderFormSubtasks();
  modal.classList.remove('hidden');
  document.getElementById('f-title').focus();
}

function closeModal() {
  document.getElementById('task-modal').classList.add('hidden');
  state.editingTaskId = null;
  state.formSubtasks = [];
}

function renderFormSubtasks() {
  const list = document.getElementById('subtasks-list');
  list.innerHTML = state.formSubtasks.map((s, i) => `
    <div class="subtask-item">
      <input type="checkbox" class="subtask-cb" ${s.done ? 'checked' : ''} data-idx="${i}">
      <span class="subtask-text">${escHtml(s.title)}</span>
      <button class="subtask-rm" data-idx="${i}">×</button>
    </div>`).join('');

  list.querySelectorAll('.subtask-rm').forEach(btn => {
    btn.addEventListener('click', () => {
      state.formSubtasks.splice(parseInt(btn.dataset.idx), 1);
      renderFormSubtasks();
    });
  });
  list.querySelectorAll('.subtask-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      state.formSubtasks[parseInt(cb.dataset.idx)].done = cb.checked;
    });
  });
}

function addFormSubtask() {
  const inp = document.getElementById('subtask-input');
  const title = inp.value.trim();
  if (!title) return;
  state.formSubtasks.push({ title, done: false, order_num: state.formSubtasks.length });
  inp.value = '';
  renderFormSubtasks();
  inp.focus();
}

async function saveTask() {
  const title = document.getElementById('f-title').value.trim();
  if (!title) {
    document.getElementById('f-title').focus();
    showToast('Введите название задачи', 'error');
    return;
  }

  const type = document.querySelector('#f-type-seg .seg-btn.active')?.dataset.val || 'task';
  const section = document.getElementById('f-section').value;
  const priority = parseInt(document.querySelector('#f-priority .prio-btn.active')?.dataset.val || '2');
  const urgency = parseInt(document.querySelector('#f-urgency .prio-btn.active')?.dataset.val || '2');

  const taskData = {
    title,
    type,
    section,
    project_id: document.getElementById('f-project').value || null,
    assigned_to: document.getElementById('f-assignee').value || null,
    priority,
    urgency,
    date_due: document.getElementById('f-date').value || null,
    time_start: document.getElementById('f-time-start').value || null,
    time_end: document.getElementById('f-time-end').value || null,
    travel_time: parseInt(document.getElementById('f-travel').value) || 0,
    recurrence: document.getElementById('f-recurrence').value || null,
    recurrence_end: document.getElementById('f-recurrence-end').value || null,
    depends_on: document.getElementById('f-depends').value || null,
    notes: document.getElementById('f-notes').value || null,
    is_personal: document.getElementById('f-personal').checked,
    updated_by: currentUser.id,
  };

  document.getElementById('btn-save').disabled = true;

  let taskId = state.editingTaskId;

  if (taskId) {
    const { error } = await SB.from('bb_tasks').update(taskData).eq('id', taskId);
    if (error) { showToast('Ошибка сохранения', 'error'); document.getElementById('btn-save').disabled = false; return; }
    const idx = state.tasks.findIndex(t => t.id === taskId);
    if (idx >= 0) Object.assign(state.tasks[idx], taskData);
  } else {
    const { data, error } = await SB.from('bb_tasks').insert({
      ...taskData,
      created_by: currentUser.id,
      status: 'active',
    }).select().single();
    if (error) { showToast('Ошибка создания задачи', 'error'); document.getElementById('btn-save').disabled = false; return; }
    taskId = data.id;
    state.tasks.push(data);
  }

  // Сохраняем подзадачи
  if (taskId) {
    // Удаляем старые
    await SB.from('bb_subtasks').delete().eq('task_id', taskId);
    // Вставляем новые
    if (state.formSubtasks.length) {
      const subs = state.formSubtasks.map((s, i) => ({
        task_id: taskId,
        title: s.title,
        done: s.done || false,
        order_num: i,
      }));
      const { data: savedSubs } = await SB.from('bb_subtasks').insert(subs).select();
      state.subtasks[taskId] = savedSubs || [];
    } else {
      state.subtasks[taskId] = [];
    }
  }

  document.getElementById('btn-save').disabled = false;
  closeModal();
  renderCalendar();
  renderTasks();
  showToast(state.editingTaskId ? 'Задача обновлена' : 'Задача создана', 'success');
}

async function deleteTask() {
  if (!state.editingTaskId) return;
  if (!confirm('Удалить задачу?')) return;

  await SB.from('bb_subtasks').delete().eq('task_id', state.editingTaskId);
  await SB.from('bb_tasks').delete().eq('id', state.editingTaskId);

  state.tasks = state.tasks.filter(t => t.id !== state.editingTaskId);
  delete state.subtasks[state.editingTaskId];

  closeModal();
  renderCalendar();
  renderTasks();
  showToast('Задача удалена');
}

// ─── UTILS ────────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(ds, n) {
  const d = new Date(ds + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtDateShort(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
function pluralTask(n) {
  if (n % 100 >= 11 && n % 100 <= 19) return 'задач';
  const r = n % 10;
  if (r === 1) return 'задача';
  if (r >= 2 && r <= 4) return 'задачи';
  return 'задач';
}
function setSegActive(containerId, val) {
  document.querySelectorAll(`#${containerId} .seg-btn`).forEach(b => {
    b.classList.toggle('active', b.dataset.val === String(val));
  });
}
function setPrioActive(containerId, val) {
  document.querySelectorAll(`#${containerId} .prio-btn`).forEach(b => {
    b.classList.toggle('active', b.dataset.val === String(val));
  });
}

// ─── TOAST ────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  t.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3000);
}
