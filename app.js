'use strict'; // v20260515_fix_auth

// Пользователи системы
const USERS = [
  { id:'maria', name:'Мария', avatar:'МА', color:'#a84332', hash:'9b2db879befc26f80abd606a33cdade35c2bd17759d846e7812a41afd7350bfa' },
  { id:'ilya',  name:'Илья',  avatar:'ИЛ', color:'#534AB7', hash:'5531d8db8ad6585cf0204496f7eb98584fe42a2651766bdb5001248061458c59' },
];



// ─── CONFIG ───────────────────────────────────────────────────
const SB_URL = 'https://pjrvjlpjyfvlkobzkhtp.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqcnZqbHBqeWZ2bGtvYnpraHRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MjQ2NzksImV4cCI6MjA4OTAwMDY3OX0.hGPjFpMQ7n_xh-XE9qIINFpSPiOrK-zgYn_qY5TPDnY';
const PW_HASH = '9b2db879befc26f80abd606a33cdade35c2bd17759d846e7812a41afd7350bfa';

const RU_HOLIDAYS = new Set([
  '2026-01-01','2026-01-02','2026-01-03','2026-01-04','2026-01-05',
  '2026-01-06','2026-01-07','2026-01-08','2026-01-09',
  '2026-02-23','2026-02-24','2026-03-06','2026-03-09',
  '2026-05-01','2026-05-04','2026-05-05','2026-05-11',
  '2026-06-12','2026-11-04','2026-12-31',
]);

const SECTION_LABELS = {
  projects:'🏗 Проекты', bureau:'🏢 Бюро', marketing:'📣 Маркетинг',
  finance:'💰 Финансы', partners:'👥 Смежники', growth:'📈 Развитие',
};
const SECTION_COLORS = {
  projects:'var(--c-projects)', bureau:'var(--c-bureau)', marketing:'var(--c-marketing)',
  finance:'var(--c-finance)', partners:'var(--c-partners)', growth:'var(--c-growth)',
};
const TYPE_LABELS = {
  task:'Задача', meeting:'Встреча', call:'Звонок',
  trip:'Поездка', deadline:'Дедлайн', payment:'Оплата',
};

// ─── STATE ────────────────────────────────────────────────────
let SB = null;
let currentUser = null;
let currentProfile = null;
let profiles = {};

let state = {
  tasks: [], subtasks: {}, projects: [],
  instanceStatuses: {},   // taskId_date -> status
  instanceSubtasks: {},   // subtaskId_date -> done(bool)
  taskInstances: {},      // алиас для совместимости
  subtaskInstances: {},   // алиас для совместимости
  filter: { date: 'today', section: 'all' },
  calMonth: new Date().getMonth(),
  calYear: new Date().getFullYear(),
  editingTaskId: null,
  formSubtasks: [],
  quickAddTaskId: null,
};

let tasksState = {
  view: 'list', section: 'all', person: 'all',
  prio: 'all', status: 'active', search: '',
};

// ─── UTILS ────────────────────────────────────────────────────
function todayStr() { return new Date().toISOString().slice(0,10); }
function addDays(ds,n) { const d=new Date(ds+'T00:00:00'); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }
function escHtml(s) { if(!s) return ''; return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtDateShort(iso) {
  if(!iso) return '';
  const d = new Date(iso.slice(0,10)+'T00:00:00');
  const M = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  return d.getDate()+' '+M[d.getMonth()];
}
function pluralTask(n) {
  if(n%100>=11&&n%100<=19) return 'задач';
  const r=n%10; if(r===1) return 'задача'; if(r>=2&&r<=4) return 'задачи'; return 'задач';
}
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
let toastTimer = null;
function showToast(msg, type='') {
  const t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg; t.className = 'toast'+(type?' '+type:'');
  t.classList.remove('hidden');
  if(toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.add('hidden'), 3000);
}

// ─── AUTH ─────────────────────────────────────────────────────
function initAuth() {
  // Проверяем сохранённую сессию
  const savedUserId = sessionStorage.getItem('bb-user-id');
  const savedHash = sessionStorage.getItem('bb-ok');
  if(savedUserId && savedHash) {
    const user = USERS.find(u => u.id === savedUserId && u.hash === savedHash);
    if(user) {
      setCurrentUser(user);
      document.getElementById('auth-screen').classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
      loadDataAndShow();
      return;
    }
  }

  renderAuthScreen();
  const logout = document.getElementById('btn-logout');
  if(logout) logout.addEventListener('click', ()=>{
    sessionStorage.removeItem('bb-ok');
    sessionStorage.removeItem('bb-user-id');
    location.reload();
  });
}

function renderAuthScreen() {
  const authCard = document.querySelector('.auth-card');
  if(!authCard) return;

  let html = '';
  html += '<div class="auth-logo">';
  html += '<span class="auth-logo-brick">BRICK</span><span class="auth-logo-buro">BURO</span>';
  html += '<div class="auth-logo-sub">ШТАБ</div></div>';
  html += '<div id="auth-error" class="auth-error hidden"></div>';
  html += '<div class="auth-user-select">';
  USERS.forEach(u => {
    html += '<button class="auth-user-btn" data-user-id="'+u.id+'">';
    html += '<div class="auth-user-avatar" style="background:'+u.color+'">'+u.avatar+'</div>';
    html += '<span>'+u.name+'</span></button>';
  });
  html += '</div>';
  html += '<div id="auth-pw-wrap" style="display:none">';
  html += '<div class="auth-selected-user" id="auth-selected-name"></div>';
  html += '<div class="auth-form">';
  html += '<div class="field-wrap"><label class="field-label">Пароль</label>';
  html += '<input type="password" id="auth-password" class="field-input" placeholder="••••••••" autocomplete="current-password"></div>';
  html += '<button id="auth-submit" class="btn-primary auth-submit">';
  html += '<span id="auth-btn-text">Войти</span>';
  html += '<span id="auth-btn-spin" class="btn-spinner hidden"></span></button>';
  html += '</div>';
  html += '<button class="auth-back-btn" id="auth-back">← Назад</button>';
  html += '</div>';
  html += '<div class="auth-hint">Только для команды BrickBuro</div>';

  authCard.innerHTML = html;

  let selectedUserId = null;

  authCard.querySelectorAll('.auth-user-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedUserId = btn.dataset.userId;
      const user = USERS.find(u => u.id === selectedUserId);
      document.getElementById('auth-selected-name').textContent = user.name;
      document.querySelector('.auth-user-select').style.display = 'none';
      document.getElementById('auth-pw-wrap').style.display = 'block';
      document.getElementById('auth-password').focus();
    });
  });

  authCard.querySelector('#auth-back')?.addEventListener('click', () => {
    document.querySelector('.auth-user-select').style.display = 'grid';
    document.getElementById('auth-pw-wrap').style.display = 'none';
    selectedUserId = null;
  });

  authCard.querySelector('#auth-submit')?.addEventListener('click', () => doAuth(selectedUserId));
  authCard.querySelector('#auth-password')?.addEventListener('keydown', e => {
    if(e.key === 'Enter') doAuth(selectedUserId);
  });
}


function setCurrentUser(user) {
  currentUser = { id: user.id, email: user.id + '@brickburo.com' };
  currentProfile = { id: user.id, name: user.name, avatar_initials: user.avatar, color: user.color };
  profiles[user.id] = currentProfile;
}

async function doAuth(userId) {
  const pw = document.getElementById('auth-password')?.value;
  const errEl = document.getElementById('auth-error');
  const btnText = document.getElementById('auth-btn-text');
  const btn = document.getElementById('auth-submit');
  if(!pw) { errEl.textContent='Введите пароль'; errEl.classList.remove('hidden'); return; }
  if(!userId) { errEl.textContent='Выберите пользователя'; errEl.classList.remove('hidden'); return; }
  errEl.classList.add('hidden');
  btnText.textContent='Вхожу...'; btn.disabled=true;
  const h = await sha256(pw);
  const user = USERS.find(u => u.id === userId && u.hash === h);
  if(user) {
    sessionStorage.setItem('bb-ok', h);
    sessionStorage.setItem('bb-user-id', user.id);
    setCurrentUser(user);
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    loadDataAndShow();
  } else {
    errEl.textContent='Неверный пароль'; errEl.classList.remove('hidden');
    btnText.textContent='Войти'; btn.disabled=false;
  }
}

// ─── LOAD DATA ────────────────────────────────────────────────
async function loadDataAndShow() {
  await Promise.all([loadTasks(), loadProjects(), loadGoals()]);
  const av = document.getElementById('user-avatar');
  const un = document.getElementById('user-name');
  if(av) av.textContent = currentProfile.avatar_initials;
  if(un) un.textContent = currentProfile.name;
  initCalendar();
  renderTodayHeader();
  renderTasks();
}

async function loadTasks() {
  const { data, error } = await SB.from('bb_tasks').select('*').order('created_at', { ascending: false });
  if(error) { console.error('loadTasks:', error); state.tasks=[]; return; }
  state.tasks = data || [];
  const ids = state.tasks.map(t=>t.id);
  if(ids.length) {
    const { data: subs } = await SB.from('bb_subtasks').select('*').in('task_id', ids).order('order_num');
    if(subs) {
      state.subtasks = {};
      subs.forEach(s=>{ if(!state.subtasks[s.task_id]) state.subtasks[s.task_id]=[]; state.subtasks[s.task_id].push(s); });
    }
    // Статусы конкретных дней повторяющихся задач
    const { data: tinst } = await SB.from('bb_task_instances').select('*').in('task_id', ids);
    if(tinst) {
      state.instanceStatuses = {};
      tinst.forEach(i => { state.instanceStatuses[i.task_id+'_'+i.instance_date] = i.status; });
    }
    // Отметки подзадач по датам
    const allSubIds = Object.values(state.subtasks).flat().map(s=>s.id);
    if(allSubIds.length) {
      const { data: sinst } = await SB.from('bb_subtask_instances').select('*').in('subtask_id', allSubIds);
      if(sinst) {
        state.instanceSubtasks = {};
        sinst.forEach(i => { state.instanceSubtasks[i.subtask_id+'_'+i.instance_date] = i.done; });
      }
    }
  }
}

async function loadProjects() {
  const { data, error } = await SB.from('projects').select('*').order('name');
  if(error) console.error('loadProjects error:', error);
  state.projects = data || [];
}

async function loadGoals() {
  const { data, error } = await SB.from('bb_goals').select('*').order('created_at', {ascending:false});
  if(error) { console.error('loadGoals:', error); state.goals=[]; return; }
  state.goals = data || [];
  // Загружаем подзадачи целей
  const ids = state.goals.map(g=>g.id);
  if(ids.length) {
    const { data: subs } = await SB.from('bb_subtasks').select('*').in('task_id', ids).order('order_num');
    if(subs) subs.forEach(s=>{ if(!state.subtasks[s.task_id]) state.subtasks[s.task_id]=[]; state.subtasks[s.task_id].push(s); });
  }
}

// ─── NAV ──────────────────────────────────────────────────────
function initNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      const page = item.dataset.page;
      document.querySelectorAll('.nav-item').forEach(i=>i.classList.remove('active'));
      item.classList.add('active');
      document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
      const pg = document.getElementById('page-'+page);
      if(pg) pg.classList.add('active');
      if(page==='tasks') renderTasksPage();
      if(page==='gantt') renderGanttPage();
      if(page==='goals') renderGoalsPage();
      if(page==='projects') renderProjectsPage();
      if(page==='today') { renderTodayHeader(); renderTasks(); }
    });
  });
  document.getElementById('sidebar-toggle')?.addEventListener('click', ()=>{
    document.getElementById('sidebar').classList.toggle('collapsed');
  });
}

// ─── CALENDAR ─────────────────────────────────────────────────
function initCalendar() {
  renderCalendar();
  document.querySelectorAll('.ds-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.ds-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      state.filter.date = btn.dataset.filter;
      renderTodayHeader(); renderTasks();
    });
  });
  document.querySelectorAll('.tag-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.tag-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      state.filter.section = btn.dataset.section;
      renderTasks();
    });
  });
}

function renderCalendar() {
  const cal = document.getElementById('mini-cal');
  if(!cal) return;
  const y=state.calYear, m=state.calMonth, td=todayStr();
  const firstDay=new Date(y,m,1), lastDay=new Date(y,m+1,0);
  const startDow=(firstDay.getDay()+6)%7;
  const taskDates=new Set(state.tasks.filter(t=>t.date_due).map(t=>t.date_due.slice(0,10)));
  const MN=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const DOWS=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

  let html=`<div class="mc-header">
    <button class="mc-nav" id="mc-prev">‹</button>
    <div class="mc-title">${MN[m]} ${y}</div>
    <button class="mc-nav" id="mc-next">›</button>
  </div><div class="mc-grid">${DOWS.map(d=>`<div class="mc-dow">${d}</div>`).join('')}`;

  for(let i=0;i<startDow;i++) {
    const d=new Date(y,m,-startDow+i+1);
    html+=`<div class="mc-day other-month">${d.getDate()}</div>`;
  }
  for(let d=1;d<=lastDay.getDate();d++) {
    const ds=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dow=new Date(y,m,d).getDay();
    const isWe=dow===0||dow===6, isHol=RU_HOLIDAYS.has(ds), isToday=ds===td, hasTasks=taskDates.has(ds);
    let cls='mc-day';
    if(isToday) cls+=' today'; else if(isHol) cls+=' holiday'; else if(isWe) cls+=' weekend';
    if(hasTasks) cls+=' has-tasks';
    html+=`<div class="${cls}" data-date="${ds}">${d}</div>`;
  }
  html+=`</div>`;
  cal.innerHTML=html;

  document.getElementById('mc-prev')?.addEventListener('click', e=>{ e.stopPropagation(); state.calMonth--; if(state.calMonth<0){state.calMonth=11;state.calYear--;} renderCalendar(); });
  document.getElementById('mc-next')?.addEventListener('click', e=>{ e.stopPropagation(); state.calMonth++; if(state.calMonth>11){state.calMonth=0;state.calYear++;} renderCalendar(); });
  cal.querySelectorAll('.mc-day[data-date]').forEach(el=>{
    el.addEventListener('click', ()=>{
      document.querySelectorAll('.ds-btn').forEach(b=>b.classList.remove('active'));
      state.filter.date=el.dataset.date;
      renderTodayHeader(); renderTasks();
    });
  });
}

