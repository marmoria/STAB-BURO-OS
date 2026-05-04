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
      storageKey: 'bb-shtab-auth',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
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
  // Проверяем текущую сессию сразу
  SB.auth.getSession().then(async ({ data: { session } }) => {
    if (session) {
      currentUser = session.user;
      await loadProfile();
      showApp();
    }
  });

  SB.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      currentUser = session.user;
      await loadProfile();
      showApp();
    } else if (event === 'SIGNED_OUT') {
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
      // Сразу входим
      const { error: signInError } = await SB.auth.signInWithPassword({ email, password });
      if (signInError) {
        showToast('Аккаунт создан. Войдите через форму входа.', 'success');
        setAuthMode('login');
      }
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
      if (page === 'tasks') renderTasksPage();
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
    .order('created_at', { ascending: false });

  if (error) {
    console.error('loadTasks error:', JSON.stringify(error));
    showToast('Ошибка загрузки: ' + (error.message || error.code), 'error');
    state.tasks = [];
    return;
  }
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



// ─── TASKS PAGE ───────────────────────────────────────────────
let tasksState = {
  view: 'list',      // 'list' | 'kanban'
  section: 'all',
  person: 'all',
  prio: 'all',
  status: 'active',  // 'active' | 'done' | 'all'
  search: '',
};

const KANBAN_COLS = [
  { id: 'incoming', label: 'ВХОДЯЩИЕ',     color: 'var(--ochre)' },
  { id: 'active',   label: 'В РАБОТЕ',     color: 'var(--blue)' },
  { id: 'review',   label: 'НА ПРОВЕРКЕ',  color: 'var(--plum)' },
  { id: 'done',     label: 'ВЫПОЛНЕНО',    color: 'var(--green)' },
];

function renderTasksPage() {
  const page = document.getElementById('page-tasks');
  if (!page || !page.classList.contains('active')) return;
  try {

  const tasks = getTasksFiltered();
  const total = state.tasks.filter(t => !t.is_personal || t.created_by === currentUser?.id).length;
  const active = state.tasks.filter(t => t.status === 'active' && (!t.is_personal || t.created_by === currentUser?.id)).length;

  page.innerHTML = `
    <div class="tp-header">
      <div class="tp-title">ЗАДАЧИ</div>
      <div class="tp-stats">
        <span>${active} активных</span>
        <span style="color:var(--ink4)">/ ${total} всего</span>
      </div>
      <div class="tp-view-toggle">
        <button class="tv-btn ${tasksState.view==='list'?'active':''}" data-tview="list">СПИСОК</button>
        <button class="tv-btn ${tasksState.view==='kanban'?'active':''}" data-tview="kanban">КАНБАН</button>
      </div>
      <button class="btn-add-task" id="btn-add-task-2">+ ЗАДАЧА</button>
    </div>

    <div class="tp-filters">
      <input type="text" class="tp-search" id="tp-search" placeholder="Поиск..." value="${tasksState.search}">
      <select class="tp-sel" id="tp-section">
        <option value="all">Все разделы</option>
        <option value="projects" ${tasksState.section==='projects'?'selected':''}>🏗 Проекты</option>
        <option value="bureau" ${tasksState.section==='bureau'?'selected':''}>🏢 Бюро</option>
        <option value="marketing" ${tasksState.section==='marketing'?'selected':''}>📣 Маркетинг</option>
        <option value="finance" ${tasksState.section==='finance'?'selected':''}>💰 Финансы</option>
        <option value="partners" ${tasksState.section==='partners'?'selected':''}>👥 Смежники</option>
        <option value="growth" ${tasksState.section==='growth'?'selected':''}>📈 Развитие</option>
      </select>
      <select class="tp-sel" id="tp-person">
        <option value="all">Все люди</option>
        ${profiles ? Object.values(profiles).map(p =>
          `<option value="${p.id}" ${tasksState.person===p.id?'selected':''}>${p.name}</option>`
        ).join('') : ''}
      </select>
      <select class="tp-sel" id="tp-prio">
        <option value="all">Все приоритеты</option>
        <option value="1" ${tasksState.prio==='1'?'selected':''}>Приоритет 1</option>
        <option value="2" ${tasksState.prio==='2'?'selected':''}>Приоритет 2</option>
        <option value="3" ${tasksState.prio==='3'?'selected':''}>Приоритет 3</option>
      </select>
      <div class="tp-status-toggle">
        <button class="ts-btn ${tasksState.status==='active'?'active':''}" data-tstatus="active">АКТИВНЫЕ</button>
        <button class="ts-btn ${tasksState.status==='done'?'active':''}" data-tstatus="done">ВЫПОЛНЕННЫЕ</button>
        <button class="ts-btn ${tasksState.status==='all'?'active':''}" data-tstatus="all">ВСЕ</button>
      </div>
    </div>

    <div class="tp-content" id="tp-content">
      ${tasksState.view === 'list' ? buildTasksList(tasks) : buildTasksKanban(tasks)}
    </div>
  `;

  // Events
  const p = page;
  p.querySelector('#btn-add-task-2')?.addEventListener('click', () => openTaskModal(null));
  p.querySelector('#tp-search')?.addEventListener('input', e => { tasksState.search = e.target.value; renderTasksPage(); });
  p.querySelector('#tp-section')?.addEventListener('change', e => { tasksState.section = e.target.value; renderTasksPage(); });
  p.querySelector('#tp-person')?.addEventListener('change', e => { tasksState.person = e.target.value; renderTasksPage(); });
  p.querySelector('#tp-prio')?.addEventListener('change', e => { tasksState.prio = e.target.value; renderTasksPage(); });
  p.querySelectorAll('[data-tview]').forEach(btn => {
    btn.addEventListener('click', () => { tasksState.view = btn.dataset.tview; renderTasksPage(); });
  });
  p.querySelectorAll('[data-tstatus]').forEach(btn => {
    btn.addEventListener('click', () => { tasksState.status = btn.dataset.tstatus; renderTasksPage(); });
  });
  p.querySelectorAll('[data-tid]').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.task-check') || e.target.closest('.subtask-check')) return;
      openTaskModal(parseInt(el.dataset.tid));
    });
  });
  p.querySelectorAll('.task-check[data-id]').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); toggleTask(parseInt(el.dataset.id)); });
  });
  // Kanban drag
  p.querySelectorAll('.kb-col-body').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('kb-drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('kb-drag-over'));
    col.addEventListener('drop', e => {
      e.preventDefault(); col.classList.remove('kb-drag-over');
      const id = parseInt(e.dataTransfer.getData('taskId'));
      const newStatus = col.dataset.col;
      const task = state.tasks.find(t => t.id === id);
      if (task) {
        task.status = newStatus === 'done' ? 'done' : 'active';
        task.kanban_col = newStatus;
        SB.from('bb_tasks').update({ status: task.status, kanban_col: newStatus, updated_by: currentUser.id }).eq('id', id).then(() => {});
        renderTasksPage();
      }
    });
  });
  p.querySelectorAll('.kb-card').forEach(card => {
    card.addEventListener('dragstart', e => { e.dataTransfer.setData('taskId', card.dataset.id); });
    card.addEventListener('click', e => {
      if (e.target.closest('.task-check')) return;
      openTaskModal(parseInt(card.dataset.id));
    });
  });
  p.querySelectorAll('.task-check.kb-check').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); toggleTask(parseInt(el.dataset.id)); });
  });
  } catch(err) {
    console.error('renderTasksPage error:', err);
    page.innerHTML = `<div class="page-stub"><div class="stub-icon">!</div><div class="stub-label">Ошибка: ${err.message}</div></div>`;
  }
}

