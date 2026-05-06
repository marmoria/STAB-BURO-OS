'use strict';

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
  filter: { date: 'today', section: 'all' },
  calMonth: new Date().getMonth(),
  calYear: new Date().getFullYear(),
  editingTaskId: null,
  formSubtasks: [],
  quickAddTaskId: null, // для быстрого добавления подзадачи
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
  if(sessionStorage.getItem('bb-ok') === PW_HASH) {
    setDemoUser();
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    loadDataAndShow();
    return;
  }
  const btn = document.getElementById('auth-submit');
  const pw = document.getElementById('auth-password');
  if(btn) btn.addEventListener('click', doAuth);
  if(pw) pw.addEventListener('keydown', e=>{ if(e.key==='Enter') doAuth(); });
  const logout = document.getElementById('btn-logout');
  if(logout) logout.addEventListener('click', ()=>{ sessionStorage.removeItem('bb-ok'); location.reload(); });
}

function setDemoUser() {
  currentUser = { id: 'demo', email: 'maria@brickburo.com' };
  currentProfile = { id: 'demo', name: 'Мария', avatar_initials: 'МА', color: '#a84332' };
  profiles['demo'] = currentProfile;
}

async function doAuth() {
  const pw = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  const btnText = document.getElementById('auth-btn-text');
  const btn = document.getElementById('auth-submit');
  if(!pw) { errEl.textContent='Введите пароль'; errEl.classList.remove('hidden'); return; }
  errEl.classList.add('hidden');
  btnText.textContent='Вхожу...'; btn.disabled=true;
  const h = await sha256(pw);
  if(h === PW_HASH) {
    sessionStorage.setItem('bb-ok', PW_HASH);
    setDemoUser();
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
  await Promise.all([loadTasks(), loadProjects()]);
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

  }
}

async function loadProjects() {
  const { data } = await SB.from('projects').select('id,name,color').order('name');
  state.projects = data || [];
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
        <div class="task-check tl-check ${isDone?'checked':''}" data-id="${task.id}">${isDone?'✓':''}</div>
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
    el.addEventListener('click', e=>{ e.stopPropagation(); toggleTask(parseInt(el.dataset.id)); });
  });
  // Events — карточки
  groups.querySelectorAll('.task-card').forEach(card=>{
    card.addEventListener('click', e=>{ if(e.target.closest('.task-check')||e.target.closest('.subtask-check')||e.target.closest('.quick-add-sub')) return; openTaskModal(parseInt(card.dataset.id)); });
  });
  groups.querySelectorAll('.task-check[data-id]').forEach(el=>{
    el.addEventListener('click', e=>{ e.stopPropagation(); toggleTask(parseInt(el.dataset.id)); });
  });
  groups.querySelectorAll('.subtask-check[data-id]').forEach(el=>{
    el.addEventListener('click', e=>{ e.stopPropagation(); toggleSubtask(parseInt(el.dataset.id), el.dataset.taskId); });
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
  const subs=state.subtasks[task.id]||[];
  const subDone=subs.filter(s=>s.done).length;
  const subPct=subs.length?Math.round(subDone/subs.length*100):null;
  const isDone=task.status==='done', td_=todayStr();
  const over=task.date_due&&task.date_due<td_&&!isDone;
  const secColor=SECTION_COLORS[task.section]||'var(--ink3)';
  const typeColor={task:'var(--ink)',meeting:'var(--c-projects)',call:'var(--green)',trip:'var(--blue)',deadline:'var(--brick)',payment:'var(--ochre)'}[task.type]||'var(--ink)';
  const ctxLabel={task:'ЗАДАЧ',meeting:'ВСТР',call:'ЗВНК',trip:'ПОЕЗД',deadline:'ДЕДЛ',payment:'ОПЛТ'}[task.type]||'ЗАДАЧ';
  const prioDots=[1,2,3].map(i=>`<div class="prio-dot ${i<=(task.priority||2)?'filled':''}"></div>`).join('');
  const urgTris=[1,2,3].map(i=>`<div class="urg-tri ${i<=(task.urgency||2)?'filled':''}"></div>`).join('');

  let subsHtml='';
  if(subs.length&&!isDone) {
    subsHtml=`<div class="task-subtasks">${subs.map(s=>`
      <div class="subtask-row">
        <div class="subtask-check ${s.done?'checked':''}" data-id="${s.id}" data-task-id="${task.id}">${s.done?'✓':''}</div>
        <span class="subtask-title ${s.done?'done':''}">${escHtml(s.title)}</span>
      </div>`).join('')}</div>
    <div class="task-progress-row"><div class="task-progress-bar"><div class="task-progress-fill" style="width:${subPct}%"></div></div><span class="task-progress-pct">${subPct}%</span></div>`;
  }

  // Быстрое добавление подзадачи
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
    </div>
    <div class="task-right">
      <div class="prio-dots">${prioDots}</div>
      <div class="urg-tris">${urgTris}</div>
      <div class="task-check ${isDone?'checked':''}" data-id="${task.id}">${isDone?'✓':''}</div>
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
  }
  state.quickAddTaskId=null;
  renderTasks();
}