// ─── TODAY HEADER ─────────────────────────────────────────────
function renderTodayHeader() {
  const wrap=document.getElementById('today-date-big');
  if(!wrap) return;
  const DAYS=['ВОСКРЕСЕНЬЕ','ПОНЕДЕЛЬНИК','ВТОРНИК','СРЕДА','ЧЕТВЕРГ','ПЯТНИЦА','СУББОТА'];
  let d, dayName, dateNum, dateYear;
  if(state.filter.date==='today') {
    d=new Date(); dayName=DAYS[d.getDay()];
    dateNum=String(d.getDate()).padStart(2,'0')+'.'+String(d.getMonth()+1).padStart(2,'0');
    dateYear='.'+String(d.getFullYear()).slice(2);
  } else if(state.filter.date==='tomorrow') {
    d=new Date(); d.setDate(d.getDate()+1); dayName='ЗАВТРА';
    dateNum=String(d.getDate()).padStart(2,'0')+'.'+String(d.getMonth()+1).padStart(2,'0');
    dateYear='.'+String(d.getFullYear()).slice(2);
  } else if(state.filter.date==='nodate') {
    wrap.innerHTML=`<div class="today-day-name">ФИЛЬТР</div><div class="today-date-num">БЕЗ ДАТЫ</div>`; return;
  } else {
    d=new Date(state.filter.date+'T00:00:00'); dayName=DAYS[d.getDay()];
    dateNum=String(d.getDate()).padStart(2,'0')+'.'+String(d.getMonth()+1).padStart(2,'0');
    dateYear='.'+String(d.getFullYear()).slice(2);
  }
  wrap.innerHTML=`<div class="today-day-name">${dayName}</div><div class="today-date-num">${dateNum}<span class="today-date-year">${dateYear}</span></div>`;
}

// ─── TASKS RENDER ─────────────────────────────────────────────
function getFilteredDate() {
  const td=todayStr();
  if(state.filter.date==='today') return td;
  if(state.filter.date==='tomorrow') return addDays(td,1);
  if(state.filter.date==='nodate') return null;
  return state.filter.date;
}

function isTaskOnDate(task, dateStr) {
  if(!dateStr) return !task.date_due; // nodate
  if(task.date_due===dateStr) return true;
  // Повторяющиеся задачи
  if(task.recurrence && task.date_due) {
    const start=new Date(task.date_due+'T00:00:00');
    const target=new Date(dateStr+'T00:00:00');
    if(target<start) return false;
    if(task.recurrence_end && target>new Date(task.recurrence_end+'T00:00:00')) return false;
    const diffMs=target-start;
    const diffDays=Math.round(diffMs/(1000*60*60*24));
    if(task.recurrence==='daily') return true;
    if(task.recurrence==='weekly') return diffDays%7===0;
    if(task.recurrence==='biweekly') return diffDays%14===0;
    if(task.recurrence==='monthly') {
      return target.getDate()===start.getDate();
    }
    if(task.recurrence==='quarterly') {
      const mDiff=(target.getFullYear()-start.getFullYear())*12+(target.getMonth()-start.getMonth());
      return mDiff%3===0 && target.getDate()===start.getDate();
    }
    if(task.recurrence==='yearly') {
      return target.getMonth()===start.getMonth() && target.getDate()===start.getDate();
    }
  }
  return false;
}

function getFilteredTasks() {
  const dateStr=getFilteredDate();
  let tasks=state.tasks.filter(t=>isTaskOnDate(t,dateStr));
  if(state.filter.section!=='all') tasks=tasks.filter(t=>t.section===state.filter.section);
  return tasks;
}

function timeToMins(t) {
  if(!t) return null;
  const [h,m]=t.slice(0,5).split(':').map(Number);
  return h*60+m;
}

function renderTasks() {
  const tasks=getFilteredTasks();
  const groups=document.getElementById('task-groups');
  if(!groups) return;

  const total=tasks.length, done=tasks.filter(t=>t.status==='done').length;
  const pct=total?Math.round(done/total*100):0;
  const statsEl=document.getElementById('today-stats');
  if(statsEl) statsEl.innerHTML=`
    <div class="ts-block"><div class="ts-label">Всего на день</div><div class="ts-num">${total}</div></div>
    <div class="ts-block"><div class="ts-label">Выполнено</div><div class="ts-num">${done}<span class="ts-num-sub">/${total}</span></div></div>
    <div class="ts-block"><div class="ts-label">Прогресс</div>
      <div class="ts-progress-wrap">
        <div class="ts-progress-bar"><div class="ts-progress-fill" style="width:${pct}%"></div></div>
        <div class="ts-pct">${pct}%</div>
      </div>
    </div>`;

  if(!total) {
    groups.innerHTML=`<div class="empty-state"><div class="empty-icon">◈</div><div class="empty-text">Задач нет. Хороший день.</div></div>`;
    return;
  }

  // Разделяем на задачи с временем и без
  const timed=tasks.filter(t=>t.time_start).sort((a,b)=>(a.time_start||'')<(b.time_start||'')?-1:1);
  const untimed=tasks.filter(t=>!t.time_start);

  let html='';

  // ШКАЛА ВРЕМЕНИ
  if(timed.length) {
    // Зоны: 8-10 по 1ч (60px), 10-20 по 30мин (30px/30мин = 60px/час), 20-23 по 1ч (60px)
    // px на минуту в каждой зоне:
    // 8-10: 60px/60мин = 1px/мин
    // 10-20: 60px/60мин = 1px/мин (но деления каждые 30мин)
    // 20-23: 60px/60мин = 1px/мин
    // Итого одинаковый масштаб 1px/мин, но деления разные
    const PX = 1; // px на минуту
    const ZONES = [
      {start:8,  end:10, step:60},  // по часу
      {start:10, end:20, step:30},  // по полчаса
      {start:20, end:23, step:60},  // по часу
    ];
    const START_H=8, END_H=23;
    const totalMins=(END_H-START_H)*60;

    // Функция: минуты от START_H -> px
    function minsToPx(mins) { return mins*PX; }
    function timeToPx(hhmm) {
      const [h,m]=hhmm.split(':').map(Number);
      return minsToPx((h-START_H)*60+m);
    }

    const now=new Date();
    const nowMins=now.getHours()*60+now.getMinutes()-START_H*60;
    const isToday=state.filter.date==='today'||getFilteredDate()===todayStr();

    html+=`<div class="timeline-wrap">
      <div class="timeline-scale">`;

    // Метки и деления по зонам
    ZONES.forEach(zone=>{
      for(let h=zone.start; h<zone.end; h++) {
        const top=minsToPx((h-START_H)*60);
        html+=`<div class="tl-hour" style="top:${top}px">
          <span class="tl-hour-label">${String(h).padStart(2,'0')}:00</span>
          <div class="tl-hour-line"></div>
        </div>`;
        if(zone.step===30) {
          const t2=minsToPx((h-START_H)*60+30);
          html+=`<div class="tl-quarter" style="top:${t2}px">
            <span class="tl-half-label">${String(h).padStart(2,'0')}:30</span>
            <div class="tl-quarter-line tl-half"></div>
          </div>`;
        }
      }
    });
    // Последняя метка 23:00
    html+=`<div class="tl-hour" style="top:${minsToPx((END_H-START_H)*60)}px">
      <span class="tl-hour-label">${END_H}:00</span>
      <div class="tl-hour-line"></div>
    </div>`;

    if(isToday && nowMins>=0 && nowMins<=totalMins) {
      html+=`<div class="tl-now" style="top:${minsToPx(nowMins)}px"><div class="tl-now-dot"></div><div class="tl-now-line"></div></div>`;
    }

    html+=`</div><div class="timeline-events" style="height:${minsToPx(totalMins)}px">`;

    // Задачи на шкале
    timed.forEach(task=>{
      const startMins=timeToMins(task.time_start)-(START_H*60);
      const endMins=task.time_end?timeToMins(task.time_end)-(START_H*60):startMins+60;
      const top=Math.max(0,startMins*PX);
      const height=Math.max(28,(endMins-startMins)*PX);
      const isDone=task.status==='done';
      const typeColor={task:'var(--ink)',meeting:'var(--c-projects)',call:'var(--green)',trip:'var(--blue)',deadline:'var(--brick)',payment:'var(--ochre)'}[task.type]||'var(--ink)';
      const secColor=SECTION_COLORS[task.section]||'var(--ink3)';
      const ctxLabel={task:'ЗАДАЧ',meeting:'ВСТР',call:'ЗВНК',trip:'ПОЕЗД',deadline:'ДЕДЛ',payment:'ОПЛТ'}[task.type]||'ЗАДАЧ';

      html+=`<div class="tl-event ${isDone?'done':''}" style="top:${top}px;height:${height}px;border-left:3px solid ${typeColor}" data-id="${task.id}">
        <div class="tl-event-time">${task.time_start.slice(0,5)}${task.time_end?'–'+task.time_end.slice(0,5):''}</div>
        <div class="tl-event-title">${escHtml(task.title)}</div>
        ${task.travel_time?`<div class="tl-event-travel">+${task.travel_time} мин дорога</div>`:''}
        <div class="task-check tl-check ${isDone?'checked':''}" data-id="${task.id}" data-date="${curDate}">${isDone?'✓':''}</div>
      </div>`;
    });

    html+=`</div></div>`;
  }

  // ЗАДАЧИ БЕЗ ВРЕМЕНИ
  if(untimed.length) {
    const deadlines=untimed.filter(t=>['deadline','payment'].includes(t.type));
    const regular=untimed.filter(t=>!['deadline','payment'].includes(t.type));

    if(deadlines.length) {
      html+=`<div class="task-group"><div class="task-group-title">Дедлайны и оплаты</div>${deadlines.map(buildTaskCard).join('')}</div>`;
    }
    if(regular.length) {
      const secs=[...new Set(regular.map(t=>t.section))];
      secs.forEach(sec=>{
        const items=regular.filter(t=>t.section===sec);
        html+=`<div class="task-group"><div class="task-group-title">${SECTION_LABELS[sec]||sec}</div>${items.map(buildTaskCard).join('')}</div>`;
      });
    }
  }

  groups.innerHTML=html;

  // Events — шкала
  groups.querySelectorAll('.tl-event').forEach(el=>{
    el.addEventListener('click', e=>{ if(e.target.closest('.tl-check')||e.target.closest('.quick-add-sub')) return; openTaskModal(parseInt(el.dataset.id)); });
  });
  groups.querySelectorAll('.tl-check').forEach(el=>{
    el.addEventListener('click', e=>{ e.stopPropagation(); toggleTask(parseInt(el.dataset.id), el.dataset.date); });
  });
  // Events — карточки
  groups.querySelectorAll('.task-card').forEach(card=>{
    card.addEventListener('click', e=>{ if(e.target.closest('.task-check')||e.target.closest('.subtask-check')||e.target.closest('.quick-add-sub')) return; openTaskModal(parseInt(card.dataset.id)); });
  });
  groups.querySelectorAll('.task-check[data-id]').forEach(el=>{
    el.addEventListener('click', e=>{ e.stopPropagation(); toggleTask(parseInt(el.dataset.id), el.dataset.date); });
  });
  groups.querySelectorAll('.subtask-check[data-id]').forEach(el=>{
    el.addEventListener('click', e=>{ e.stopPropagation(); toggleSubtask(parseInt(el.dataset.id), el.dataset.taskId, el.dataset.date); });
  });

  // Быстрое добавление подзадачи
  groups.querySelectorAll('[data-qa-open]').forEach(btn=>{
    btn.addEventListener('click', e=>{ e.stopPropagation(); state.quickAddTaskId=parseInt(btn.dataset.qaOpen); renderTasks(); setTimeout(()=>document.getElementById('qa-inp-'+btn.dataset.qaOpen)?.focus(),50); });
  });
  groups.querySelectorAll('[data-qa-cancel]').forEach(btn=>{
    btn.addEventListener('click', e=>{ e.stopPropagation(); state.quickAddTaskId=null; renderTasks(); });
  });
  groups.querySelectorAll('[data-qa-save]').forEach(btn=>{
    btn.addEventListener('click', e=>{ e.stopPropagation(); quickAddSubtask(parseInt(btn.dataset.qaSave)); });
  });
  groups.querySelectorAll('.qa-input').forEach(inp=>{
    inp.addEventListener('keydown', e=>{ if(e.key==='Enter'){e.stopPropagation();quickAddSubtask(parseInt(inp.id.replace('qa-inp-','')))} if(e.key==='Escape'){state.quickAddTaskId=null;renderTasks();} });
  });
}