function getTasksFiltered() {
  let tasks = state.tasks.filter(t => !t.is_personal || t.created_by === currentUser?.id);
  if (tasksState.status === 'active') tasks = tasks.filter(t => t.status === 'active');
  else if (tasksState.status === 'done') tasks = tasks.filter(t => t.status === 'done');
  if (tasksState.section !== 'all') tasks = tasks.filter(t => t.section === tasksState.section);
  if (tasksState.person !== 'all') tasks = tasks.filter(t => t.assigned_to === tasksState.person || t.created_by === tasksState.person);
  if (tasksState.prio !== 'all') tasks = tasks.filter(t => String(t.priority) === tasksState.prio);
  if (tasksState.search) {
    const q = tasksState.search.toLowerCase();
    tasks = tasks.filter(t => t.title?.toLowerCase().includes(q) || t.notes?.toLowerCase().includes(q));
  }
  return tasks;
}

function buildTasksList(tasks) {
  if (!tasks.length) return `<div class="empty-state"><div class="empty-icon">▦</div><div class="empty-text">Нет задач</div></div>`;

  // Группируем по разделу
  const sections = {
    projects: [], bureau: [], marketing: [], finance: [], partners: [], growth: [], other: []
  };
  const SLABELS = {
    projects:'🏗 ПРОЕКТЫ', bureau:'🏢 БЮРО', marketing:'📣 МАРКЕТИНГ',
    finance:'💰 ФИНАНСЫ', partners:'👥 СМЕЖНИКИ', growth:'📈 РАЗВИТИЕ', other:'ПРОЧЕЕ'
  };
  tasks.forEach(t => {
    if (sections[t.section] !== undefined) sections[t.section].push(t);
    else sections.other.push(t);
  });

  let html = '<div class="tl-list">';
  Object.entries(sections).forEach(([sec, items]) => {
    if (!items.length) return;
    // Сортируем: сначала приоритет 1, потом 2, потом 3
    items.sort((a,b) => (a.priority||3) - (b.priority||3));
    html += `<div class="tl-group">
      <div class="tl-group-title">${SLABELS[sec] || sec} <span class="tl-count">${items.length}</span></div>
      ${items.map(t => buildTaskListRow(t)).join('')}
    </div>`;
  });
  html += '</div>';
  return html;
}