// ─── TOGGLE ───────────────────────────────────────────────────
async function toggleTask(id) {
  const task=state.tasks.find(t=>t.id===id); if(!task) return;
  const ns=task.status==='done'?'active':'done'; task.status=ns;
  await SB.from('bb_tasks').update({status:ns}).eq('id',id);
  renderTasks();
}

async function toggleSubtask(subId, taskId) {
  const subs=state.subtasks[parseInt(taskId)]||[];
  const sub=subs.find(s=>s.id===subId); if(!sub) return;
  sub.done=!sub.done;
  await SB.from('bb_subtasks').update({done:sub.done}).eq('id',subId);
  const allDone=subs.every(s=>s.done);
  const task=state.tasks.find(t=>t.id===parseInt(taskId));
  if(task) { if(allDone){task.status='done';await SB.from('bb_tasks').update({status:'done'}).eq('id',taskId);} else if(task.status==='done'){task.status='active';await SB.from('bb_tasks').update({status:'active'}).eq('id',taskId);} }
  renderTasks();
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
    items.sort((a,b)=>(a.priority||3)-(b.priority||3));
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
    {id:'incoming',label:'ВХОДЯЩИЕ',color:'var(--ochre)',filter:t=>t.type==='incoming'},
    {id:'active',label:'В РАБОТЕ',color:'var(--blue)',filter:t=>t.status==='active'&&t.type!=='incoming'},
    {id:'done',label:'ВЫПОЛНЕНО',color:'var(--green)',filter:t=>t.status==='done'},
  ];
  return `<div class="kb-board">${cols.map(col=>{
    const items=tasks.filter(col.filter);
    return `<div class="kb-col">
      <div class="kb-col-header"><div class="kb-col-dot" style="background:${col.color}"></div><span class="kb-col-title">${col.label}</span><span class="kb-col-cnt">${items.length}</span></div>
      <div class="kb-col-body">
        ${items.map(t=>{
          const isDone=t.status==='done', secColor=SECTION_COLORS[t.section]||'var(--ink3)';
          return `<div class="kb-card ${isDone?'done':''}" data-tid="${t.id}">
            <div class="kb-card-bar" style="background:${secColor}"></div>
            <div class="kb-card-body">
              <div class="task-check ${isDone?'checked':''}" data-id="${t.id}">${isDone?'✓':''}</div>
              <div class="kb-card-title ${isDone?'done':''}">${escHtml(t.title)}</div>
            </div>
            ${t.date_due?`<div class="kb-card-footer"><span class="tl-date" style="font-size:9px">${fmtDateShort(t.date_due)}</span></div>`:''}
          </div>`;
        }).join('')}
        ${!items.length?`<div class="kb-empty">пусто</div>`:''}
      </div>
    </div>`;
  }).join('')}</div>`;
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
    const {data,error}=await SB.from('bb_tasks').insert({...taskData,status:'active'}).select().single();
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