function buildTaskCard(task) {
  const dateStr = getFilteredDate() || todayStr();
  const subs = state.subtasks[task.id] || [];

  // Статус задачи — для повторяющихся берём из instances
  const instStatus = task.recurrence ? (state.instanceStatuses[task.id+'_'+dateStr] || (task.status==='done'?'done':'active')) : task.status;
  const isDone = instStatus === 'done';

  // Подзадачи — для повторяющихся берём состояние из subtaskInstances
  const subsWithState = task.recurrence
    ? subs.map(s => {
        const inst = state.instanceSubtasks[s.id+'_'+dateStr];
        return { ...s, done: inst !== undefined ? inst : false };
      })
    : subs;

  const subDone = subsWithState.filter(s=>s.done).length;
  const subPct = subsWithState.length ? Math.round(subDone/subsWithState.length*100) : null;
  const td_ = todayStr();
  const over = task.date_due && task.date_due < td_ && !isDone;
  const secColor = SECTION_COLORS[task.section] || 'var(--ink3)';
  const ctxLabel = {task:'ЗАДАЧ',meeting:'ВСТР',call:'ЗВНК',trip:'ПОЕЗД',deadline:'ДЕДЛ',payment:'ОПЛТ'}[task.type]||'ЗАДАЧ';
  const prioDots = [1,2,3].map(i=>`<div class="prio-dot ${i<=(task.priority||2)?'filled':''}"></div>`).join('');
  const urgTris = [1,2,3].map(i=>`<div class="urg-tri ${i<=(task.urgency||2)?'filled':''}"></div>`).join('');

  let subsHtml = '';
  if(subsWithState.length && !isDone) {
    subsHtml = `<div class="task-subtasks">${subsWithState.map(s=>`
      <div class="subtask-row">
        <div class="subtask-check ${s.done?'checked':''}" data-id="${s.id}" data-task-id="${task.id}" data-date="${dateStr}">${s.done?'✓':''}</div>
        <span class="subtask-title ${s.done?'done':''}">${escHtml(s.title)}</span>
      </div>`).join('')}</div>
    <div class="task-progress-row"><div class="task-progress-bar"><div class="task-progress-fill" style="width:${subPct}%"></div></div><span class="task-progress-pct">${subPct}%</span></div>`;
  }

  const isQuickAdd = state.quickAddTaskId === task.id;
  const quickAddHtml = !isDone ? `
    <div class="quick-add-sub">
      ${isQuickAdd ? `
        <div class="qa-row">
          <input type="text" class="qa-input" id="qa-inp-${task.id}" placeholder="Новый пункт...">
          <button class="qa-ok" data-qa-save="${task.id}">+</button>
          <button class="qa-cancel" data-qa-cancel="${task.id}">×</button>
        </div>` : `
        <button class="qa-btn" data-qa-open="${task.id}">+ пункт</button>`}
    </div>` : '';

  return `<div class="task-card ${isDone?'done':''}" data-id="${task.id}">
    <div class="task-author-dot"><div class="task-avatar" style="background:${secColor}18;color:${secColor}">${currentProfile?.avatar_initials||'?'}</div></div>
    <div class="task-body">
      <div class="task-title-row">
        <span class="task-ctx">${ctxLabel}</span>
        <span class="task-title">${escHtml(task.title)}</span>
        ${task.time_start?`<span class="task-time">${task.time_start.slice(0,5)}${task.time_end?'–'+task.time_end.slice(0,5):''}</span>`:''}
      </div>
      <div class="task-meta-row">
        ${task.travel_time?`<span class="task-travel">+${task.travel_time} мин дорога</span>`:''}
        ${task.date_due&&state.filter.date!=='today'&&state.filter.date!==task.date_due?`<span class="task-date-badge ${over?'overdue':''}">${over?'⚠ ':''}${fmtDateShort(task.date_due)}</span>`:''}
      </div>
      ${subsHtml}
      ${quickAddHtml}
    </div>
    <div class="task-right">
      <div class="prio-dots">${prioDots}</div>
      <div class="urg-tris">${urgTris}</div>
      <div class="task-check ${isDone?'checked':''}" data-id="${task.id}" data-date="${dateStr}">${isDone?'✓':''}</div>
    </div>
  </div>`;
}


// ─── QUICK ADD SUBTASK ───────────────────────────────────────
async function quickAddSubtask(taskId) {
  const inp = document.getElementById('qa-inp-'+taskId);
  if(!inp) return;
  const title = inp.value.trim();
  if(!title) { state.quickAddTaskId=null; renderTasks(); return; }
  const order = (state.subtasks[taskId]||[]).length;
  const {data,error} = await SB.from('bb_subtasks').insert({task_id:taskId,title,done:false,order_num:order}).select().single();
  if(!error && data) {
    if(!state.subtasks[taskId]) state.subtasks[taskId]=[];
    state.subtasks[taskId].push(data);
    showToast('Подзадача добавлена','success');
  }
  state.quickAddTaskId=null;
  renderTasks();
}


// ─── INSTANCE HELPERS ────────────────────────────────────────
function getTaskStatus(task, dateStr) {
  if(task.recurrence && dateStr) {
    const s = state.instanceStatuses[task.id+'_'+dateStr];
    return s || 'active';
  }
  return task.status;
}

function getSubtaskDone(subtask, dateStr, task) {
  if(task && task.recurrence && dateStr) {
    const v = state.instanceSubtasks[subtask.id+'_'+dateStr];
    return v !== undefined ? v : false;
  }
  return subtask.done;
}

async function setTaskInstance(taskId, dateStr, status) {
  const key = taskId+'_'+dateStr;
  state.instanceStatuses[key] = status;
  // Upsert в базу
  const {data} = await SB.from('bb_task_instances')
    .upsert({task_id:taskId, instance_date:dateStr, status}, {onConflict:'task_id,instance_date'})
    .select().single();
  if(data) state.taskInstances[key] = data;
}

async function setSubtaskInstance(subtaskId, dateStr, done) {
  const key = subtaskId+'_'+dateStr;
  state.instanceSubtasks[key] = done;
  await SB.from('bb_subtask_instances')
    .upsert({subtask_id:subtaskId, instance_date:dateStr, done}, {onConflict:'subtask_id,instance_date'});
}

// ─── TOGGLE ───────────────────────────────────────────────────
async function toggleTask(id) {
  const task=state.tasks.find(t=>t.id===id); if(!task) return;
  const dateStr = getFilteredDate() || todayStr();

  if(task.recurrence) {
    // Для повторяющихся — сохраняем статус только для этого дня
    const key = id+'_'+dateStr;
    const cur = state.instanceStatuses[key] || 'active';
    const ns = cur==='done'?'active':'done';
    state.instanceStatuses[key] = ns;
    // Upsert в bb_task_instances
    await SB.from('bb_task_instances').upsert({task_id:id, instance_date:dateStr, status:ns}, {onConflict:'task_id,instance_date'});
  } else {
    const ns=task.status==='done'?'active':'done'; task.status=ns;
    await SB.from('bb_tasks').update({status:ns}).eq('id',id);
  }
  renderTasks();
}

async function toggleSubtask(subId, taskId) {
  const tid = parseInt(taskId);
  const task = state.tasks.find(t=>t.id===tid);
  const subs = state.subtasks[tid]||[];
  const sub = subs.find(s=>s.id===subId); if(!sub) return;
  const dateStr = getFilteredDate() || todayStr();

  if(task?.recurrence) {
    // Для повторяющихся — сохраняем отметку только для этого дня
    const key = subId+'_'+dateStr;
    const cur = state.instanceSubtasks[key] !== undefined ? state.instanceSubtasks[key] : sub.done;
    const nd = !cur;
    state.instanceSubtasks[key] = nd;
    await SB.from('bb_subtask_instances').upsert({subtask_id:subId, instance_date:dateStr, done:nd}, {onConflict:'subtask_id,instance_date'});
  } else {
    sub.done = !sub.done;
    await SB.from('bb_subtasks').update({done:sub.done}).eq('id',subId);
    const allDone = subs.every(s=>s.done);
    if(task) {
      if(allDone){task.status='done';await SB.from('bb_tasks').update({status:'done'}).eq('id',tid);}
      else if(task.status==='done'){task.status='active';await SB.from('bb_tasks').update({status:'active'}).eq('id',tid);}
    }
  }
  renderTasks();
}



// ─── PROJECTS PAGE ────────────────────────────────────────────
const DESIGN_STAGES = [
  {id:'brief',      label:'Бриф'},
  {id:'concept',    label:'Концепция'},
  {id:'approval',   label:'Согласование'},
  {id:'docs',       label:'Документация'},
  {id:'supervision',label:'Надзор'},
  {id:'done',       label:'Сдан'},
];

const PROJECT_TYPES = ['HoReCa','Retail','База отдыха','Офис/БЦ','Жильё','Благоустройство','Внутренний','Другое'];
const PROJ_COLORS = ['#a84332','#534AB7','#185FA5','#1D9E75','#BA7517','#993C1D','#5F5E5A','#0f6e56'];

let projectsState = {
  selectedId: null,
  editingProject: null,
  taskView: 'list', // 'list' | 'kanban'
};

function renderProjectsPage() {
  const page = document.getElementById('page-projects');
  if(!page || !page.classList.contains('active')) return;
  try {
    if(projectsState.selectedId) renderProjectDetail(page);
    else renderProjectsBoard(page);
  } catch(err) {
    console.error('renderProjectsPage:', err);
    page.innerHTML = '<div class="page-stub"><div class="stub-label">Ошибка: '+err.message+'</div></div>';
  }
}

// ── BOARD VIEW ────────────────────────────────────────────────
function renderProjectsBoard(page) {
  const projects = (state.projects||[]).filter(p=>p.status!=='archived');

  let html = '<div class="tp-header">';
  html += '<div class="tp-title">ПРОЕКТЫ</div>';
  html += '<div class="tp-stats"><span>'+projects.length+' проектов</span></div>';
  html += '<button class="btn-add-task" id="btn-add-proj">+ ПРОЕКТ</button>';
  html += '</div>';

  if(!projects.length) {
    html += '<div class="empty-state"><div class="empty-icon">▤</div><div class="empty-text">Нет проектов. Добавьте первый.</div></div>';
  } else {
    html += '<div class="proj-board">';
    projects.forEach(p => { html += buildProjectColumn(p); });
    // Колонка добавления нового проекта
    html += '<div class="proj-col proj-col-new"><button class="proj-new-col-btn" id="btn-add-proj-2">+ Новый проект</button></div>';
    html += '</div>';
  }

  if(projectsState.editingProject !== null) html += buildProjectModal();
  page.innerHTML = html;
  bindProjectsBoard(page);
  if(projectsState.editingProject !== null) bindProjectModal(page);
}

function buildProjectColumn(p) {
  const tasks = (state.tasks||[]).filter(t=>t.project_id===p.id && t.status!=='done');
  const doneTasks = (state.tasks||[]).filter(t=>t.project_id===p.id && t.status==='done');
  const total = tasks.length + doneTasks.length;
  const pct = total ? Math.round(doneTasks.length/total*100) : 0;
  const color = p.color || '#a84332';
  const over = p.end_date && p.end_date < todayStr();
  const stageLabel = DESIGN_STAGES.find(s=>s.id===(p.stage||'brief'))?.label||'Бриф';

  let html = '<div class="proj-col" data-proj-col="'+p.id+'">';

  // Заголовок колонки
  html += '<div class="proj-col-header" style="border-top:3px solid '+color+'">';
  html += '<div class="proj-col-header-main">';
  html += '<div class="proj-col-name" data-open-proj="'+p.id+'">'+escHtml(p.name)+'</div>';
  html += '<button class="proj-edit-btn" data-edit-proj="'+p.id+'">···</button>';
  html += '</div>';
  if(p.client) html += '<div class="proj-col-client">'+escHtml(p.client)+'</div>';
  html += '<div class="proj-col-meta">';
  html += '<span class="proj-stage-badge" style="color:'+color+';border-color:'+color+'33;background:'+color+'11">'+stageLabel+'</span>';
  if(over) html += '<span class="proj-date over">⚠ '+fmtDateShort(p.end_date)+'</span>';
  else if(p.end_date) html += '<span class="proj-date">до '+fmtDateShort(p.end_date)+'</span>';
  html += '</div>';
  if(total>0) {
    html += '<div class="proj-progress-row">';
    html += '<div class="proj-progress-bar"><div class="proj-progress-fill" style="width:'+pct+'%;background:'+color+'"></div></div>';
    html += '<span class="proj-pct">'+doneTasks.length+'/'+total+'</span>';
    html += '</div>';
  }
  html += '</div>';

  // Задачи
  html += '<div class="proj-col-tasks">';
  tasks.slice(0,10).forEach(t => {
    const taskOver = t.date_due && t.date_due < todayStr();
    html += '<div class="proj-task-row" data-tid="'+t.id+'">';
    html += '<div class="task-check" data-id="'+t.id+'"></div>';
    html += '<div class="proj-task-body">';
    html += '<div class="proj-task-title">'+escHtml(t.title)+'</div>';
    if(t.date_due) html += '<div class="proj-task-date'+(taskOver?' over':'')+'">'+fmtDateShort(t.date_due)+'</div>';
    html += '</div>';
    const prioDot = t.priority===1?'var(--red)':t.priority===3?'var(--green)':'var(--ochre)';
    html += '<div style="width:6px;height:6px;border-radius:50%;background:'+prioDot+';flex-shrink:0"></div>';
    html += '</div>';
  });
  if(tasks.length>10) html += '<div class="proj-col-more">+ ещё '+(tasks.length-10)+'</div>';
  if(doneTasks.length>0) html += '<div class="proj-col-done-cnt">✓ '+doneTasks.length+' выполнено</div>';
  if(!tasks.length && !doneTasks.length) html += '<div class="kb-empty">нет задач</div>';

  // Кнопка добавить задачу
  html += '<button class="proj-add-task-btn" data-add-task-proj="'+p.id+'">+ задача</button>';
  html += '</div>';

  html += '</div>';
  return html;
}