function buildTaskListRow(t) {
  const subs = state.subtasks[t.id] || [];
  const subDone = subs.filter(s => s.done).length;
  const pct = subs.length ? Math.round(subDone/subs.length*100) : null;
  const isDone = t.status === 'done';
  const over = t.date_due && t.date_due < todayStr() && !isDone;
  const pc = profiles && profiles[t.created_by] ? profiles[t.created_by] : null;
  const SCOLOR = {
    projects:'var(--c-projects)', bureau:'var(--c-bureau)', marketing:'var(--c-marketing)',
    finance:'var(--c-finance)', partners:'var(--c-partners)', growth:'var(--c-growth)'
  };
  const secColor = SCOLOR[t.section] || 'var(--ink3)';
  const prioDots = [1,2,3].map(i => `<div class="prio-dot ${i<=(t.priority||2)?'filled':''}"></div>`).join('');

  return `<div class="tl-row ${isDone?'done':''} ${over?'overdue':''}" data-tid="${t.id}">
    <div class="task-check ${isDone?'checked':''}" data-id="${t.id}">${isDone?'✓':''}</div>
    <div class="tl-bar" style="background:${secColor}"></div>
    <div class="tl-body">
      <div class="tl-title">${escHtml(t.title)}</div>
      ${t.notes ? `<div class="tl-notes">${escHtml(t.notes.slice(0,80))}${t.notes.length>80?'…':''}</div>` : ''}
      ${pct !== null ? `<div class="tl-progress"><div class="tl-progress-fill" style="width:${pct}%"></div><span class="tl-pct">${pct}%</span></div>` : ''}
    </div>
    <div class="tl-meta">
      <div class="prio-dots">${prioDots}</div>
      ${pc ? `<div class="task-avatar" style="background:${pc.color||'var(--brick)'}22;color:${pc.color||'var(--brick)'};width:18px;height:18px;font-size:8px">${pc.avatar_initials||'?'}</div>` : ''}
      ${t.date_due ? `<span class="tl-date ${over?'over':''}">${over?'⚠ ':''}${fmtDateShort(t.date_due)}</span>` : ''}
    </div>
  </div>`;
}