function bindProjectsBoard(page) {
  page.querySelector('#btn-add-proj')?.addEventListener('click',()=>{
    projectsState.editingProject={color:PROJ_COLORS[0]};renderProjectsPage();
  });
  page.querySelector('#btn-add-proj-2')?.addEventListener('click',()=>{
    projectsState.editingProject={color:PROJ_COLORS[0]};renderProjectsPage();
  });

  page.querySelectorAll('[data-open-proj]').forEach(el=>{
    el.addEventListener('click',e=>{
      e.stopPropagation();
      projectsState.selectedId=parseInt(el.dataset.openProj);
      renderProjectsPage();
    });
  });

  page.querySelectorAll('[data-edit-proj]').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      const p=(state.projects||[]).find(x=>x.id===parseInt(btn.dataset.editProj));
      projectsState.editingProject=p?Object.assign({},p):{color:PROJ_COLORS[0]};
      renderProjectsPage();
    });
  });

  page.querySelectorAll('[data-add-task-proj]').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      const projId=parseInt(btn.dataset.addTaskProj);
      openTaskModal(null);
      setTimeout(()=>{
        const s=document.getElementById('f-section');
        if(s){s.value='projects';s.dispatchEvent(new Event('change'));}
        const pr=document.getElementById('f-project');
        if(pr) pr.value=String(projId);
      },50);
    });
  });

  page.querySelectorAll('.proj-task-row[data-tid]').forEach(el=>{
    el.addEventListener('click',e=>{
      if(e.target.closest('.task-check'))return;
      openTaskModal(parseInt(el.dataset.tid));
    });
  });

  page.querySelectorAll('.proj-col .task-check[data-id]').forEach(el=>{
    el.addEventListener('click',e=>{
      e.stopPropagation();
      toggleTask(parseInt(el.dataset.id)).then(()=>renderProjectsPage());
    });
  });
}

// ── DETAIL VIEW ───────────────────────────────────────────────
function renderProjectDetail(page) {
  const p=(state.projects||[]).find(x=>x.id===projectsState.selectedId);
  if(!p){projectsState.selectedId=null;renderProjectsPage();return;}

  const tasks=(state.tasks||[]).filter(t=>t.project_id===p.id);
  const done=tasks.filter(t=>t.status==='done').length;
  const pct=tasks.length?Math.round(done/tasks.length*100):0;
  const color=p.color||'#a84332';
  const view=projectsState.taskView;

  let html='<div class="tp-header">';
  html+='<button class="btn-secondary" id="proj-back" style="font-size:10px">← Проекты</button>';
  html+='<div class="proj-detail-title" style="color:'+color+'">'+escHtml(p.name)+'</div>';
  html+='<div class="tp-view-toggle"><button class="tv-btn'+(view==='list'?' active':'')+'" data-pview="list">СПИСОК</button><button class="tv-btn'+(view==='kanban'?' active':'')+'" data-pview="kanban">ЭТАПЫ</button></div>';
  html+='<button class="btn-secondary" id="btn-edit-this-proj" style="font-size:10px">Редактировать</button>';
  html+='<button class="btn-add-task" id="btn-add-proj-task">+ ЗАДАЧА</button>';
  html+='</div>';

  // Info bar
  html+='<div class="proj-info-bar">';
  if(p.client) html+='<div class="proj-info-item"><div class="proj-info-label">КЛИЕНТ</div><div>'+escHtml(p.client)+'</div></div>';
  if(p.type) html+='<div class="proj-info-item"><div class="proj-info-label">ТИП</div><div>'+escHtml(p.type)+'</div></div>';
  if(p.area) html+='<div class="proj-info-item"><div class="proj-info-label">ПЛОЩАДЬ</div><div>'+p.area+' м²</div></div>';
  if(p.budget) html+='<div class="proj-info-item"><div class="proj-info-label">БЮДЖЕТ</div><div>'+Number(p.budget).toLocaleString('ru')+' ₽</div></div>';
  if(p.end_date) html+='<div class="proj-info-item"><div class="proj-info-label">ДЕДЛАЙН</div><div class="'+(p.end_date<todayStr()?'over':'')+'">'+fmtDateShort(p.end_date)+'</div></div>';
  if(tasks.length) {
    html+='<div class="proj-info-item"><div class="proj-info-label">ПРОГРЕСС</div>';
    html+='<div class="proj-progress-row" style="width:130px"><div class="proj-progress-bar"><div class="proj-progress-fill" style="width:'+pct+'%;background:'+color+'"></div></div><span class="proj-pct">'+done+'/'+tasks.length+'</span></div></div>';
  }
  // Стадия
  html+='<div class="proj-info-item"><div class="proj-info-label">СТАДИЯ</div>';
  html+='<select id="proj-stage-sel" class="tp-sel" style="font-size:10px">';
  DESIGN_STAGES.forEach(s=>{html+='<option value="'+s.id+'"'+((p.stage||'brief')===s.id?' selected':'')+'>'+s.label+'</option>';});
  html+='</select></div>';
  html+='</div>';

  if(p.notes) html+='<div class="proj-notes-block">'+escHtml(p.notes)+'</div>';

  // Tasks
  if(view==='list') {
    html+='<div class="proj-task-list">';
    const active=tasks.filter(t=>t.status!=='done');
    const doneT=tasks.filter(t=>t.status==='done');
    active.sort((a,b)=>(a.priority||3)-(b.priority||3));
    if(active.length) {
      active.forEach(t=>{html+=buildProjTaskRow(t,color);});
    }
    if(doneT.length) {
      html+='<div class="tl-group-title" style="margin-top:16px">ВЫПОЛНЕНО <span class="tl-count">'+doneT.length+'</span></div>';
      doneT.forEach(t=>{html+=buildProjTaskRow(t,color);});
    }
    if(!tasks.length) html+='<div class="empty-state"><div class="empty-icon">◈</div><div class="empty-text">Нет задач по проекту</div></div>';
    html+='</div>';
  } else {
    // Канбан по этапам
    html+='<div class="kb-board proj-kanban">';
    DESIGN_STAGES.forEach(stage=>{
      const st=tasks.filter(t=>(t.stage||'brief')===stage.id);
      const sc=stage.id==='done'?'var(--green)':color;
      html+='<div class="kb-col"><div class="kb-col-header"><div class="kb-col-dot" style="background:'+sc+'"></div><span class="kb-col-title">'+stage.label+'</span><span class="kb-col-cnt">'+st.length+'</span></div>';
      html+='<div class="kb-col-body" ondragover="event.preventDefault();this.classList.add(\'kb-drag-over\')" ondragleave="this.classList.remove(\'kb-drag-over\')" ondrop="projKbDrop(event,\''+stage.id+'\')">';
      st.forEach(t=>{
        const isDone=t.status==='done';
        html+='<div class="kb-card'+(isDone?' done':'')+'" draggable="true" data-tid="'+t.id+'" ondragstart="projKbDragStart(event,'+t.id+')">';
        html+='<div class="kb-card-bar" style="background:'+sc+'"></div>';
        html+='<div class="kb-card-body"><div class="task-check'+(isDone?' checked':'')+'" data-id="'+t.id+'">'+(isDone?'✓':'')+'</div>';
        html+='<div class="kb-card-title">'+escHtml(t.title)+'</div></div>';
        if(t.date_due) html+='<div class="kb-card-footer"><span class="tl-date" style="font-size:9px">'+fmtDateShort(t.date_due)+'</span></div>';
        html+='</div>';
      });
      if(!st.length) html+='<div class="kb-empty">пусто</div>';
      html+='</div></div>';
    });
    html+='</div>';
  }

  if(projectsState.editingProject!==null) html+=buildProjectModal();
  page.innerHTML=html;

  page.querySelector('#proj-back')?.addEventListener('click',()=>{projectsState.selectedId=null;renderProjectsPage();});
  page.querySelector('#btn-edit-this-proj')?.addEventListener('click',()=>{projectsState.editingProject=Object.assign({},p);renderProjectsPage();});
  page.querySelector('#btn-add-proj-task')?.addEventListener('click',()=>{
    openTaskModal(null);
    setTimeout(()=>{
      const s=document.getElementById('f-section');
      if(s){s.value='projects';s.dispatchEvent(new Event('change'));}
      const pr=document.getElementById('f-project');
      if(pr) pr.value=String(p.id);
    },50);
  });
  page.querySelectorAll('[data-pview]').forEach(btn=>{
    btn.addEventListener('click',()=>{projectsState.taskView=btn.dataset.pview;renderProjectsPage();});
  });
  page.querySelector('#proj-stage-sel')?.addEventListener('change',async e=>{
    await SB.from('projects').update({stage:e.target.value}).eq('id',p.id);
    p.stage=e.target.value;
  });
  page.querySelectorAll('[data-tid]').forEach(el=>{
    el.addEventListener('click',e=>{if(e.target.closest('.task-check'))return;openTaskModal(parseInt(el.dataset.tid));});
  });
  page.querySelectorAll('.task-check[data-id]').forEach(el=>{
    el.addEventListener('click',e=>{e.stopPropagation();toggleTask(parseInt(el.dataset.id)).then(()=>renderProjectsPage());});
  });
  if(projectsState.editingProject!==null) bindProjectModal(page);
}

function buildProjTaskRow(t, color) {
  const isDone=t.status==='done';
  const over=t.date_due&&t.date_due<todayStr()&&!isDone;
  const subs=state.subtasks[t.id]||[];
  const subDone=subs.filter(s=>s.done).length;
  const pct=subs.length?Math.round(subDone/subs.length*100):null;

  let html='<div class="tl-row'+(isDone?' done':'')+(over?' overdue':'')+'" data-tid="'+t.id+'">';
  html+='<div class="task-check'+(isDone?' checked':'')+'" data-id="'+t.id+'">'+(isDone?'✓':'')+'</div>';
  html+='<div class="tl-bar" style="background:'+color+'"></div>';
  html+='<div class="tl-body"><div class="tl-title">'+escHtml(t.title)+'</div>';
  if(pct!==null) html+='<div class="tl-progress"><div class="tl-progress-fill" style="width:'+pct+'%"></div><span class="tl-pct">'+subDone+'/'+subs.length+'</span></div>';
  html+='</div>';
  html+='<div class="tl-meta">';
  if(t.date_due) html+='<span class="tl-date'+(over?' over':'')+'">'+fmtDateShort(t.date_due)+'</span>';
  html+='</div></div>';
  return html;
}

let _projDragId=null;
window.projKbDragStart=function(e,id){_projDragId=id;e.dataTransfer.effectAllowed='move';};
window.projKbDrop=async function(e,stage){
  e.preventDefault();e.currentTarget.classList.remove('kb-drag-over');
  if(!_projDragId)return;
  const task=(state.tasks||[]).find(t=>t.id===_projDragId);
  if(!task)return;
  task.stage=stage;
  if(stage==='done')task.status='done';
  await SB.from('bb_tasks').update({stage,status:task.status}).eq('id',_projDragId);
  _projDragId=null;
  renderProjectsPage();
};

// ── MODAL ─────────────────────────────────────────────────────
function buildProjectModal() {
  const p=projectsState.editingProject;
  if(p===null||p===undefined)return'';
  const isNew=!p.id;
  const color=p.color||PROJ_COLORS[0];

  let html='<div class="modal-overlay" id="proj-modal-ov"><div class="modal">';
  html+='<div class="modal-header"><div class="modal-title">'+(isNew?'НОВЫЙ ПРОЕКТ':'РЕДАКТИРОВАТЬ')+'</div>';
  html+='<button class="modal-close" id="proj-modal-close">✕</button></div>';
  html+='<div class="modal-body">';
  html+='<div class="mf-row"><input type="text" id="pm-name" class="f-title-input" placeholder="Название..." value="'+escHtml(p.name||'')+'"></div>';
  html+='<div class="mf-2col">';
  html+='<div class="mf-field"><label class="mf-label">Клиент</label><input type="text" id="pm-client" class="f-input" value="'+escHtml(p.client||'')+'"></div>';
  html+='<div class="mf-field"><label class="mf-label">Тип</label><select id="pm-type" class="f-select">';
  PROJECT_TYPES.forEach(t=>{html+='<option'+(p.type===t?' selected':'')+'>'+t+'</option>';});
  html+='</select></div></div>';
  html+='<div class="mf-2col">';
  html+='<div class="mf-field"><label class="mf-label">Площадь</label><input type="text" id="pm-area" class="f-input" placeholder="120 м²" value="'+(p.area||'')+'"></div>';
  html+='<div class="mf-field"><label class="mf-label">Бюджет ₽</label><input type="text" id="pm-budget" class="f-input" value="'+(p.budget||'')+'"></div>';
  html+='</div>';
  html+='<div class="mf-2col">';
  html+='<div class="mf-field"><label class="mf-label">Старт</label><input type="date" id="pm-start" class="f-input" value="'+(p.start_date||'')+'"></div>';
  html+='<div class="mf-field"><label class="mf-label">Дедлайн</label><input type="date" id="pm-end" class="f-input" value="'+(p.end_date||'')+'"></div>';
  html+='</div>';
  html+='<div class="mf-field"><label class="mf-label">Стадия</label><select id="pm-stage" class="f-select">';
  DESIGN_STAGES.forEach(s=>{html+='<option value="'+s.id+'"'+((p.stage||'brief')===s.id?' selected':'')+'>'+s.label+'</option>';});
  html+='</select></div>';
  html+='<div class="mf-row"><label class="mf-label">Заметки</label><textarea id="pm-notes" class="f-textarea">'+escHtml(p.notes||'')+'</textarea></div>';
  html+='<div class="mf-field"><label class="mf-label">Цвет</label><div style="display:flex;gap:6px;flex-wrap:wrap">';
  PROJ_COLORS.forEach(col=>{html+='<div class="color-swatch'+(color===col?' active':'')+'" data-color="'+col+'" style="background:'+col+'"></div>';});
  html+='</div></div>';
  if(!isNew){
    html+='<div class="mf-field"><label class="mf-label">Статус</label><select id="pm-status" class="f-select">';
    [['active','Активный'],['done','Завершён'],['archived','Архив']].forEach(([v,l])=>{html+='<option value="'+v+'"'+((p.status||'active')===v?' selected':'')+'>'+l+'</option>';});
    html+='</select></div>';
  }
  html+='</div>';
  html+='<div class="modal-footer">';
  html+='<div class="modal-footer-left">'+(isNew?'':`<button class="btn-delete" id="pm-delete">Удалить</button>`)+'</div>';
  html+='<div class="modal-footer-right"><button class="btn-secondary" id="pm-cancel">Отмена</button><button class="btn-primary" id="pm-save">Сохранить</button></div>';
  html+='</div></div></div>';
  return html;
}

function bindProjectModal(page) {
  let pickedColor=projectsState.editingProject?.color||PROJ_COLORS[0];
  page.querySelector('#proj-modal-ov')?.addEventListener('click',e=>{if(e.target.id==='proj-modal-ov'){projectsState.editingProject=null;renderProjectsPage();}});
  page.querySelector('#proj-modal-close')?.addEventListener('click',()=>{projectsState.editingProject=null;renderProjectsPage();});
  page.querySelector('#pm-cancel')?.addEventListener('click',()=>{projectsState.editingProject=null;renderProjectsPage();});
  page.querySelectorAll('[data-color]').forEach(sw=>{
    sw.addEventListener('click',()=>{pickedColor=sw.dataset.color;page.querySelectorAll('[data-color]').forEach(s=>s.classList.toggle('active',s.dataset.color===pickedColor));});
  });
  page.querySelector('#pm-save')?.addEventListener('click',async()=>{
    const name=document.getElementById('pm-name')?.value.trim();
    if(!name){showToast('Введите название','error');return;}
    const data={name,client:document.getElementById('pm-client')?.value||null,type:document.getElementById('pm-type')?.value||null,area:document.getElementById('pm-area')?.value||null,budget:document.getElementById('pm-budget')?.value?.replace(/\s/g,'')||null,start_date:document.getElementById('pm-start')?.value||null,end_date:document.getElementById('pm-end')?.value||null,stage:document.getElementById('pm-stage')?.value||'brief',notes:document.getElementById('pm-notes')?.value||null,status:document.getElementById('pm-status')?.value||'active',color:pickedColor};
    const p=projectsState.editingProject;
    if(p?.id){
      const{error}=await SB.from('projects').update(data).eq('id',p.id);
      if(error){showToast('Ошибка: '+error.message,'error');return;}
      const idx=(state.projects||[]).findIndex(x=>x.id===p.id);
      if(idx>=0)Object.assign(state.projects[idx],data);
    } else {
      const{data:saved,error}=await SB.from('projects').insert(data).select().single();
      if(error){showToast('Ошибка: '+error.message,'error');return;}
      if(saved){if(!state.projects)state.projects=[];state.projects.push(saved);}
    }
    projectsState.editingProject=null;
    renderProjectsPage();
    showToast(p?.id?'Проект обновлён':'Проект создан','success');
  });
  page.querySelector('#pm-delete')?.addEventListener('click',async()=>{
    if(!confirm('Удалить проект?'))return;
    const p=projectsState.editingProject;
    await SB.from('projects').delete().eq('id',p.id);
    state.projects=(state.projects||[]).filter(x=>x.id!==p.id);
    projectsState.editingProject=null;projectsState.selectedId=null;
    renderProjectsPage();showToast('Проект удалён');
  });
}


// ─── GANTT PAGE (frappe-gantt) ───────────────────────────────
let ganttState = {
  period: 'Month',
  instance: null,
};

function ensureFrappeGantt(cb) {
  if(!document.querySelector('link[data-frappe-css]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/frappe-gantt@0.6.1/dist/frappe-gantt.css';
    link.dataset.frappeCss = '1';
    document.head.appendChild(link);
  }
  if(window.Gantt) { cb(); return; }
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/frappe-gantt@0.6.1/dist/frappe-gantt.min.js';
  script.onload = cb;
  script.onerror = () => showToast('Не удалось загрузить библиотеку Ганта', 'error');
  document.head.appendChild(script);
}

function renderGanttPage() {
  const page = document.getElementById('page-gantt');
  if(!page || !page.classList.contains('active')) return;

  page.innerHTML = `
    <div class="tp-header">
      <div class="tp-title">ГАНТ</div>
      <div class="gantt-period-toggle">
        <button class="gp-btn ${ganttState.period==='Day'?'active':''}" data-gperiod="Day">ДЕНЬ</button>
        <button class="gp-btn ${ganttState.period==='Week'?'active':''}" data-gperiod="Week">НЕДЕЛЯ</button>
        <button class="gp-btn ${ganttState.period==='Month'?'active':''}" data-gperiod="Month">МЕСЯЦ</button>
        <button class="gp-btn ${ganttState.period==='Quarter Year'?'active':''}" data-gperiod="Quarter Year">КВАРТАЛ</button>
      </div>
    </div>
    <div id="gantt-container" style="flex:1;overflow:auto;padding:16px;background:var(--paper)">
      <p id="gantt-loading" style="text-align:center;padding:40px;color:var(--ink3);font-size:11px;letter-spacing:.06em">ЗАГРУЗКА...</p>
      <svg id="gantt-svg"></svg>
    </div>
  `;

  page.querySelectorAll('[data-gperiod]').forEach(btn => {
    btn.addEventListener('click', () => {
      ganttState.period = btn.dataset.gperiod;
      renderGanttPage();
    });
  });

  ensureFrappeGantt(() => initFrappeGantt(page));
}

function buildFrappeTasks() {
  const tasks = [];

  state.projects.forEach(p => {
    const projTasks = state.tasks.filter(t => t.project_id === p.id && t.date_due);
    if(!projTasks.length) return;
    const dates = projTasks.map(t => t.date_due).sort();
    const startD = p.start_date || dates[0];
    const endD = p.end_date || dates[dates.length-1];
    const done = projTasks.filter(t=>t.status==='done').length;
    tasks.push({
      id: 'proj_' + p.id,
      name: p.name,
      start: startD,
      end: endD,
      progress: Math.round(done/projTasks.length*100),
      custom_class: 'proj-bar',
      _color: p.color || '#a84332',
      _type: 'project',
      _origId: p.id,
    });
    projTasks.forEach(t => {
      const start = t.created_at ? t.created_at.slice(0,10) : t.date_due;
      const s = start < t.date_due ? start : t.date_due;
      tasks.push({
        id: 'task_' + t.id,
        name: '\u00a0\u00a0\u2514 ' + t.title,
        start: s,
        end: t.date_due,
        progress: t.status==='done' ? 100 : 0,
        dependencies: t.depends_on ? 'task_' + t.depends_on : '',
        custom_class: 'task-bar' + (t.status==='done'?' done':''),
        _color: SECTION_COLORS[t.section] || '#3d3d3a',
        _type: 'task',
        _origId: t.id,
      });
    });
  });

  state.tasks.filter(t => !t.project_id && t.date_due).forEach(t => {
    const start = t.created_at ? t.created_at.slice(0,10) : t.date_due;
    const s = start < t.date_due ? start : t.date_due;
    tasks.push({
      id: 'task_' + t.id,
      name: t.title,
      start: s,
      end: t.date_due,
      progress: t.status==='done' ? 100 : 0,
      dependencies: t.depends_on ? 'task_' + t.depends_on : '',
      custom_class: 'task-bar' + (t.status==='done'?' done':''),
      _color: SECTION_COLORS[t.section] || '#3d3d3a',
      _type: 'task',
      _origId: t.id,
    });
  });

  return tasks;
}

function initFrappeGantt(page) {
  const loading = document.getElementById('gantt-loading');
  const svgEl = document.getElementById('gantt-svg');
  if(!svgEl) return;

  const tasks = buildFrappeTasks();
  if(!tasks.length) {
    if(loading) { loading.textContent = 'Нет задач с датами. Добавьте задачи с дедлайном.'; }
    return;
  }
  if(loading) loading.style.display = 'none';

  try {
    ganttState.instance = new Gantt('#gantt-svg', tasks, {
      view_mode: ganttState.period,
      date_format: 'YYYY-MM-DD',
      popup_trigger: 'click',
      custom_popup_html: function(task) {
        const orig = task._type==='task'
          ? state.tasks.find(t=>t.id===task._origId)
          : state.projects.find(p=>p.id===task._origId);
        if(!orig) return '<div class="gantt-popup">...</div>';
        const name = orig.name||orig.title||'';
        const date = task._type==='task' ? orig.date_due : orig.end_date;
        return '<div class="gantt-popup">'
          + '<div class="gantt-popup-title">' + escHtml(name) + '</div>'
          + (date ? '<div class="gantt-popup-meta">Дедлайн: ' + fmtDateShort(date) + '</div>' : '')
          + '<button class="gantt-popup-btn" onclick="ganttOpenEdit(\'' + task._type + '\',' + task._origId + ')">Редактировать</button>'
          + '</div>';
      },
      on_date_change: async function(task, start, end) {
        const endStr = end.toISOString().slice(0,10);
        const startStr = start.toISOString().slice(0,10);
        if(task._type === 'task') {
          const t = state.tasks.find(x=>x.id===task._origId);
          if(t) { t.date_due=endStr; await SB.from('bb_tasks').update({date_due:endStr}).eq('id',t.id); showToast('Дата обновлена','success'); }
        } else {
          const p = state.projects.find(x=>x.id===task._origId);
          if(p) { p.end_date=endStr; p.start_date=startStr; await SB.from('projects').update({end_date:endStr,start_date:startStr}).eq('id',p.id); showToast('Проект обновлён','success'); }
        }
      },
      on_progress_change: async function(task, progress) {
        if(task._type === 'task') {
          const t = state.tasks.find(x=>x.id===task._origId);
          if(t) { const ns=progress>=100?'done':'active'; t.status=ns; await SB.from('bb_tasks').update({status:ns}).eq('id',t.id); }
        }
      },
    });

    // Раскрашиваем бары в цвета разделов/проектов
    setTimeout(() => {
      tasks.forEach(task => {
        const barEl = document.querySelector('.bar-wrapper[data-id="' + task.id + '"] .bar');
        if(barEl && task._color) {
          barEl.style.fill = task._color + (task._type==='project' ? '22' : '33');
          barEl.style.stroke = task._color;
          barEl.style.strokeWidth = task._type==='project' ? '2' : '1.5';
        }
      });
    }, 200);

  } catch(err) {
    console.error('frappe-gantt error:', err);
    if(loading) { loading.style.display='block'; loading.textContent = 'Ошибка Ганта: ' + err.message; }
  }
}

window.ganttOpenEdit = function(type, id) {
  if(type==='task') openTaskModal(parseInt(id));
  else {
    const p = state.projects.find(x=>x.id===parseInt(id));
    if(p) { projectsState.editingProject={...p}; renderProjectsPage(); }
  }
};

// ─── GOALS PAGE ───────────────────────────────────────────────
// ─── GOALS PAGE ───────────────────────────────────────────────
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

let goalsState = {
  editingGoal: null,
  chatGoalId: null,
  chatHistory: {}, // goalId -> messages[]
  aiLoading: false,
  apiKey: localStorage.getItem('bb-ai-key') || '',
};

function renderGoalsPage() {
  const page = document.getElementById('page-goals');
  if(!page || !page.classList.contains('active')) return;
  try {
    if(!state.goals) state.goals = [];
    const goals = state.goals;
    const hasKey = !!goalsState.apiKey;

    let html = `<div class="tp-header">
      <div class="tp-title">ЦЕЛИ</div>
      <div class="tp-stats"><span>${goals.length} целей</span></div>
      ${!hasKey
        ? `<button class="btn-secondary" id="btn-set-apikey" style="font-size:10px">✦ API ключ Claude</button>`
        : `<span style="font-size:10px;color:var(--green)">✦ Claude подключён</span>`}
      <button class="btn-add-task" id="btn-add-goal">+ ЦЕЛЬ</button>
    </div>`;

    if(!hasKey) {
      html += `<div class="goals-api-notice">
        <div class="gan-icon">✦</div>
        <div>
          <div style="font-size:12px;font-weight:600;margin-bottom:4px">Подключите Claude для работы с целями</div>
          <div style="font-size:11px;color:var(--ink3)">AI задаст уточняющие вопросы, декомпозирует цель и встроит шаги в расписание</div>
          <button class="btn-secondary" id="btn-set-apikey-2" style="margin-top:8px;font-size:10px">Добавить API ключ →</button>
        </div>
      </div>`;
    }

    html += `<div class="goals-list" id="goals-list">`;
    if(goals.length) {
      goals.forEach(g => { html += buildGoalCard(g); });
    } else {
      html += `<div class="empty-state"><div class="empty-icon">◎</div><div class="empty-text">Нет целей. Поставьте первую.</div></div>`;
    }
    html += `</div>`;

    if(goalsState.chatGoalId) html += buildGoalChat(goalsState.chatGoalId);
    if(goalsState.editingGoal !== null) html += buildGoalModal();

    page.innerHTML = html;

    page.querySelector('#btn-add-goal')?.addEventListener('click', () => { goalsState.editingGoal={}; renderGoalsPage(); });
    page.querySelector('#btn-set-apikey')?.addEventListener('click', promptApiKey);
    page.querySelector('#btn-set-apikey-2')?.addEventListener('click', promptApiKey);

    page.querySelectorAll('[data-goal-id]').forEach(el => {
      el.addEventListener('click', e => {
        if(e.target.closest('.goal-btn')) return;
        const id = parseInt(el.dataset.goalId);
        goalsState.chatGoalId = id;
        renderGoalsPage();
        // Начинаем новый диалог только если истории нет
        if(goalsState.apiKey && !goalsState.chatHistory[id]?.length) {
          setTimeout(() => startGoalChat(id), 100);
        }
      });
    });
    page.querySelectorAll('[data-edit-goal]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const g = (state.goals||[]).find(x=>x.id===parseInt(btn.dataset.editGoal));
        goalsState.editingGoal = g ? Object.assign({},g) : {};
        renderGoalsPage();
      });
    });
    page.querySelectorAll('[data-done-goal]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); completeGoal(parseInt(btn.dataset.doneGoal)); });
    });

    bindGoalChat(page);
    bindGoalModal(page);

    page.querySelectorAll('[data-sub-id]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        toggleSubtask(parseInt(el.dataset.subId), el.dataset.goalId);
      });
    });

  } catch(err) {
    console.error('renderGoalsPage:', err);
    page.innerHTML = '<div class="page-stub"><div class="stub-icon">!</div><div class="stub-label">Ошибка: '+err.message+'</div></div>';
  }
}