function buildTasksKanban(tasks) {
  const SCOLOR = {
    projects:'var(--c-projects)', bureau:'var(--c-bureau)', marketing:'var(--c-marketing)',
    finance:'var(--c-finance)', partners:'var(--c-partners)', growth:'var(--c-growth)'
  };

  // Канбан по статусу
  const colMap = {
    incoming: tasks.filter(t => t.type === 'incoming'),
    active: tasks.filter(t => t.status === 'active' && t.type !== 'incoming' && !(t.kanban_col === 'review')),
    review: tasks.filter(t => t.kanban_col === 'review'),
    done: tasks.filter(t => t.status === 'done'),
  };

  return `<div class="kb-board">
    ${KANBAN_COLS.map(col => {
      const items = colMap[col.id] || [];
      return `<div class="kb-col">
        <div class="kb-col-header">
          <div class="kb-col-dot" style="background:${col.color}"></div>
          <span class="kb-col-title">${col.label}</span>
          <span class="kb-col-cnt">${items.length}</span>
        </div>
        <div class="kb-col-body" data-col="${col.id}">
          ${items.map(t => {
            const secColor = SCOLOR[t.section] || 'var(--ink3)';
            const pc = profiles && profiles[t.created_by] ? profiles[t.created_by] : null;
            const isDone = t.status === 'done';
            const over = t.date_due && t.date_due < todayStr() && !isDone;
            return `<div class="kb-card ${isDone?'done':''}" draggable="true" data-id="${t.id}">
              <div class="kb-card-bar" style="background:${secColor}"></div>
              <div class="kb-card-body">
                <div class="task-check kb-check ${isDone?'checked':''}" data-id="${t.id}">${isDone?'✓':''}</div>
                <div class="kb-card-title ${isDone?'done':''}">${escHtml(t.title)}</div>
              </div>
              <div class="kb-card-footer">
                ${pc ? `<div class="task-avatar" style="background:${pc.color||'var(--brick)'}22;color:${pc.color||'var(--brick)'};width:16px;height:16px;font-size:7px">${pc.avatar_initials||'?'}</div>` : ''}
                ${t.date_due ? `<span class="tl-date ${over?'over':''}" style="font-size:9px">${fmtDateShort(t.date_due)}</span>` : ''}
                <div class="prio-dots" style="margin-left:auto">${[1,2,3].map(i=>`<div class="prio-dot" style="width:5px;height:5px;${i<=(t.priority||2)?'background:var(--ink)':''}"></div>`).join('')}</div>
              </div>
            </div>`;
          }).join('')}
          ${!items.length ? `<div class="kb-empty">пусто</div>` : ''}
        </div>
      </div>`;
    }).join('')}
  </div>`;
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

  const _proj = document.getElementById('f-project').value;
  const _assign = document.getElementById('f-assignee').value;
  const _dep = document.getElementById('f-depends').value;
  const _rec = document.getElementById('f-recurrence').value;
  const _recEnd = document.getElementById('f-recurrence-end').value;
  const _travel = parseInt(document.getElementById('f-travel').value);

  const taskData = {
    title,
    type,
    section,
    project_id: _proj ? parseInt(_proj) : null,
    assigned_to: _assign || null,
    priority,
    urgency,
    date_due: document.getElementById('f-date').value || null,
    time_start: document.getElementById('f-time-start').value || null,
    time_end: document.getElementById('f-time-end').value || null,
    travel_time: isNaN(_travel) ? 0 : _travel,
    recurrence: _rec || null,
    recurrence_end: _recEnd || null,
    depends_on: _dep ? parseInt(_dep) : null,
    notes: document.getElementById('f-notes').value || null,
    is_personal: document.getElementById('f-personal').checked,
    updated_by: currentUser.id,
  };

  document.getElementById('btn-save').disabled = true;

  let taskId = state.editingTaskId;

  if (taskId) {
    const { error } = await SB.from('bb_tasks').update(taskData).eq('id', taskId);
    if (error) {
      console.error('Ошибка обновления:', error);
      showToast('Ошибка: ' + (error.message || error.code), 'error');
      document.getElementById('btn-save').disabled = false;
      return;
    }
    const idx = state.tasks.findIndex(t => t.id === taskId);
    if (idx >= 0) Object.assign(state.tasks[idx], taskData);
  } else {
    const { data, error } = await SB.from('bb_tasks').insert({
      ...taskData,
      created_by: currentUser.id,
      status: 'active',
    }).select().single();
    if (error) {
      console.error('Ошибка создания:', JSON.stringify(error));
      showToast('Ошибка: ' + (error.message || error.code || 'неизвестно'), 'error');
      document.getElementById('btn-save').disabled = false;
      return;
    }
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