function buildGoalCard(g) {
  const steps = state.subtasks[g.id] || [];
  const doneSteps = steps.filter(s=>s.done).length;
  const pct = steps.length ? Math.round(doneSteps/steps.length*100) : 0;
  const isDone = g.status === 'done';
  const over = g.deadline && g.deadline < todayStr() && !isDone;
  const SCOLORS = {bureau:'var(--c-bureau)',projects:'var(--c-projects)',marketing:'var(--c-marketing)',finance:'var(--c-finance)',growth:'var(--c-growth)',partners:'var(--c-partners)'};
  const color = SCOLORS[g.section] || 'var(--brick)';

  let html = '<div class="goal-card'+(isDone?' done':'')+'" data-goal-id="'+g.id+'">';
  html += '<div class="goal-card-accent" style="background:'+color+'"></div>';
  html += '<div class="goal-card-body">';
  html += '<div class="goal-card-header"><div class="goal-title">'+escHtml(g.title)+'</div>';
  html += '<div class="goal-actions">';
  if(!isDone) html += '<button class="goal-btn" data-done-goal="'+g.id+'">✓</button>';
  html += '<button class="goal-btn" data-edit-goal="'+g.id+'">···</button>';
  html += '</div></div>';
  html += '<div class="goal-meta">';
  if(g.section) html += '<span class="proj-stage-badge" style="color:'+color+';border-color:'+color+'22;background:'+color+'10">'+(SECTION_LABELS[g.section]||g.section)+'</span>';
  if(g.deadline) html += '<span class="proj-date'+(over?' over':'')+'">'+(over?'⚠ ':'')+'до '+fmtDateShort(g.deadline)+'</span>';
  if(isDone) html += '<span style="color:var(--green);font-size:10px;font-weight:600">✓ Достигнута</span>';
  html += '</div>';
  if(g.notes) html += '<div class="goal-notes">'+escHtml(g.notes)+'</div>';
  if(steps.length) {
    html += '<div class="goal-progress"><div class="proj-progress-bar"><div class="proj-progress-fill" style="width:'+pct+'%;background:'+color+'"></div></div><span class="proj-pct">'+doneSteps+'/'+steps.length+' шагов</span></div>';
    html += '<div class="goal-steps">';
    steps.slice(0,3).forEach(s => {
      html += '<div class="goal-step'+(s.done?' done':'')+'"><div class="subtask-check'+(s.done?' checked':'')+'" data-sub-id="'+s.id+'" data-goal-id="'+g.id+'">'+(s.done?'✓':'')+'</div><span>'+escHtml(s.title)+'</span></div>';
    });
    if(steps.length>3) html += '<div class="goal-step-more">+ ещё '+(steps.length-3)+' шагов</div>';
    html += '</div>';
  } else {
    html += '<div class="goal-ai-hint">Нажмите чтобы начать диалог с Claude ✦</div>';
  }
  html += '</div></div>';
  return html;
}

function buildGoalChat(goalId) {
  const g = (state.goals||[]).find(x=>x.id===goalId);
  if(!g) return '';
  let html = '<div class="goal-chat-panel" id="goal-chat">';
  html += '<div class="gcp-header"><div class="gcp-title">✦ Claude помогает с целью</div>';
  html += '<div class="gcp-goal-name">'+escHtml(g.title)+'</div>';
  html += '<div style="display:flex;gap:6px;margin-top:8px">';
  html += '<button class="btn-secondary" id="gcp-new" style="font-size:10px;padding:4px 10px">Новый диалог</button>';
  html += '<button class="gsp-close" id="gcp-close" style="margin-left:auto">✕</button>';
  html += '</div></div>';
  html += '<div class="gcp-messages" id="gcp-messages">';
  const msgs = goalsState.chatHistory[goalId] || [];
  msgs.forEach(m => {
    html += '<div class="gcp-msg '+m.role+'">';
    html += '<div class="gcp-msg-label">'+(m.role==='user'?'Вы':'Claude ✦')+'</div>';
    html += '<div class="gcp-msg-text">'+(m.role==='assistant'?m.content.replace(/\n/g,'<br>'):escHtml(m.content))+'</div>';
    if(m.tasks && m.tasks.length) {
      html += '<div class="gcp-tasks"><div class="gcp-tasks-title">Предложенные шаги:</div>';
      m.tasks.forEach((t,i) => {
        html += '<div class="gcp-task-item"><span class="gcp-task-num">'+(i+1)+'</span><span>'+escHtml(t.title)+'</span>';
        if(t.date) html += '<span class="gcp-task-date">'+fmtDateShort(t.date)+'</span>';
        html += '</div>';
      });
      html += '<button class="btn-primary" id="btn-create-tasks" style="margin-top:10px;font-size:10px">Создать задачи в расписании</button>';
      html += '</div>';
    }
    html += '</div>';
  });
  if(goalsState.aiLoading && goalsState.chatGoalId === goalId) {
    html += '<div class="gcp-msg assistant"><div class="gcp-msg-label">Claude ✦</div><div class="gcp-typing"><span></span><span></span><span></span></div></div>';
  }
  html += '</div>';
  html += '<div class="gcp-input-row"><input type="text" id="gcp-input" class="gcp-input" placeholder="Ответьте или уточните..."><button class="btn-primary" id="gcp-send"'+(goalsState.aiLoading?' disabled':'')+'>→</button></div>';
  html += '</div>';
  return html;
}

function bindGoalChat(page) {
  page.querySelector('#gcp-close')?.addEventListener('click', () => { goalsState.chatGoalId=null; renderGoalsPage(); });
  page.querySelector('#gcp-new')?.addEventListener('click', () => {
    const id = goalsState.chatGoalId;
    goalsState.chatHistory[id] = [];
    renderGoalsPage();
    if(goalsState.apiKey) setTimeout(() => startGoalChat(id), 100);
  });
  page.querySelector('#gcp-send')?.addEventListener('click', sendGoalMessage);
  page.querySelector('#gcp-input')?.addEventListener('keydown', e => { if(e.key==='Enter') sendGoalMessage(); });
  page.querySelector('#btn-create-tasks')?.addEventListener('click', createTasksFromChat);
  const msgs = document.getElementById('gcp-messages');
  if(msgs) msgs.scrollTop = msgs.scrollHeight;
}

async function startGoalChat(goalId) {
  const g = (state.goals||[]).find(x=>x.id===goalId);
  if(!g || !goalsState.apiKey) return;
  const steps = state.subtasks[g.id] || [];
  const systemPrompt = 'Ты помощник по достижению целей в BrickBuro — дизайн-бюро в Санкт-Петербурге.\n'
    + 'Задача: помочь достичь конкретной цели через декомпозицию и встраивание шагов в расписание.\n'
    + 'Принципы:\n- Задай 1-2 уточняющих вопроса\n- Предложи декомпозицию: этапы → шаги на месяц → задачи на неделю\n'
    + '- Будь конкретным, без воды\n- Учитывай загруженность дизайн-бюро\n- Отвечай на русском\n'
    + '- Когда предлагаешь задачи, добавь в конце: TASKS_JSON:[{"title":"...","date":"2026-05-10","section":"bureau"}]\n\n'
    + 'Цель: "' + g.title + '"' + (g.deadline ? '\nДедлайн: ' + g.deadline : '') + (g.notes ? '\nКонтекст: ' + g.notes : '')
    + (steps.length ? '\nЗапланировано шагов: ' + steps.length : '');

  if(!goalsState.chatHistory[goalId]) goalsState.chatHistory[goalId] = [];
  goalsState.chatHistory[goalId] = [{ role:'user', content:'Помоги достичь цели: "'+g.title+'"'+(g.deadline?' к '+g.deadline:'') }];
  await callGoalAI(systemPrompt, goalId);
}

async function sendGoalMessage() {
  const inp = document.getElementById('gcp-input');
  if(!inp) return;
  const text = inp.value.trim();
  if(!text || goalsState.aiLoading) return;
  const g = (state.goals||[]).find(x=>x.id===goalsState.chatGoalId);
  if(!g) return;
  goalsState.chatMessages.push({ role:'user', content:text });
  inp.value = '';
  const sys = 'Ты помощник по целям в BrickBuro. Цель: "'+g.title+'"'+(g.deadline?' (дедлайн: '+g.deadline+')':'')+'.\nОтвечай по-русски, конкретно. Если предлагаешь задачи — добавь: TASKS_JSON:[{"title":"...","date":"2026-XX-XX","section":"bureau"}]';
  await callGoalAI(sys);
}

async function callGoalAI(systemPrompt, goalId) {
  if(!goalsState.apiKey) { showToast('Нет API ключа Claude','error'); return; }
  goalsState.aiLoading = true;
  renderGoalsPage();
  const msgs = document.getElementById('gcp-messages');
  if(msgs) msgs.scrollTop = msgs.scrollHeight;

  try {
    const resp = await fetch(ANTHROPIC_API, {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'x-api-key': goalsState.apiKey,
        'anthropic-version':'2023-06-01',
        'anthropic-dangerous-direct-browser-access':'true',
      },
      body: JSON.stringify({
        model:'claude-sonnet-4-20250514',
        max_tokens:1000,
        system: systemPrompt,
        messages: (goalsState.chatHistory[goalId]||[]).map(m=>({role:m.role,content:m.content})),
      })
    });
    const data = await resp.json();
    const text = data.content?.[0]?.text || 'Ошибка ответа';
    let tasks = null, displayText = text;
    const m = text.match(/TASKS_JSON:(\[[\s\S]*?\])/);
    if(m) { try { tasks=JSON.parse(m[1]); displayText=text.replace(/TASKS_JSON:[\s\S]*?\]/, '').trim(); } catch(e){} }
    if(!goalsState.chatHistory[goalId]) goalsState.chatHistory[goalId]=[];
    goalsState.chatHistory[goalId].push({ role:'assistant', content:displayText, tasks });
  } catch(err) {
    if(!goalsState.chatHistory[goalId]) goalsState.chatHistory[goalId]=[];
    goalsState.chatHistory[goalId].push({ role:'assistant', content:'Ошибка: '+err.message });
  }
  goalsState.aiLoading = false;
  renderGoalsPage();
  const msgsEl = document.getElementById('gcp-messages');
  if(msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
}

async function createTasksFromChat() {
  const goalId2 = goalsState.chatGoalId;
  const last = [...(goalsState.chatHistory[goalId2]||[])].reverse().find(m=>m.tasks);
  if(!last?.tasks) return;
  const goalId = goalId2;
  let created = 0;
  for(const t of last.tasks) {
    // Создаём задачу
    const taskPayload = {
      title: t.title,
      section: t.section || 'bureau',
      date_due: t.date || null,
      status: 'active',
      priority: 2,
      urgency: 2,
      type: 'task',
    };
    const {data,error} = await SB.from('bb_tasks').insert(taskPayload).select().single();
    if(error) { console.error('Ошибка создания задачи:', error); continue; }
    if(data) { state.tasks.unshift(data); created++; }

    // Добавляем шаг в список шагов цели (через bb_subtasks)
    const order = (state.subtasks[goalId]||[]).length;
    const subTitle = t.title + (t.date ? ' ('+fmtDateShort(t.date)+')' : '');
    const {data:sub, error:subErr} = await SB.from('bb_subtasks')
      .insert({task_id: goalId, title: subTitle, done: false, order_num: order})
      .select().single();
    if(subErr) console.error('Ошибка подзадачи:', subErr);
    if(sub) {
      if(!state.subtasks[goalId]) state.subtasks[goalId]=[];
      state.subtasks[goalId].push(sub);
    }
  }
  showToast('Создано '+created+' задач','success');
  renderGoalsPage();
}

async function completeGoal(goalId) {
  await SB.from('bb_goals').update({status:'done'}).eq('id',goalId);
  const g=(state.goals||[]).find(x=>x.id===goalId);
  if(g) g.status='done';
  launchConfetti();
  showToast('Цель достигнута!','success');
  renderGoalsPage();
}

function launchConfetti() {
  const canvas=document.createElement('canvas');
  canvas.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:9999;width:100%;height:100%';
  document.body.appendChild(canvas);
  const ctx=canvas.getContext('2d');
  canvas.width=window.innerWidth; canvas.height=window.innerHeight;
  const pieces=Array.from({length:150},()=>({
    x:Math.random()*canvas.width, y:Math.random()*canvas.height-canvas.height,
    r:Math.random()*8+4, color:['#a84332','#534AB7','#1D9E75','#BA7517','#185FA5'][Math.floor(Math.random()*5)],
    vx:(Math.random()-.5)*4, vy:Math.random()*3+2, rot:Math.random()*360, vrot:(Math.random()-.5)*8,
  }));
  let frame=0;
  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    pieces.forEach(p=>{
      ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot*Math.PI/180);
      ctx.fillStyle=p.color; ctx.globalAlpha=Math.max(0,1-frame/90);
      ctx.fillRect(-p.r/2,-p.r/2,p.r,p.r/2); ctx.restore();
      p.x+=p.vx; p.y+=p.vy; p.rot+=p.vrot; p.vy+=0.1;
    });
    frame++;
    if(frame<100) requestAnimationFrame(draw); else canvas.remove();
  }
  draw();
}

function promptApiKey() {
  const key=prompt('Введите API ключ Claude (начинается с sk-ant-):\n\nПолучить: console.anthropic.com');
  if(key&&key.startsWith('sk-')){goalsState.apiKey=key;localStorage.setItem('bb-ai-key',key);showToast('Claude подключён','success');renderGoalsPage();}
  else if(key) showToast('Неверный формат ключа','error');
}

function buildGoalModal() {
  const g=goalsState.editingGoal||{};
  const isNew=!g.id;
  let html='<div class="modal-overlay" id="goal-modal-ov"><div class="modal">';
  html+='<div class="modal-header"><div class="modal-title">'+(isNew?'НОВАЯ ЦЕЛЬ':'РЕДАКТИРОВАТЬ ЦЕЛЬ')+'</div><button class="modal-close" id="gm-close">✕</button></div>';
  html+='<div class="modal-body">';
  html+='<div class="mf-row"><input type="text" id="gm-title" class="f-title-input" placeholder="Формулировка цели..." value="'+escHtml(g.title||'')+'"></div>';
  html+='<div class="mf-2col"><div class="mf-field"><label class="mf-label">Раздел</label><select id="gm-section" class="f-select">';
  [['bureau','🏢 Бюро'],['projects','🏗 Проекты'],['marketing','📣 Маркетинг'],['finance','💰 Финансы'],['growth','📈 Развитие']].forEach(([v,l])=>{
    html+='<option value="'+v+'"'+(( g.section||'bureau')===v?' selected':'')+'>'+l+'</option>';
  });
  html+='</select></div>';
  html+='<div class="mf-field"><label class="mf-label">Дедлайн</label><input type="date" id="gm-deadline" class="f-input" value="'+(g.deadline||'')+'"></div></div>';
  html+='<div class="mf-row"><label class="mf-label">Контекст / зачем эта цель</label><textarea id="gm-notes" class="f-textarea" placeholder="Опишите подробнее — Claude учтёт при планировании">'+escHtml(g.notes||'')+'</textarea></div>';
  html+='</div>';
  html+='<div class="modal-footer"><div class="modal-footer-left">'+(isNew?'':`<button class="btn-delete" id="gm-delete">Удалить</button>`)+'</div>';
  html+='<div class="modal-footer-right"><button class="btn-secondary" id="gm-cancel">Отмена</button><button class="btn-primary" id="gm-save">Сохранить'+(isNew&&goalsState.apiKey?' и начать диалог':'')+'</button></div></div>';
  html+='</div></div>';
  return html;
}

function bindGoalModal(page) {
  page.querySelector('#goal-modal-ov')?.addEventListener('click',e=>{if(e.target.id==='goal-modal-ov'){goalsState.editingGoal=null;renderGoalsPage();}});
  page.querySelector('#gm-close')?.addEventListener('click',()=>{goalsState.editingGoal=null;renderGoalsPage();});
  page.querySelector('#gm-cancel')?.addEventListener('click',()=>{goalsState.editingGoal=null;renderGoalsPage();});
  page.querySelector('#gm-delete')?.addEventListener('click',async()=>{
    if(!confirm('Удалить цель?')) return;
    const g=goalsState.editingGoal;
    await SB.from('bb_goals').delete().eq('id',g.id);
    state.goals=(state.goals||[]).filter(x=>x.id!==g.id);
    goalsState.editingGoal=null; renderGoalsPage(); showToast('Цель удалена');
  });
  page.querySelector('#gm-save')?.addEventListener('click',async()=>{
    const title=document.getElementById('gm-title')?.value.trim();
    if(!title){showToast('Введите формулировку','error');return;}
    const data={title,section:document.getElementById('gm-section')?.value||'bureau',deadline:document.getElementById('gm-deadline')?.value||null,notes:document.getElementById('gm-notes')?.value||null,status:'active'};
    const g=goalsState.editingGoal;
    let savedId=g?.id;
    if(g?.id){
      await SB.from('bb_goals').update(data).eq('id',g.id);
      const idx=(state.goals||[]).findIndex(x=>x.id===g.id);
      if(idx>=0) Object.assign(state.goals[idx],data);
    } else {
      const {data:saved,error}=await SB.from('bb_goals').insert(data).select().single();
      if(!error&&saved){if(!state.goals)state.goals=[];state.goals.unshift(saved);savedId=saved.id;}
    }
    goalsState.editingGoal=null;
    if(goalsState.apiKey&&savedId){goalsState.chatGoalId=savedId;goalsState.chatMessages=[];}
    renderGoalsPage();
    if(goalsState.apiKey&&savedId) setTimeout(()=>startGoalChat(savedId),200);
    showToast(g?.id?'Цель обновлена':'Цель создана','success');
  });
}


// ─── TASKS PAGE ───────────────────────────────────────────────
function renderTasksPage() {
  const page=document.getElementById('page-tasks');
  if(!page||!page.classList.contains('active')) return;
  try {
    const tasks=getTasksPageFiltered();
    const total=state.tasks.length, active=state.tasks.filter(t=>t.status==='active').length;
    page.innerHTML=`
      <div class="tp-header">
        <div class="tp-title">ЗАДАЧИ</div>
        <div class="tp-stats"><span>${active} активных</span><span style="color:var(--ink4)"> / ${total} всего</span></div>
        <div class="tp-view-toggle">
          <button class="tv-btn ${tasksState.view==='list'?'active':''}" data-tview="list">СПИСОК</button>
          <button class="tv-btn ${tasksState.view==='kanban'?'active':''}" data-tview="kanban">КАНБАН</button>
        </div>
        <button class="btn-add-task" id="btn-add-task-2">+ ЗАДАЧА</button>
      </div>
      <div class="tp-filters">
        <input type="text" class="tp-search" id="tp-search" placeholder="Поиск..." value="${escHtml(tasksState.search)}">
        <select class="tp-sel" id="tp-section">
          <option value="all">Все разделы</option>
          ${Object.entries(SECTION_LABELS).map(([k,v])=>`<option value="${k}" ${tasksState.section===k?'selected':''}>${v}</option>`).join('')}
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
        ${tasksState.view==='list'?buildTasksList(tasks):buildTasksKanban(tasks)}
      </div>`;

    page.querySelector('#btn-add-task-2')?.addEventListener('click',()=>openTaskModal(null));
    page.querySelector('#tp-search')?.addEventListener('input',e=>{tasksState.search=e.target.value;renderTasksPage();});
    page.querySelector('#tp-section')?.addEventListener('change',e=>{tasksState.section=e.target.value;renderTasksPage();});
    page.querySelector('#tp-prio')?.addEventListener('change',e=>{tasksState.prio=e.target.value;renderTasksPage();});
    page.querySelectorAll('[data-tview]').forEach(btn=>btn.addEventListener('click',()=>{tasksState.view=btn.dataset.tview;renderTasksPage();}));
    page.querySelectorAll('[data-tstatus]').forEach(btn=>btn.addEventListener('click',()=>{tasksState.status=btn.dataset.tstatus;renderTasksPage();}));
    page.querySelectorAll('.tl-row').forEach(el=>el.addEventListener('click',e=>{if(e.target.closest('.task-check'))return;openTaskModal(parseInt(el.dataset.tid));}));
    page.querySelectorAll('.task-check[data-id]').forEach(el=>el.addEventListener('click',e=>{e.stopPropagation();toggleTask(parseInt(el.dataset.id));}));
  } catch(err) {
    console.error('renderTasksPage:', err);
    page.innerHTML=`<div class="page-stub"><div class="stub-icon">!</div><div class="stub-label">Ошибка: ${err.message}</div></div>`;
  }
}

function getTasksPageFiltered() {
  let tasks=state.tasks;
  if(tasksState.status==='active') tasks=tasks.filter(t=>t.status==='active');
  else if(tasksState.status==='done') tasks=tasks.filter(t=>t.status==='done');
  if(tasksState.section!=='all') tasks=tasks.filter(t=>t.section===tasksState.section);
  if(tasksState.prio!=='all') tasks=tasks.filter(t=>String(t.priority)===tasksState.prio);
  if(tasksState.search) { const q=tasksState.search.toLowerCase(); tasks=tasks.filter(t=>t.title?.toLowerCase().includes(q)||(t.notes||'').toLowerCase().includes(q)); }
  return tasks;
}

function buildTasksList(tasks) {
  if(!tasks.length) return `<div class="empty-state"><div class="empty-icon">▦</div><div class="empty-text">Нет задач</div></div>`;
  const secs={projects:[],bureau:[],marketing:[],finance:[],partners:[],growth:[]};
  tasks.forEach(t=>{ if(secs[t.section]) secs[t.section].push(t); else secs.bureau.push(t); });
  let html='<div class="tl-list">';
  Object.entries(secs).forEach(([sec,items])=>{
    if(!items.length) return;
    items.sort((a,b)=>{
      const td=todayStr();
      const aOver=a.date_due&&a.date_due<td?0:1;
      const bOver=b.date_due&&b.date_due<td?0:1;
      if(aOver!==bOver) return aOver-bOver;
      const pDiff=(a.priority||3)-(b.priority||3);
      if(pDiff!==0) return pDiff;
      if(a.date_due&&b.date_due) return a.date_due<b.date_due?-1:1;
      if(a.date_due) return -1;
      if(b.date_due) return 1;
      return 0;
    });
    html+=`<div class="tl-group"><div class="tl-group-title">${SECTION_LABELS[sec]||sec} <span class="tl-count">${items.length}</span></div>`;
    items.forEach(t=>{
      const isDone=t.status==='done', over=t.date_due&&t.date_due<todayStr()&&!isDone;
      const subs=state.subtasks[t.id]||[], subDone=subs.filter(s=>s.done).length;
      const pct=subs.length?Math.round(subDone/subs.length*100):null;
      const prioDots=[1,2,3].map(i=>`<div class="prio-dot ${i<=(t.priority||2)?'filled':''}"></div>`).join('');
      const secColor=SECTION_COLORS[t.section]||'var(--ink3)';
      html+=`<div class="tl-row ${isDone?'done':''} ${over?'overdue':''}" data-tid="${t.id}">
        <div class="task-check ${isDone?'checked':''}" data-id="${t.id}">${isDone?'✓':''}</div>
        <div class="tl-bar" style="background:${secColor}"></div>
        <div class="tl-body">
          <div class="tl-title">${escHtml(t.title)}</div>
          ${t.notes?`<div class="tl-notes">${escHtml(t.notes.slice(0,80))}${t.notes.length>80?'…':''}</div>`:''}
          ${pct!==null?`<div class="tl-progress"><div class="tl-progress-fill" style="width:${pct}%"></div><span class="tl-pct">${pct}%</span></div>`:''}
        </div>
        <div class="tl-meta">
          <div class="prio-dots">${prioDots}</div>
          ${t.date_due?`<span class="tl-date ${over?'over':''}">${over?'⚠ ':''}${fmtDateShort(t.date_due)}</span>`:''}
        </div>
      </div>`;
    });
    html+=`</div>`;
  });
  return html+'</div>';
}

function buildTasksKanban(tasks) {
  const cols=[
    {id:'inbox',  label:'ВХОДЯЩИЕ', color:'var(--ochre)'},
    {id:'active', label:'В РАБОТЕ', color:'var(--blue)'},
    {id:'waiting',label:'ЖДЁМ',     color:'var(--plum)'},
    {id:'done',   label:'ВЫПОЛНЕНО',color:'var(--green)'},
  ];

  function getCol(t) {
    if(t.status==='done') return 'done';
    return t.kanban_status||'inbox';
  }

  let html = '<div class="kb-board">';
  cols.forEach(col => {
    const items = tasks.filter(t=>getCol(t)===col.id);
    html += `<div class="kb-col">
      <div class="kb-col-header">
        <div class="kb-col-dot" style="background:${col.color}"></div>
        <span class="kb-col-title">${col.label}</span>
        <span class="kb-col-cnt">${items.length}</span>
      </div>
      <div class="kb-col-body" data-col="${col.id}" id="kbc-${col.id}"
        ondragover="event.preventDefault();this.classList.add('kb-drag-over')"
        ondragleave="this.classList.remove('kb-drag-over')"
        ondrop="kbDrop(event,'${col.id}')">`;

    items.forEach(t => {
      const secColor = SECTION_COLORS[t.section]||'var(--ink3)';
      const isDone = t.status==='done';
      const over = t.date_due && t.date_due < todayStr() && !isDone;
      html += `<div class="kb-card ${isDone?'done':''} ${over?'overdue':''}"
          draggable="true"
          data-tid="${t.id}"
          ondragstart="kbDragStart(event,${t.id})"
          ondragend="this.classList.remove('dragging')">
        <div class="kb-card-bar" style="background:${secColor}"></div>
        <div class="kb-card-body">
          <div class="task-check ${isDone?'checked':''}" data-id="${t.id}">${isDone?'✓':''}</div>
          <div class="kb-card-title ${isDone?'done':''}">${escHtml(t.title)}</div>
        </div>
        ${t.date_due?`<div class="kb-card-footer"><span class="tl-date ${over?'over':''}" style="font-size:9px">${fmtDateShort(t.date_due)}</span></div>`:''}
      </div>`;
    });

    if(!items.length) html += '<div class="kb-empty">пусто</div>';
    html += '</div></div>';
  });
  html += '</div>';
  return html;
}

// Глобальные функции для drag&drop канбана
let _kbDragId = null;
window.kbDragStart = function(e, id) {
  _kbDragId = id;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
};
window.kbDrop = async function(e, colId) {
  e.preventDefault();
  e.currentTarget.classList.remove('kb-drag-over');
  if(!_kbDragId) return;
  const task = state.tasks.find(t=>t.id===_kbDragId);
  if(!task) return;
  const newStatus = colId==='done'?'done':'active';
  task.kanban_status = colId;
  task.status = newStatus;
  await SB.from('bb_tasks').update({kanban_status:colId, status:newStatus}).eq('id',_kbDragId);
  _kbDragId = null;
  // Перерисовываем только канбан
  const page = document.getElementById('page-tasks');
  if(page) {
    const content = document.getElementById('tp-content');
    if(content) content.innerHTML = buildTasksKanban(getTasksPageFiltered());
    bindKanbanCardClicks(page);
  }
};


function bindKanbanCardClicks(page) {
  page.querySelectorAll('.kb-card[data-tid]').forEach(el => {
    el.addEventListener('click', e => {
      if(e.target.closest('.task-check')) return;
      openTaskModal(parseInt(el.dataset.tid));
    });
  });
  page.querySelectorAll('.kb-card .task-check[data-id]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      toggleTask(parseInt(el.dataset.id));
    });
  });
}

// ─── MODAL ────────────────────────────────────────────────────
function initModal() {
  document.getElementById('btn-add-task')?.addEventListener('click',()=>openTaskModal(null));
  document.getElementById('modal-close')?.addEventListener('click',closeModal);
  document.getElementById('btn-cancel')?.addEventListener('click',closeModal);
  document.getElementById('task-modal')?.addEventListener('click',e=>{ if(e.target.id==='task-modal') closeModal(); });
  document.getElementById('btn-save')?.addEventListener('click',saveTask);
  document.getElementById('btn-delete')?.addEventListener('click',deleteTask);
  document.getElementById('btn-add-subtask')?.addEventListener('click',addFormSubtask);
  document.getElementById('subtask-input')?.addEventListener('keydown',e=>{ if(e.key==='Enter') addFormSubtask(); });

  document.getElementById('f-type-seg')?.addEventListener('click',e=>{
    const btn=e.target.closest('.seg-btn'); if(!btn) return;
    document.querySelectorAll('#f-type-seg .seg-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('f-travel-wrap').style.display=['meeting','trip'].includes(btn.dataset.val)?'':'none';
  });
  document.getElementById('f-section')?.addEventListener('change',e=>{
    document.getElementById('f-project-row').style.display=e.target.value==='projects'?'':'none';
  });
  ['f-priority','f-urgency'].forEach(id=>{
    document.getElementById(id)?.addEventListener('click',e=>{
      const btn=e.target.closest('.prio-btn'); if(!btn) return;
      document.querySelectorAll(`#${id} .prio-btn`).forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  document.getElementById('f-recurrence')?.addEventListener('change',e=>{
    document.getElementById('f-recurrence-end-wrap').style.display=e.target.value&&e.target.value!=='custom'?'':'none';
  });
}

function openTaskModal(taskId) {
  state.editingTaskId=taskId;
  state.formSubtasks=[];
  const projEl=document.getElementById('f-project');
  projEl.innerHTML=`<option value="">— без проекта —</option>`+state.projects.map(p=>`<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
  const depsEl=document.getElementById('f-depends');
  depsEl.innerHTML=`<option value="">— нет зависимости —</option>`+state.tasks.filter(t=>t.id!==taskId).map(t=>`<option value="${t.id}">${escHtml(t.title)}</option>`).join('');

  if(taskId) {
    const task=state.tasks.find(t=>t.id===taskId); if(!task) return;
    document.getElementById('modal-title').textContent='Редактировать задачу';
    document.getElementById('btn-delete').classList.remove('hidden');
    document.getElementById('modal-meta').textContent=`Создана: ${fmtDateShort(task.created_at)}`;
    document.getElementById('f-title').value=task.title||'';
    setSegActive('f-type-seg',task.type||'task');
    document.getElementById('f-section').value=task.section||'bureau';
    document.getElementById('f-project-row').style.display=task.section==='projects'?'':'none';
    document.getElementById('f-project').value=task.project_id||'';
    document.getElementById('f-assignee').value='';
    setPrioActive('f-priority',task.priority||2);
    setPrioActive('f-urgency',task.urgency||2);
    document.getElementById('f-date').value=task.date_due||'';
    document.getElementById('f-time-start').value=task.time_start?.slice(0,5)||'';
    document.getElementById('f-time-end').value=task.time_end?.slice(0,5)||'';
    document.getElementById('f-travel').value=task.travel_time||'';
    document.getElementById('f-travel-wrap').style.display=['meeting','trip'].includes(task.type)?'':'none';
    document.getElementById('f-recurrence').value=task.recurrence||'';
    document.getElementById('f-recurrence-end-wrap').style.display=task.recurrence&&task.recurrence!=='custom'?'':'none';
    document.getElementById('f-recurrence-end').value=task.recurrence_end||'';
    document.getElementById('f-depends').value=task.depends_on||'';
    document.getElementById('f-notes').value=task.notes||'';
    document.getElementById('f-personal').checked=task.is_personal||false;
    state.formSubtasks=(state.subtasks[taskId]||[]).map(s=>({...s}));
  } else {
    document.getElementById('modal-title').textContent='Новая задача';
    document.getElementById('btn-delete').classList.add('hidden');
    document.getElementById('modal-meta').textContent='';
    document.getElementById('f-title').value='';
    setSegActive('f-type-seg','task');
    document.getElementById('f-section').value='bureau';
    document.getElementById('f-project-row').style.display='none';
    document.getElementById('f-project').value='';
    document.getElementById('f-assignee').value='';
    setPrioActive('f-priority',2); setPrioActive('f-urgency',2);
    const autoDate=state.filter.date!=='today'&&state.filter.date!=='tomorrow'&&state.filter.date!=='nodate'?state.filter.date:'';
    document.getElementById('f-date').value=autoDate;
    document.getElementById('f-time-start').value=''; document.getElementById('f-time-end').value='';
    document.getElementById('f-travel').value=''; document.getElementById('f-travel-wrap').style.display='none';
    document.getElementById('f-recurrence').value=''; document.getElementById('f-recurrence-end-wrap').style.display='none';
    document.getElementById('f-recurrence-end').value=''; document.getElementById('f-depends').value='';
    document.getElementById('f-notes').value=''; document.getElementById('f-personal').checked=false;
    state.formSubtasks=[];
  }
  renderFormSubtasks();
  document.getElementById('task-modal').classList.remove('hidden');
  document.getElementById('f-title').focus();
}

function closeModal() {
  document.getElementById('task-modal').classList.add('hidden');
  state.editingTaskId=null; state.formSubtasks=[];
}

function renderFormSubtasks() {
  const list=document.getElementById('subtasks-list');
  list.innerHTML=state.formSubtasks.map((s,i)=>`
    <div class="subtask-item">
      <input type="checkbox" class="subtask-cb" ${s.done?'checked':''} data-idx="${i}">
      <span class="subtask-text">${escHtml(s.title)}</span>
      <button class="subtask-rm" data-idx="${i}">×</button>
    </div>`).join('');
  list.querySelectorAll('.subtask-rm').forEach(btn=>btn.addEventListener('click',()=>{ state.formSubtasks.splice(parseInt(btn.dataset.idx),1); renderFormSubtasks(); }));
  list.querySelectorAll('.subtask-cb').forEach(cb=>cb.addEventListener('change',()=>{ state.formSubtasks[parseInt(cb.dataset.idx)].done=cb.checked; }));
}

function addFormSubtask() {
  const inp=document.getElementById('subtask-input');
  const title=inp.value.trim(); if(!title) return;
  state.formSubtasks.push({title,done:false,order_num:state.formSubtasks.length});
  inp.value=''; renderFormSubtasks(); inp.focus();
}

async function saveTask() {
  const title=document.getElementById('f-title').value.trim();
  if(!title) { showToast('Введите название','error'); document.getElementById('f-title').focus(); return; }

  const type=document.querySelector('#f-type-seg .seg-btn.active')?.dataset.val||'task';
  const section=document.getElementById('f-section').value;
  const priority=parseInt(document.querySelector('#f-priority .prio-btn.active')?.dataset.val||'2');
  const urgency=parseInt(document.querySelector('#f-urgency .prio-btn.active')?.dataset.val||'2');
  const projVal=document.getElementById('f-project').value;
  const depVal=document.getElementById('f-depends').value;
  const travelVal=parseInt(document.getElementById('f-travel').value);

  const taskData={
    title, type, section,
    project_id: projVal?parseInt(projVal):null,
    priority, urgency,
    date_due: document.getElementById('f-date').value||null,
    time_start: document.getElementById('f-time-start').value||null,
    time_end: document.getElementById('f-time-end').value||null,
    travel_time: isNaN(travelVal)?0:travelVal,
    recurrence: document.getElementById('f-recurrence').value||null,
    recurrence_end: document.getElementById('f-recurrence-end').value||null,
    depends_on: depVal?parseInt(depVal):null,
    notes: document.getElementById('f-notes').value||null,
    is_personal: document.getElementById('f-personal').checked,
  };

  const btn=document.getElementById('btn-save'); btn.disabled=true;
  let taskId=state.editingTaskId;

  if(taskId) {
    const {error}=await SB.from('bb_tasks').update(taskData).eq('id',taskId);
    if(error) { console.error('update error:',error); showToast('Ошибка: '+error.message,'error'); btn.disabled=false; return; }
    const idx=state.tasks.findIndex(t=>t.id===taskId); if(idx>=0) Object.assign(state.tasks[idx],taskData);
  } else {
    const {data,error}=await SB.from('bb_tasks').insert({...taskData,status:'active',kanban_status:'inbox'}).select().single();
    if(error) { console.error('insert error:',error); showToast('Ошибка: '+error.message,'error'); btn.disabled=false; return; }
    taskId=data.id; state.tasks.unshift(data);
  }

  if(state.formSubtasks.length) {
    await SB.from('bb_subtasks').delete().eq('task_id',taskId);
    const {data:savedSubs}=await SB.from('bb_subtasks').insert(state.formSubtasks.map((s,i)=>({task_id:taskId,title:s.title,done:s.done||false,order_num:i}))).select();
    state.subtasks[taskId]=savedSubs||[];
  } else if(state.editingTaskId) {
    await SB.from('bb_subtasks').delete().eq('task_id',taskId);
    state.subtasks[taskId]=[];
  }

  btn.disabled=false;
  closeModal();
  renderCalendar();
  renderTasks();
  if(document.getElementById('page-tasks')?.classList.contains('active')) renderTasksPage();
  showToast(state.editingTaskId?'Задача обновлена':'Задача создана','success');
}

async function deleteTask() {
  if(!state.editingTaskId) return;
  if(!confirm('Удалить задачу?')) return;
  await SB.from('bb_subtasks').delete().eq('task_id',state.editingTaskId);
  await SB.from('bb_tasks').delete().eq('id',state.editingTaskId);
  state.tasks=state.tasks.filter(t=>t.id!==state.editingTaskId);
  delete state.subtasks[state.editingTaskId];
  closeModal(); renderCalendar(); renderTasks();
  if(document.getElementById('page-tasks')?.classList.contains('active')) renderTasksPage();
  showToast('Задача удалена');
}

function setSegActive(id,val) { document.querySelectorAll(`#${id} .seg-btn`).forEach(b=>b.classList.toggle('active',b.dataset.val===String(val))); }
function setPrioActive(id,val) { document.querySelectorAll(`#${id} .prio-btn`).forEach(b=>b.classList.toggle('active',b.dataset.val===String(val))); }

// ─── START ────────────────────────────────────────────────────
function startApp() {
  try {
    SB = supabase.createClient(SB_URL, SB_KEY);
  } catch(e) {
    console.error('Supabase init error:', e);
    return;
  }
  initAuth();
  initNav();
  initModal();
}

if(document.readyState==='loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
