// HostelAid Live Frontend Application
// Role-Tailored UI for Warden, Doctor, and Student

const API_BASE = '';
let incidents = [];
let responders = [];
let smsLogs = [];
let stats = {};
let config = {};
let smsConfig = {};
let dutyWardenContact = { name: "Aarav Sharma (Warden)", phone: "+91 98765 43210" };
let currentUser = null;
let activeId = null;
let assessDebounceTimer = null;
let currentAiAssessment = null;

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupEventListeners();
  await checkAuthStatus();
  if (!currentUser) {
    openAuthModal();
  }
  loadAllData();
  setInterval(() => loadAllData(false), 10000);
});

function authHeaders() {
  const token = localStorage.getItem('hostelaid_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function setupNavigation() {
  document.querySelectorAll('.nav').forEach(n => {
    n.addEventListener('click', () => showView(n.dataset.view));
  });
  document.getElementById('today').textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric'
  });
}

function setupEventListeners() {
  const searchInput = document.getElementById('searchIncidents');
  if (searchInput) searchInput.addEventListener('input', renderFullList);

  const filterStatus = document.getElementById('filterStatus');
  if (filterStatus) filterStatus.addEventListener('change', renderFullList);

  document.querySelectorAll('.type-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.type-option').forEach(x => x.classList.remove('selected'));
      opt.classList.add('selected');
      const radio = opt.querySelector('input');
      if (radio) radio.checked = true;
      triggerAiAssess();
    });
  });

  const detailsEl = document.getElementById('details');
  if (detailsEl) {
    detailsEl.addEventListener('input', () => {
      clearTimeout(assessDebounceTimer);
      assessDebounceTimer = setTimeout(triggerAiAssess, 450);
    });
  }

  const locationEl = document.getElementById('location');
  if (locationEl) locationEl.addEventListener('change', triggerAiAssess);

  const peopleEl = document.getElementById('people');
  if (peopleEl) peopleEl.addEventListener('change', triggerAiAssess);

  const reportForm = document.getElementById('reportForm');
  if (reportForm) reportForm.addEventListener('submit', handleIncidentSubmit);

  window.addEventListener('click', e => {
    if (e.target.id === 'detailModal') closeModal();
    if (e.target.id === 'settingsModal') closeSettingsModal();
    if (e.target.id === 'authModal') closeAuthModal();
    if (e.target.id === 'profileModal') closeProfileModal();
    if (e.target.id === 'sendSmsModal') closeSendSmsModal();
    if (e.target.id === 'editContactModal') closeEditContactModal();
  });
}

// ----------------- Role-Adaptive UI Engine -----------------
function applyRoleBasedUI() {
  const role = currentUser ? currentUser.role : 'student';

  // 1. Sidebar Nav adjustments
  const navOverview = document.querySelector('.nav[data-view="overview"]');
  const navIncidents = document.querySelector('.nav[data-view="incidents"]');
  const navResponders = document.querySelector('.nav[data-view="responders"]');
  const navSms = document.querySelector('.nav[data-view="sms"]');
  const topEyebrow = document.getElementById('topEyebrow');

  if (role === 'student') {
    if (topEyebrow) topEyebrow.innerHTML = 'CAMPUS RESIDENT SAFETY PORTAL <span class="status-pill"><i></i> SYSTEM READY</span>';
    if (navOverview) navOverview.innerHTML = '<span>◫</span> My Safety Portal';
    if (navIncidents) navIncidents.innerHTML = '<span>▤</span> My Requests <span class="nav-count" id="navCount">0</span>';
    if (navResponders) navResponders.style.display = 'none';
    const navContacts = document.getElementById('navContacts');
    if (navContacts) {
      navContacts.style.display = 'flex';
      navContacts.innerHTML = '<span>📞</span> Warden & Emergency Contacts';
    }
    if (navSms) navSms.style.display = 'none';
  } else if (role === 'responder') {
    const navContacts = document.getElementById('navContacts');
    if (navContacts) {
      navContacts.style.display = 'flex';
      navContacts.innerHTML = '<span>📞</span> Campus Contacts';
    }
    // Doctor / Medical Responder
    if (topEyebrow) topEyebrow.innerHTML = 'CAMPUS HEALTH & MEDICAL STATION <span class="status-pill"><i></i> CLINIC ONLINE</span>';
    if (navOverview) navOverview.innerHTML = '<span>✚</span> Clinical Triage';
    if (navIncidents) navIncidents.innerHTML = '<span>▤</span> Medical Incidents <span class="nav-count" id="navCount">0</span>';
    if (navResponders) {
      navResponders.style.display = 'flex';
      navResponders.innerHTML = '<span>♙</span> Medical Team';
    }
    if (navSms) navSms.style.display = 'flex';
  } else {
    // Warden / Admin
    if (topEyebrow) topEyebrow.innerHTML = 'CAMPUS EMERGENCY CENTER <span class="status-pill"><i></i> WARDEN DESK ACTIVE</span>';
    if (navOverview) navOverview.innerHTML = '<span>◫</span> Overview';
    if (navIncidents) navIncidents.innerHTML = '<span>▤</span> Master Incident Log <span class="nav-count" id="navCount">0</span>';
    if (navResponders) {
      navResponders.style.display = 'flex';
      navResponders.innerHTML = '<span>♙</span> Response Team';
    }
    if (navSms) navSms.style.display = 'flex';
  }

  // 2. Hero Section customization
  const heroTag = document.getElementById('heroTag');
  const heroTitle = document.getElementById('heroTitle');
  const heroDesc = document.getElementById('heroDesc');
  const heroActionBtn = document.getElementById('heroActionBtn');

  if (role === 'student') {
    if (heroTag) heroTag.textContent = '✦ RESIDENT EMERGENCY NETWORK';
    if (heroTitle) heroTitle.innerHTML = 'Need urgent help?<br><span>Assistance reaches your door.</span>';
    if (heroDesc) heroDesc.textContent = 'Report any illness, physical injury, or safety threat. Wardens and doctors receive an immediate automated SMS with your exact room location.';
    if (heroActionBtn) heroActionBtn.innerHTML = '＋ Report My Emergency <span>→</span>';
  } else if (role === 'responder') {
    if (heroTag) heroTag.textContent = '✦ MEDICAL TRIAGE & PATIENT INTAKE';
    if (heroTitle) heroTitle.innerHTML = 'Clinical Response Station.<br><span>Prioritize patient welfare.</span>';
    if (heroDesc) heroDesc.textContent = 'Review emergency medical calls across all hostel wings. Inspect patient pre-existing allergy notes, first-aid checklists, and dispatch logs.';
    if (heroActionBtn) heroActionBtn.innerHTML = 'View Medical Queue <span>→</span>';
  } else {
    if (heroTag) heroTag.textContent = '✦ WARDEN SAFETY COMMAND CENTER';
    if (heroTitle) heroTitle.innerHTML = 'Every second matters.<br><span>Coordinate instant campus relief.</span>';
    if (heroDesc) heroDesc.textContent = 'Live incident intake across all hostel blocks. Automated emergency SMS alerts to duty doctors, gate security, and block floor reps.';
    if (heroActionBtn) heroActionBtn.innerHTML = '＋ Report an emergency <span>→</span>';
  }
}

// ----------------- Authentication Handlers -----------------
async function checkAuthStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, { headers: authHeaders() }).then(r => r.json());
    if (res.success && res.authenticated && res.user) {
      currentUser = res.user;
    } else {
      currentUser = null;
    }
  } catch (err) {
    currentUser = null;
  }
  updateAuthUI();
  applyRoleBasedUI();
}

function updateAuthUI() {
  const topAvatar = document.getElementById('topAvatar');
  const userNameRole = document.getElementById('userNameRole');
  const sidebarAvatar = document.getElementById('sidebarAvatar');
  const sidebarName = document.getElementById('sidebarName');
  const sidebarRole = document.getElementById('sidebarRole');

  if (currentUser) {
    const initials = currentUser.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'U';
    topAvatar.textContent = initials;
    userNameRole.innerHTML = `${esc(currentUser.name)} <span class="role-badge">${esc(currentUser.role)}</span>`;

    sidebarAvatar.textContent = initials;
    sidebarName.textContent = currentUser.name;
    sidebarRole.textContent = `${currentUser.role.toUpperCase()} · ${currentUser.room_number || currentUser.hostel_block || 'Active'}`;

    const repInput = document.getElementById('reporter');
    const callInput = document.getElementById('callback');
    if (repInput) repInput.value = `${currentUser.name} (${currentUser.room_number || currentUser.hostel_block || 'Resident'})`;
    if (callInput && currentUser.phone) callInput.value = currentUser.phone;
  } else {
    topAvatar.textContent = '?';
    userNameRole.textContent = 'Sign In';
    sidebarAvatar.textContent = 'PT';
    sidebarName.textContent = 'Resident / Student';
    sidebarRole.textContent = 'Click to Sign In';
  }
}

function handleProfileClick() {
  if (currentUser) {
    openProfileModal();
  } else {
    openAuthModal();
  }
}

function openAuthModal() {
  switchAuthTab('login');
  document.getElementById('authModal').classList.remove('hidden');
}

function closeAuthModal() {
  document.getElementById('authModal').classList.add('hidden');
}

function switchAuthTab(tab) {
  const tabLogin = document.getElementById('tabLogin');
  const tabReg = document.getElementById('tabRegister');
  const loginForm = document.getElementById('loginForm');
  const regForm = document.getElementById('registerForm');
  const quickDemo = document.getElementById('quickDemoLogins');
  const title = document.getElementById('authModalTitle');

  if (tab === 'login') {
    tabLogin.classList.add('active');
    tabReg.classList.remove('active');
    loginForm.style.display = 'block';
    regForm.style.display = 'none';
    quickDemo.style.display = 'block';
    title.textContent = 'Sign In to HostelAid';
  } else {
    tabLogin.classList.remove('active');
    tabReg.classList.add('active');
    loginForm.style.display = 'none';
    regForm.style.display = 'block';
    quickDemo.style.display = 'none';
    title.textContent = 'Register Resident Account';
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  const btn = document.getElementById('btnLoginSubmit');

  btn.disabled = true;
  btn.textContent = 'Signing in...';

  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    }).then(r => r.json());

    if (res.success && res.token) {
      localStorage.setItem('hostelaid_token', res.token);
      currentUser = res.user;
      updateAuthUI();
      applyRoleBasedUI();
      closeAuthModal();
      toast(`Signed in as ${currentUser.name} (${currentUser.role})`);
      await loadAllData();
      showView('overview');
    } else {
      toast(res.error || 'Login failed.');
    }
  } catch (err) {
    toast('Network error during login.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Sign In <span>→</span>';
  }
}

async function quickLogin(email, password) {
  document.getElementById('loginEmail').value = email;
  document.getElementById('loginPassword').value = password;
  document.getElementById('loginForm').dispatchEvent(new Event('submit'));
}

async function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value.trim();
  const role = document.getElementById('regRole').value;
  const phone = document.getElementById('regPhone').value.trim();
  const hostel_block = document.getElementById('regBlock').value.trim();
  const room_number = document.getElementById('regRoom').value.trim();
  const emergency_contact_name = document.getElementById('regEcName').value.trim();
  const emergency_contact_phone = document.getElementById('regEcPhone').value.trim();
  const medical_notes = document.getElementById('regMed').value.trim();

  const btn = document.getElementById('btnRegSubmit');
  btn.disabled = true;
  btn.textContent = 'Creating account...';

  try {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, email, password, role, phone, hostel_block, room_number,
        emergency_contact_name, emergency_contact_phone, medical_notes
      })
    }).then(r => r.json());

    if (res.success && res.token) {
      localStorage.setItem('hostelaid_token', res.token);
      currentUser = res.user;
      updateAuthUI();
      applyRoleBasedUI();
      closeAuthModal();
      toast(`Account created for ${currentUser.name}!`);
      loadAllData();
    } else {
      toast(res.error || 'Registration failed.');
    }
  } catch (err) {
    toast('Network error during registration.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Create Account <span>→</span>';
  }
}

function openProfileModal() {
  if (!currentUser) return;
  const initials = currentUser.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'U';
  document.getElementById('modalProfAvatar').textContent = initials;
  document.getElementById('modalProfName').textContent = currentUser.name;
  document.getElementById('modalProfRole').textContent = `${currentUser.role} · ${currentUser.email}`;
  const profNameInput = document.getElementById('profNameInput');
  if (profNameInput) profNameInput.value = currentUser.name || '';
  document.getElementById('profPhone').value = currentUser.phone || '';
  document.getElementById('profBlock').value = currentUser.hostel_block || '';
  document.getElementById('profRoom').value = currentUser.room_number || '';
  const profEcName = document.getElementById('profEcName');
  if (profEcName) profEcName.value = currentUser.emergency_contact_name || '';
  document.getElementById('profEcPhone').value = currentUser.emergency_contact_phone || '';
  document.getElementById('profMed').value = currentUser.medical_notes || '';
  const wardenNotice = document.getElementById('wardenPhoneNotice');
  if (wardenNotice) wardenNotice.style.display = currentUser.role === 'warden' ? 'block' : 'none';
  document.getElementById('profileModal').classList.remove('hidden');
}

function closeProfileModal() {
  document.getElementById('profileModal').classList.add('hidden');
}

async function handleProfileUpdate(e) {
  e.preventDefault();
  const nameEl = document.getElementById('profNameInput');
  const name = nameEl ? nameEl.value.trim() : currentUser.name;
  const phone = document.getElementById('profPhone').value.trim();
  const hostel_block = document.getElementById('profBlock').value.trim();
  const room_number = document.getElementById('profRoom').value.trim();
  const ecNameEl = document.getElementById('profEcName');
  const emergency_contact_name = ecNameEl ? ecNameEl.value.trim() : '';
  const emergency_contact_phone = document.getElementById('profEcPhone').value.trim();
  const medical_notes = document.getElementById('profMed').value.trim();

  try {
    const res = await fetch(`${API_BASE}/api/auth/profile`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ name, phone, hostel_block, room_number, emergency_contact_name, emergency_contact_phone, medical_notes })
    }).then(r => r.json());

    if (res.success && res.user) {
      currentUser = res.user;
      updateAuthUI();
      closeProfileModal();
      toast('Profile & emergency contact details updated in SQLite.');
      await loadAllData();
    } else {
      toast(res.error || 'Failed to update profile.');
    }
  } catch (err) {
    toast('Network error updating profile.');
  }
}

function handleLogout() {
  localStorage.removeItem('hostelaid_token');
  currentUser = null;
  updateAuthUI();
  applyRoleBasedUI();
  closeProfileModal();
  toast('Signed out successfully.');
  loadAllData();
  openAuthModal();
}

// ----------------- Data Loading -----------------
async function loadAllData(manual = false) {
  try {
    const role = currentUser ? currentUser.role : 'student';
    // If Doctor, can fetch medical incidents specifically or all
    const incUrl = role === 'responder' ? `${API_BASE}/api/incidents` : `${API_BASE}/api/incidents`;

    const [incRes, respRes, statRes, confRes, smsRes, smsConfRes, wardenRes] = await Promise.all([
      fetch(incUrl, { headers: authHeaders() }).then(r => r.json()),
      fetch(`${API_BASE}/api/responders`, { headers: authHeaders() }).then(r => r.json()),
      fetch(`${API_BASE}/api/stats`, { headers: authHeaders() }).then(r => r.json()),
      fetch(`${API_BASE}/api/config`, { headers: authHeaders() }).then(r => r.json()),
      fetch(`${API_BASE}/api/sms/logs`, { headers: authHeaders() }).then(r => r.json()),
      fetch(`${API_BASE}/api/sms/config`, { headers: authHeaders() }).then(r => r.json()),
      fetch(`${API_BASE}/api/contacts/duty-warden`, { headers: authHeaders() }).then(r => r.json()).catch(() => ({ success: false }))
    ]);

    if (incRes.success) incidents = incRes.incidents;
    if (respRes.success) responders = respRes.responders;
    if (statRes.success) stats = statRes.stats;
    if (smsRes.success) smsLogs = smsRes.logs;
    if (smsConfRes.success) smsConfig = smsConfRes;
    if (wardenRes && wardenRes.success && wardenRes.contact) {
      dutyWardenContact = wardenRes.contact;
    }
    if (confRes.success) {
      config = confRes;
      updateConfigUI();
    }

    renderAll();
    updateEmergencyCallUI();
    renderContactsDirectory();
    if (manual) toast('Live data refreshed from database.');
  } catch (err) {
    console.error('Error fetching live data:', err);
    if (manual) toast('Failed to connect to backend server.');
  }
}

function updateConfigUI() {
  const btn = document.getElementById('aiStatusBtn');
  const txt = document.getElementById('aiStatusText');
  const heroTag = document.getElementById('heroEngineTag');

  if (config.has_key) {
    btn.classList.remove('warning');
    const provName = config.provider === 'openai' ? 'OpenAI' : 'Gemini';
    txt.textContent = `✦ ${provName} Connected`;
    if (heroTag) heroTag.textContent = `${provName} (${config.model})`;
  } else {
    btn.classList.add('warning');
    txt.textContent = `⚙ Set AI API Key`;
    if (heroTag) heroTag.textContent = `Rule Engine (Click to set key)`;
  }
}

// ----------------- View Navigation -----------------
function showView(view) {
  const role = currentUser ? currentUser.role : 'student';

  // Prevent students from accessing admin tabs
  if (role === 'student' && (view === 'responders' || view === 'sms')) {
    view = 'overview';
  }

  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  const target = document.getElementById('view-' + view);
  if (target) target.classList.remove('hidden');

  document.querySelectorAll('.nav').forEach(n => {
    n.classList.toggle('active', n.dataset.view === view);
  });

  const titles = {
    overview: [
      role === 'student' ? 'Student Safety Dashboard ✦' : (role === 'responder' ? 'Medical Triage Station ✦' : 'Campus Safety Command ✦'),
      role === 'student' ? 'Report distress or check your emergency request status.' : (role === 'responder' ? 'Active clinical emergency intake and student medical care.' : 'A clearer view of incidents. Powered by SQLite, SMS & AI Triage.')
    ],
    report: [
      'Report an emergency',
      'Details are prioritized by AI, saved in SQLite, and alert campus personnel.'
    ],
    incidents: [
      role === 'student' ? 'My Emergency Requests' : (role === 'responder' ? 'Medical & Campus Incident Log' : 'Master Incident Log (Database)'),
      role === 'student' ? 'Status and responder updates for incidents reported by you.' : 'Timestamped audit records stored in hostelaid.db.'
    ],
    responders: [
      'Response network roster',
      'On-call emergency team and active availability across campus.'
    ],
    sms: [
      'SMS Emergency Dispatches',
      'Real-time log of automated SMS alerts sent across campus.'
    ],
    contacts: [
      'Campus Emergency Contacts & Speed Dial',
      'Direct telephone lines to hostel wardens, doctors, and emergency response teams.'
    ]
  };

  if (titles[view]) {
    document.getElementById('pageTitle').innerHTML = titles[view][0];
    document.getElementById('pageSub').textContent = titles[view][1];
  }

  if (view === 'incidents') renderFullList();
  if (view === 'responders') renderResponders();
  if (view === 'sms') renderSmsList();
  if (view === 'contacts') renderContactsDirectory();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ----------------- Rendering -----------------
function typeIcon(type) {
  return { Medical: '✚', Fire: '♨', Safety: '⚑', Disaster: '⌁' }[type] || '✚';
}

function typeClass(type) {
  return { Medical: 'red', Fire: 'red', Safety: 'blue', Disaster: 'purple' }[type] || 'blue';
}

function statusClass(s) {
  return (s || '').toLowerCase().replace(/\s+/g, '');
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function renderIncidentCard(x) {
  const timeStr = x.created_at ? new Date(x.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent';
  const role = currentUser ? currentUser.role : 'student';

  return `
    <article class="incident-card">
      <div class="incident-symbol ${typeClass(x.type)}">${typeIcon(x.type)}</div>
      <div class="incident-info">
        <b>${esc(x.title)}</b>
        <p>⌖ ${esc(x.location)} &nbsp;·&nbsp; ${esc(x.id)} &nbsp;·&nbsp; <span>${esc(x.assigned_to ? 'Lead: ' + x.assigned_to : 'Unassigned')}</span></p>
        ${role === 'responder' && x.reporter_medical_notes ? `<span style="font-size:10px;color:#b91c1c;background:#fee2e2;padding:2px 6px;border-radius:4px;display:inline-block;margin-top:4px">⚠️ Medical Note: ${esc(x.reporter_medical_notes)}</span>` : ''}
      </div>
      <span class="priority ${(x.priority || 'Medium').toLowerCase()}">${esc(x.priority)} priority</span>
      <span class="status ${statusClass(x.status)}">${esc(x.status)}</span>
      <span class="incident-time">${timeStr}</span>
      <button class="row-action" onclick="openIncident('${x.id}')">${role === 'student' ? 'View Status ↗' : 'Review ↗'}</button>
    </article>
  `;
}

function renderAll() {
  const role = currentUser ? currentUser.role : 'student';
  const openIncidents = incidents.filter(x => x.status !== 'Resolved');
  const openCount = openIncidents.length;

  document.getElementById('openStat').textContent = stats.open_incidents !== undefined ? stats.open_incidents : openCount;
  document.getElementById('smsStat').textContent = stats.total_sms_sent !== undefined ? stats.total_sms_sent : smsLogs.length;
  document.getElementById('usersStat').textContent = stats.total_users !== undefined ? stats.total_users : 3;
  document.getElementById('navCount').textContent = openCount;
  document.getElementById('smsCount').textContent = smsLogs.length;

  // Stat Card 1 Label customization
  const stat1Title = document.getElementById('stat1Title');
  if (stat1Title) {
    stat1Title.textContent = role === 'student' ? 'My Open Requests' : (role === 'responder' ? 'Active Emergencies' : 'Open Incidents');
  }

  // Stat Card 4 customization
  const stat4Title = document.getElementById('stat4Title');
  const stat4Foot = document.getElementById('stat4Foot');
  if (role === 'student') {
    if (stat4Title) stat4Title.textContent = 'My Resolved Calls';
    if (stat4Foot) stat4Foot.innerHTML = '<b class="green-text">Documented</b><span>Safety resolved</span>';
  } else if (role === 'responder') {
    if (stat4Title) stat4Title.textContent = 'Medical Cases';
    if (stat4Foot) stat4Foot.innerHTML = '<b class="green-text">Clinical Care</b><span>Hostel patients</span>';
  } else {
    if (stat4Title) stat4Title.textContent = 'Registered Residents';
    if (stat4Foot) stat4Foot.innerHTML = '<b class="green-text">Authenticated</b><span>Hostel database</span>';
  }

  if (stats.available_responders !== undefined && stats.total_responders !== undefined) {
    document.getElementById('availStat').innerHTML = `${stats.available_responders}<span class="unit">/${stats.total_responders}</span>`;
    document.getElementById('readinessFoot').textContent = `${stats.readiness_percent}% ready`;
    document.getElementById('donutPercent').textContent = `${stats.readiness_percent}%`;
    document.getElementById('readinessDonut').style.background = `conic-gradient(#6257e8 0 ${stats.readiness_percent}%, #eeeff7 ${stats.readiness_percent}% 100%)`;
    document.getElementById('legendAvail').textContent = stats.available_responders;
    document.getElementById('legendBusy').textContent = stats.total_responders - stats.available_responders;
  }

  const listEl = document.getElementById('incidentList');
  const boardTitle = document.getElementById('liveBoardTitle');
  if (boardTitle) {
    boardTitle.textContent = role === 'student' ? 'My Emergency Requests' : (role === 'responder' ? 'Medical Emergency Intake' : 'Live Campus Incident Board');
  }

  if (listEl) {
    if (openIncidents.length === 0) {
      listEl.innerHTML = role === 'student'
        ? '<div class="panel" style="text-align:center;color:#8992a7;padding:30px;">You have no active emergency requests. If you or a roommate need urgent assistance, click <b>"Report an emergency"</b> above.</div>'
        : '<div class="panel" style="text-align:center;color:#8992a7;padding:30px;">All incidents resolved. System ready for emergencies.</div>';
    } else {
      listEl.innerHTML = openIncidents.slice(0, 5).map(renderIncidentCard).join('');
    }
  }

  const heroLast = incidents[0];
  if (heroLast && document.getElementById('heroLastId')) {
    document.getElementById('heroLastId').textContent = `Incident #${heroLast.id}`;
  }

  renderFullList();
  renderResponders();
  renderSmsList();
}

function renderFullList() {
  const listEl = document.getElementById('fullIncidentList');
  if (!listEl) return;

  const role = currentUser ? currentUser.role : 'student';
  const q = (document.getElementById('searchIncidents')?.value || '').toLowerCase();
  const f = document.getElementById('filterStatus')?.value || 'All';

  let rows = incidents.filter(x => {
    const matchesFilter = (f === 'All' || x.status === f);
    const haystack = [x.id, x.title, x.location, x.type, x.status, x.desc, x.assigned_to, x.reporter].join(' ').toLowerCase();
    const matchesQuery = haystack.includes(q);
    return matchesFilter && matchesQuery;
  });

  listEl.innerHTML = `
    <div class="table-row header">
      <span>INCIDENT</span>
      <span>LOCATION & DETAILS</span>
      <span>PRIORITY</span>
      <span>STATUS</span>
      <span>ACTION</span>
    </div>
  ` + rows.map(x => {
    const timeStr = x.created_at ? new Date(x.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent';
    return `
      <div class="table-row">
        <div>
          <b>${esc(x.title)}</b>
          <div class="muted">${esc(x.id)} · ${timeStr}</div>
        </div>
        <div>
          <span>${esc(x.location)}</span>
          <div class="muted">${esc(x.assigned_to ? '👤 Lead: ' + x.assigned_to : 'No responder assigned')}</div>
          ${role === 'responder' && x.reporter_medical_notes ? `<div style="color:#b91c1c;font-size:9px">⚠️ ${esc(x.reporter_medical_notes)}</div>` : ''}
        </div>
        <span class="priority ${(x.priority || 'Medium').toLowerCase()}">${esc(x.priority)}</span>
        <span class="status ${statusClass(x.status)}">${esc(x.status)}</span>
        <button class="row-action" onclick="openIncident('${x.id}')">${role === 'student' ? 'View Details ↗' : 'Review ↗'}</button>
      </div>
    `;
  }).join('') + (rows.length ? '' : `<p class="muted" style="padding:25px;text-align:center">${role === 'student' ? 'You have no reported incidents matching this search.' : 'No records match your filters.'}</p>`);
}

function renderResponders() {
  const grid = document.getElementById('responderGrid');
  if (!grid) return;

  grid.innerHTML = responders.map(r => {
    const isAvail = r.state === 'Available';
    return `
      <div class="responder">
        <div class="responder-top">
          <div class="avatar">${esc(r.initials)}</div>
          <div>
            <b>${esc(r.name)}</b>
            <small>${esc(r.role)}</small>
          </div>
          <i class="available" style="background:${isAvail ? '#20b486' : '#efb54f'}"></i>
        </div>
        <p>${esc(r.skills)}<br><small style="color:#6b7280">📞 ${esc(r.phone || 'On file')}</small></p>
        <div style="display:flex;gap:6px">
          <button style="flex:1" onclick="toggleResponderState('${r.id}', '${r.state}')">
            ${isAvail ? 'Mark Busy' : 'Mark Available'}
          </button>
          <button style="flex:1;background:#f0fdf4;border-color:#bbf7d0;color:#15803d" onclick="dispatchQuickSms('${r.phone}', 'Emergency dispatch alert for ${r.name}')">
            SMS Alert
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function toggleResponderState(responderId, currentState) {
  const newState = currentState === 'Available' ? 'On incident' : 'Available';
  try {
    const res = await fetch(`${API_BASE}/api/responders/${responderId}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ state: newState })
    }).then(r => r.json());

    if (res.success) {
      toast(`Responder marked as ${newState}.`);
      loadAllData();
    }
  } catch (err) {
    toast('Failed to update responder state.');
  }
}

// ----------------- Dynamic Emergency Calling & Contacts Directory -----------------
function updateEmergencyCallUI() {
  const cleanPhone = (dutyWardenContact.phone || '+91 98765 43210').replace(/\s+/g, '');
  const wardenName = dutyWardenContact.name || 'Aarav Sharma (Warden)';
  const wardenPhone = dutyWardenContact.phone || '+91 98765 43210';

  // 1. Overview SOS Banner
  const sosBanner = document.getElementById('sosWardenBanner');
  if (sosBanner) {
    const subtitle = sosBanner.querySelector('p');
    if (subtitle) subtitle.textContent = `Direct priority line to Hostel Duty Warden (${wardenName}) · 24/7 Response Desk`;
    const btn = sosBanner.querySelector('a.btn-call-sos');
    if (btn) {
      btn.href = `tel:${cleanPhone}`;
      btn.textContent = `📞 Call Warden Directly: ${wardenPhone}`;
      btn.setAttribute('onclick', `toast('Initiating direct call to ${wardenName}: ${wardenPhone}')`);
    }
  }

  // 2. Report Form Urgent Call Bar
  const urgentBar = document.getElementById('reportUrgentCallBar');
  if (urgentBar) {
    const btn = urgentBar.querySelector('a');
    if (btn) {
      btn.href = `tel:${cleanPhone}`;
      btn.textContent = `📞 Call Warden Now (${wardenPhone})`;
      btn.setAttribute('onclick', `toast('Connecting to Duty Warden: ${wardenPhone}')`);
    }
  }

  // 3. Contacts View Banner
  const dirWardenBtn = document.getElementById('directoryWardenCallBtn');
  if (dirWardenBtn) {
    dirWardenBtn.href = `tel:${cleanPhone}`;
    dirWardenBtn.textContent = `📞 Call Warden Now: ${wardenPhone}`;
    dirWardenBtn.setAttribute('onclick', `toast('Calling Hostel Duty Warden (${wardenPhone})...')`);
  }
  const dirWardenSub = document.getElementById('directoryWardenSubtitle');
  if (dirWardenSub) {
    dirWardenSub.textContent = `Direct priority line to Hostel Duty Warden (${wardenName}) · Block A & Campus Central.`;
  }

  // 4. Overview Quick Contacts List
  const quickList = document.getElementById('overviewQuickContactsList');
  if (quickList && responders.length > 0) {
    quickList.innerHTML = responders.slice(0, 3).map(r => {
      const isWarden = (r.role || '').toLowerCase().includes('warden');
      const isDoctor = (r.role || '').toLowerCase().includes('medical') || (r.role || '').toLowerCase().includes('doctor');
      const icon = isWarden ? '♙' : (isDoctor ? '✚' : '⌂');
      const color = isWarden ? 'blue' : (isDoctor ? 'red' : 'purple');
      const cleanRPhone = (r.phone || '').replace(/\s+/g, '');
      return `
        <div class="contact">
          <div class="contact-icon ${color}">${icon}</div>
          <div>
            <b>${esc(r.role)}</b>
            <small>${esc(r.name)} · ${esc(r.phone || 'No phone')}</small>
          </div>
          <div class="contact-actions">
            ${r.phone ? `<a href="tel:${cleanRPhone}" class="btn-call" onclick="toast('Calling ${esc(r.name)}: ${esc(r.phone)}')">📞 Call</a>` : ''}
            ${r.phone ? `<button onclick="dispatchQuickSms('${esc(r.phone)}', 'Emergency check requested by resident for ${esc(r.name)}.')">💬 SMS</button>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }
}

function renderContactsDirectory() {
  const grid = document.getElementById('contactsDirectoryGrid');
  if (!grid) return;

  const role = currentUser ? currentUser.role : 'student';
  const isStaff = role === 'warden' || role === 'responder';

  const addBtn = document.getElementById('btnAddContactHeader');
  if (addBtn) addBtn.style.display = isStaff ? 'inline-block' : 'none';

  if (!responders || responders.length === 0) {
    grid.innerHTML = '<p class="muted" style="padding:25px;text-align:center">No emergency contacts registered yet.</p>';
    return;
  }

  grid.innerHTML = responders.map(r => {
    const isAvail = r.state === 'Available';
    const cleanPhone = (r.phone || '').replace(/\s+/g, '');
    const isWarden = (r.role || '').toLowerCase().includes('warden');

    return `
      <div class="responder" style="position:relative">
        <div class="responder-top">
          <div class="avatar" style="background:${isWarden ? '#6257e8' : '#3b82f6'};color:#fff">${esc(r.initials || 'EM')}</div>
          <div style="flex:1">
            <b>${esc(r.name)}</b>
            <small>${esc(r.role)}</small>
          </div>
          <span class="status-pill" style="font-size:10px;background:${isAvail ? '#dcfce7' : '#fef3c7'};color:${isAvail ? '#15803d' : '#b45309'}">
            ${isAvail ? '● Available' : (r.state === 'Offline' ? '○ Offline' : '● On incident')}
          </span>
        </div>
        <p style="margin:8px 0 12px;font-size:12px;line-height:1.5;color:#475569">
          ${esc(r.skills || 'Emergency contact and assistance.')}<br>
          <span style="display:inline-block;margin-top:4px;font-weight:700;color:#1e293b">📞 Phone: ${esc(r.phone || 'Not provided')}</span>
        </p>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${r.phone ? `
            <a href="tel:${cleanPhone}" class="btn-call" style="flex:1;text-align:center;padding:8px 10px;font-weight:700;text-decoration:none" onclick="toast('Calling ${esc(r.name)}: ${esc(r.phone)}')">
              📞 Direct Call
            </a>
            <button style="flex:1;background:#f0fdf4;border-color:#bbf7d0;color:#15803d;padding:8px 10px" onclick="dispatchQuickSms('${esc(r.phone)}', 'Emergency alert: Student requested urgent contact with ${esc(r.name)}')">
              💬 SMS Alert
            </button>
          ` : '<span class="muted" style="font-size:11px">No phone on file</span>'}
          ${isStaff ? `
            <button style="width:100%;margin-top:4px;background:#f8f9fe;border-color:#cbd5e1;color:#334155;font-size:11px;padding:6px" onclick="openEditContactModal('${r.id}')">
              ✏ Edit Number & Username
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function openEditContactModal(id) {
  const contact = responders.find(r => r.id === id);
  if (!contact) return;

  document.getElementById('editContactModalTitle').textContent = `Edit Contact: ${contact.name}`;
  document.getElementById('editContactId').value = contact.id;
  document.getElementById('editContactName').value = contact.name || '';
  document.getElementById('editContactPhone').value = contact.phone || '';
  document.getElementById('editContactRole').value = contact.role || '';
  document.getElementById('editContactSkills').value = contact.skills || '';
  document.getElementById('editContactState').value = contact.state || 'Available';
  
  const isWarden = (contact.role || '').toLowerCase().includes('warden') || contact.phone === dutyWardenContact.phone;
  document.getElementById('editContactIsPrimaryWarden').checked = isWarden;

  const delBtn = document.getElementById('btnDeleteContact');
  if (delBtn) delBtn.style.display = 'inline-block';

  document.getElementById('editContactModal').classList.remove('hidden');
}

function openAddContactModal() {
  document.getElementById('editContactModalTitle').textContent = 'Add Emergency Contact';
  document.getElementById('editContactForm').reset();
  document.getElementById('editContactId').value = '';
  document.getElementById('editContactState').value = 'Available';
  document.getElementById('editContactIsPrimaryWarden').checked = false;

  const delBtn = document.getElementById('btnDeleteContact');
  if (delBtn) delBtn.style.display = 'none';

  document.getElementById('editContactModal').classList.remove('hidden');
}

function closeEditContactModal() {
  document.getElementById('editContactModal').classList.add('hidden');
}

async function handleSaveContact(e) {
  e.preventDefault();
  const id = document.getElementById('editContactId').value;
  const name = document.getElementById('editContactName').value.trim();
  const phone = document.getElementById('editContactPhone').value.trim();
  const role = document.getElementById('editContactRole').value.trim();
  const skills = document.getElementById('editContactSkills').value.trim();
  const state = document.getElementById('editContactState').value;
  const isPrimaryWarden = document.getElementById('editContactIsPrimaryWarden').checked;

  const saveBtn = document.getElementById('btnSaveContact');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    let res;
    if (id) {
      res = await fetch(`${API_BASE}/api/responders/${id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ name, phone, role, skills, state })
      }).then(r => r.json());
    } else {
      res = await fetch(`${API_BASE}/api/responders`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name, phone, role, skills, state })
      }).then(r => r.json());
    }

    if (isPrimaryWarden) {
      await fetch(`${API_BASE}/api/contacts/duty-warden`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name, phone })
      });
      dutyWardenContact = { name, phone };
    }

    if (res.success) {
      toast(`Emergency contact "${name}" saved successfully!`);
      closeEditContactModal();
      await loadAllData();
    } else {
      toast(res.error || 'Failed to save contact.');
    }
  } catch (err) {
    toast('Network error saving contact.');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Contact 💾';
  }
}

async function handleDeleteContact() {
  const id = document.getElementById('editContactId').value;
  if (!id) return;
  const name = document.getElementById('editContactName').value;
  if (!confirm(`Are you sure you want to delete emergency contact "${name}"?`)) return;

  try {
    const res = await fetch(`${API_BASE}/api/responders/${id}`, {
      method: 'DELETE',
      headers: authHeaders()
    }).then(r => r.json());

    if (res.success) {
      toast(`Emergency contact "${name}" deleted.`);
      closeEditContactModal();
      await loadAllData();
    } else {
      toast('Failed to delete contact.');
    }
  } catch (err) {
    toast('Network error deleting contact.');
  }
}

// ----------------- SMS Dispatches Rendering & Action -----------------
function renderSmsList() {
  const listEl = document.getElementById('fullSmsList');
  if (!listEl) return;

  listEl.innerHTML = `
    <div class="sms-row header">
      <span>INCIDENT</span>
      <span>RECIPIENT</span>
      <span>MESSAGE BODY</span>
      <span>DELIVERY STATUS</span>
      <span>SENT TIME</span>
    </div>
  ` + smsLogs.map(s => {
    const statusType = (s.status || '').toLowerCase().includes('failed') ? 'failed' : ((s.status || '').toLowerCase().includes('simulated') ? 'simulated' : 'sent');
    const timeStr = s.created_at ? new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent';
    return `
      <div class="sms-row">
        <b>${esc(s.incident_id || 'Direct')}</b>
        <div>
          <b>${esc(s.recipient_name || 'Resident')}</b>
          <div class="muted">${esc(s.recipient_phone)}</div>
        </div>
        <div style="font-size:11px;color:#334155;line-height:1.4">${esc(s.message)}</div>
        <span class="sms-pill ${statusType}">${esc(s.status)}</span>
        <span class="muted">${timeStr}</span>
      </div>
    `;
  }).join('') + (smsLogs.length ? '' : '<p class="muted" style="padding:25px;text-align:center">No SMS broadcasts sent yet.</p>');
}

async function dispatchQuickSms(phone, message) {
  try {
    const res = await fetch(`${API_BASE}/api/sms/send`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ to_phone: phone, message })
    }).then(r => r.json());

    if (res.success) {
      toast(`SMS Alert Dispatched: ${res.status}`);
      loadAllData();
    } else {
      toast(`SMS failed: ${res.error || 'Check credentials'}`);
    }
  } catch (err) {
    toast('Network error dispatching SMS.');
  }
}

function openSendSmsModal() {
  document.getElementById('sendSmsModal').classList.remove('hidden');
}

function closeSendSmsModal() {
  document.getElementById('sendSmsModal').classList.add('hidden');
}

async function handleSendOnDemandSms(e) {
  e.preventDefault();
  const to_phone = document.getElementById('manualSmsPhone').value.trim();
  const recipient_name = document.getElementById('manualSmsName').value.trim();
  const message = document.getElementById('manualSmsMessage').value.trim();
  const btn = document.getElementById('btnManualSms');

  btn.disabled = true;
  btn.textContent = 'Sending SMS...';

  try {
    const res = await fetch(`${API_BASE}/api/sms/send`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ to_phone, recipient_name, message })
    }).then(r => r.json());

    if (res.success) {
      toast(`Emergency SMS Dispatched (${res.status})!`);
      closeSendSmsModal();
      e.target.reset();
      loadAllData();
    } else {
      toast(res.error || 'Failed to send SMS.');
    }
  } catch (err) {
    toast('Network error sending SMS.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send SMS Broadcast 🚀';
  }
}

// ----------------- Role-Tailored Incident Modal -----------------
async function openIncident(id) {
  activeId = id;
  const role = currentUser ? currentUser.role : 'student';

  try {
    const res = await fetch(`${API_BASE}/api/incidents/${id}`, { headers: authHeaders() }).then(r => r.json());
    if (!res.success || !res.incident) {
      toast('Incident not found.');
      return;
    }
    const x = res.incident;
    const actionsList = (x.actions || []).map(a => {
      const text = typeof a === 'object' ? a.action_text : a;
      const time = a.created_at ? new Date(a.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      return `<div>✓ <span>${esc(text)} ${time ? `<small class="muted">(${time})</small>` : ''}</span></div>`;
    }).join('');

    // Status progression pill bar for students
    const isResponding = x.status === 'Responding';
    const isResolved = x.status === 'Resolved';
    const studentProgressHtml = `
      <div style="background:#f8f9fe;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin:12px 0 16px">
        <small style="color:#64748b;font-weight:700;display:block;margin-bottom:8px">LIVE RESPONSE TRACKER:</small>
        <div style="display:flex;align-items:center;gap:6px;font-size:10px">
          <span style="background:#22c55e;color:#fff;padding:4px 8px;border-radius:6px;font-weight:700">✓ Received</span>
          <span>→</span>
          <span style="background:${isResponding || isResolved ? '#3b82f6' : '#e2e8f0'};color:${isResponding || isResolved ? '#fff' : '#64748b'};padding:4px 8px;border-radius:6px;font-weight:700">
            ${isResponding ? '⚡ Responder Dispatched' : (isResolved ? '✓ Attended' : 'Assigning Lead')}
          </span>
          <span>→</span>
          <span style="background:${isResolved ? '#22c55e' : '#e2e8f0'};color:${isResolved ? '#fff' : '#64748b'};padding:4px 8px;border-radius:6px;font-weight:700">
            ${isResolved ? '✓ Incident Resolved' : 'Resolution'}
          </span>
        </div>
      </div>
    `;

    // Patient Medical History Card (Displayed for Doctor & Warden)
    const patientMedCard = (x.reporter_medical_notes || x.reporter_ec_phone) ? `
      <div class="ai-guidance-card" style="margin-bottom:14px;background:#fef2f2;border-color:#fecaca">
        <b style="color:#991b1b">🩺 RESIDENT HEALTH PROFILE & EMERGENCY CONTACT:</b>
        <p style="color:#7f1d1d;margin-top:4px">
          ${x.reporter_medical_notes ? `<b>Medical Notes:</b> ${esc(x.reporter_medical_notes)}<br>` : ''}
          ${x.reporter_room ? `<b>Assigned Room:</b> ${esc(x.reporter_room)}<br>` : ''}
          ${x.reporter_ec_phone ? `<b>Guardian Contact:</b> ${esc(x.reporter_ec_name || 'Guardian')} (${esc(x.reporter_ec_phone)})` : ''}
        </p>
      </div>
    ` : '';

    // Action buttons tailored to role
    let actionButtons = '';
    if (role === 'student') {
      const wPhone = dutyWardenContact.phone || '+91 98765 43210';
      const cleanWPhone = wPhone.replace(/\s+/g, '');
      const wName = dutyWardenContact.name || 'Duty Warden';
      actionButtons = `
        <a href="tel:${cleanWPhone}" class="btn-call-sos" style="font-size:11px;padding:9px 14px;text-decoration:none" onclick="toast('Calling ${esc(wName)}: ${esc(wPhone)}')">📞 Call Duty Warden (${esc(wPhone)})</a>
        <button onclick="promptAddAction()">+ Add Note to Warden</button>
        <button type="button" class="btn-primary" onclick="closeModal()">Close Window</button>
      `;
    } else if (role === 'responder') {
      // Doctor View: Clinical Actions
      actionButtons = `
        <button class="btn-primary" onclick="updateIncidentStatus('Responding')">Attend Patient (Dispatched) ↗</button>
        <button onclick="promptAddAction()">+ Clinical Note / Prescription</button>
        <button class="btn-success" onclick="updateIncidentStatus('Resolved')">Mark Treated & Resolved ✓</button>
      `;
    } else {
      // Warden View: Full Command Actions
      actionButtons = `
        <button class="btn-primary" onclick="updateIncidentStatus('Responding')">Mark Responding (Auto-SMS) ↗</button>
        <button onclick="promptAssignResponder()">Assign Lead 👤</button>
        <button onclick="promptAddAction()">+ Timeline Note</button>
        <button class="btn-success" onclick="updateIncidentStatus('Resolved')">Resolve Incident ✓</button>
      `;
    }

    document.getElementById('modalContent').innerHTML = `
      <div class="eyebrow">${esc(x.id)} · ${role === 'student' ? 'MY EMERGENCY RECORD' : 'CAMPUS INCIDENT RECORD'}</div>
      <h3>${esc(x.title)}</h3>
      <p style="font-size:13px;color:#374151">${esc(x.desc)}</p>

      <div class="modal-meta">
        <span class="priority ${(x.priority || 'Medium').toLowerCase()}">${esc(x.priority)} priority</span>
        <span class="status ${statusClass(x.status)}">${esc(x.status)}</span>
        <span class="step-pill">${esc(x.type)}</span>
        ${x.assigned_to ? `<span class="step-pill" style="background:#eaf4ff;color:#3b82f6">Lead: ${esc(x.assigned_to)}</span>` : ''}
      </div>

      ${role === 'student' ? studentProgressHtml : ''}
      ${(role === 'responder' || role === 'warden') ? patientMedCard : ''}

      <p style="margin:12px 0;line-height:1.7">
        <b>Location:</b> ${esc(x.location)}<br>
        <b>Reported by:</b> ${esc(x.reporter || 'Anonymous')} ${x.callback ? `· 📞 ${esc(x.callback)}` : ''}<br>
        <b>People affected:</b> ${esc(x.people || '1 person')}<br>
        <b>Reported time:</b> ${new Date(x.created_at).toLocaleString()}
      </p>

      ${x.first_aid_guidance ? `
        <div class="ai-guidance-card" style="margin-bottom:14px;background:#f0fdf4;border-color:#bbf7d0">
          <b style="color:#166534">✚ Immediate First-Aid Instructions:</b>
          <p style="color:#14532d">${esc(x.first_aid_guidance)}</p>
        </div>
      ` : ''}

      ${x.ai_rationale ? `
        <div class="ai-guidance-card" style="margin-bottom:14px">
          <b>✦ AI Triage Rationale:</b>
          <p>${esc(x.ai_rationale)}</p>
        </div>
      ` : ''}

      <h3 style="font-size:13px;margin-top:16px">Activity & Audit Timeline (SQLite)</h3>
      <div class="checklist" style="grid-template-columns:1fr">${actionsList}</div>

      <div class="modal-actions" style="margin-top:24px">
        ${actionButtons}
      </div>
    `;

    document.getElementById('detailModal').classList.remove('hidden');
  } catch (err) {
    toast('Error loading incident details.');
  }
}

function closeModal() {
  document.getElementById('detailModal').classList.add('hidden');
}

async function updateIncidentStatus(status) {
  if (!activeId) return;
  try {
    const res = await fetch(`${API_BASE}/api/incidents/${activeId}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ status })
    }).then(r => r.json());

    if (res.success) {
      toast(`Status updated to ${status}. SMS dispatched.`);
      openIncident(activeId);
      loadAllData();
    }
  } catch (err) {
    toast('Failed to update status.');
  }
}

async function promptAssignResponder() {
  if (!activeId) return;
  const responderNames = responders.map(r => r.name).join('\n');
  const chosen = prompt(`Select responder name to assign:\n\n${responderNames}`);
  if (!chosen) return;

  try {
    const res = await fetch(`${API_BASE}/api/incidents/${activeId}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ assigned_to: chosen.trim() })
    }).then(r => r.json());

    if (res.success) {
      toast(`Assigned lead: ${chosen}. SMS sent.`);
      openIncident(activeId);
      loadAllData();
    }
  } catch (err) {
    toast('Failed to assign responder.');
  }
}

async function promptAddAction() {
  if (!activeId) return;
  const note = prompt('Enter a note or update for the incident log:');
  if (!note || !note.trim()) return;

  try {
    const res = await fetch(`${API_BASE}/api/incidents/${activeId}/actions`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ action_text: note.trim() })
    }).then(r => r.json());

    if (res.success) {
      toast('Note recorded in SQLite timeline.');
      openIncident(activeId);
      loadAllData();
    }
  } catch (err) {
    toast('Failed to save note.');
  }
}

// ----------------- Real-time AI Triage in Report Form -----------------
async function triggerAiAssess() {
  const desc = document.getElementById('details')?.value.trim() || '';
  const type = document.querySelector('input[name=type]:checked')?.value || 'Medical';
  const location = document.getElementById('location')?.value || 'Unspecified';
  const people = document.getElementById('people')?.value || '1 person';

  if (!desc) {
    document.getElementById('triageEngineTag').textContent = '✦ AI Standby';
    document.getElementById('triageTitle').textContent = 'Ready to assess details';
    document.getElementById('triageRationale').textContent = 'Enter an emergency description above to get an instant AI evaluation.';
    document.getElementById('firstAidCard').style.display = 'none';
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/ai/assess`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ desc, type, location, people })
    }).then(r => r.json());

    if (res.success && res.assessment) {
      const a = res.assessment;
      currentAiAssessment = a;

      document.getElementById('triageEngineTag').textContent = a.is_ai ? `✦ ${a.engine}` : `✦ ${a.engine}`;
      document.getElementById('triageTitle').textContent = a.summary_title || `Suggested priority: ${a.priority}`;
      document.getElementById('triageRationale').textContent = a.rationale;

      const badge = document.getElementById('triagePriorityBadge');
      badge.textContent = `${a.priority} priority`;
      badge.className = `priority ${(a.priority || 'Medium').toLowerCase()}`;

      if (a.first_aid_guidance) {
        document.getElementById('firstAidText').textContent = a.first_aid_guidance;
        document.getElementById('firstAidCard').style.display = 'block';
      } else {
        document.getElementById('firstAidCard').style.display = 'none';
      }
    }
  } catch (err) {
    console.error('Error during AI triage:', err);
  }
}

// ----------------- Create Incident Form Submit -----------------
async function handleIncidentSubmit(e) {
  e.preventDefault();

  const confirmBox = document.getElementById('confirm');
  if (!confirmBox || !confirmBox.checked) {
    toast('Please confirm the emergency safety notice.');
    return;
  }

  const type = document.querySelector('input[name=type]:checked')?.value || 'Medical';
  const desc = document.getElementById('details').value.trim();
  const location = document.getElementById('location').value;
  const people = document.getElementById('people').value;
  const reporter = document.getElementById('reporter').value.trim();
  const callback = document.getElementById('callback').value.trim();

  if (!desc || !location) {
    toast('Please provide both description and location.');
    return;
  }

  const btn = document.getElementById('btnSubmitIncident');
  btn.disabled = true;
  btn.textContent = 'Saving & Broadcasting SMS...';

  try {
    const payload = {
      type,
      desc,
      location,
      people,
      reporter,
      callback,
      priority: currentAiAssessment?.priority,
      ai_rationale: currentAiAssessment?.rationale,
      first_aid_guidance: currentAiAssessment?.first_aid_guidance,
      assigned_to: currentAiAssessment?.suggested_responder
    };

    const res = await fetch(`${API_BASE}/api/incidents`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload)
    }).then(r => r.json());

    if (res.success && res.incident) {
      toast(`Emergency logged! SMS sent to campus emergency responders.`);
      e.target.reset();
      currentAiAssessment = null;
      document.querySelector('.type-option')?.click();
      confirmBox.checked = false;
      await loadAllData();
      showView('incidents');
      openIncident(res.incident.id);
    } else {
      toast(res.error || 'Failed to create incident.');
    }
  } catch (err) {
    toast('Network error saving incident.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Create Incident & Broadcast SMS <span>→</span>';
  }
}

// ----------------- Settings Modal (AI + SMS Tabs) -----------------
function openSettingsModal() {
  switchSettingsTab('ai');
  document.getElementById('aiProvider').value = config.provider || 'gemini';
  document.getElementById('aiModel').value = config.model || 'gemini-1.5-flash';
  document.getElementById('aiApiKey').value = '';
  document.getElementById('aiApiKey').placeholder = config.has_key ? `Configured (${config.masked_key}) - Enter new key to change` : 'Paste your API Key here';
  document.getElementById('testResult').style.display = 'none';

  document.getElementById('smsProvider').value = smsConfig.provider || 'simulation';
  document.getElementById('twilioSid').value = smsConfig.twilio_sid || '';
  document.getElementById('twilioFrom').value = smsConfig.twilio_from || '';
  document.getElementById('twilioToken').value = '';
  document.getElementById('fast2smsKey').value = '';
  onSmsProviderChange();

  document.getElementById('settingsModal').classList.remove('hidden');
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.add('hidden');
}

function switchSettingsTab(tab) {
  const tabAi = document.getElementById('tabAiSettings');
  const tabSms = document.getElementById('tabSmsSettings');
  const secAi = document.getElementById('settingsSectionAi');
  const secSms = document.getElementById('settingsSectionSms');

  if (tab === 'ai') {
    tabAi.classList.add('active');
    tabSms.classList.remove('active');
    secAi.style.display = 'block';
    secSms.style.display = 'none';
  } else {
    tabAi.classList.remove('active');
    tabSms.classList.add('active');
    secAi.style.display = 'none';
    secSms.style.display = 'block';
  }
}

function onProviderChange() {
  const p = document.getElementById('aiProvider').value;
  const m = document.getElementById('aiModel');
  if (p === 'openai') {
    m.value = 'gpt-4o-mini';
  } else {
    m.value = 'gemini-1.5-flash';
  }
}

function onSmsProviderChange() {
  const p = document.getElementById('smsProvider').value;
  document.getElementById('twilioFields').style.display = p === 'twilio' ? 'block' : 'none';
  document.getElementById('fast2smsFields').style.display = p === 'fast2sms' ? 'block' : 'none';
}

async function testApiKey() {
  const provider = document.getElementById('aiProvider').value;
  const key = document.getElementById('aiApiKey').value.trim();
  const model = document.getElementById('aiModel').value.trim();
  const resultEl = document.getElementById('testResult');

  resultEl.style.display = 'block';
  resultEl.className = 'test-result';
  resultEl.textContent = 'Testing connection with AI service...';

  try {
    const res = await fetch(`${API_BASE}/api/config/test`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ provider, key, model })
    }).then(r => r.json());

    if (res.success) {
      resultEl.className = 'test-result success';
      resultEl.textContent = `✓ ${res.message}`;
    } else {
      resultEl.className = 'test-result error';
      resultEl.textContent = `✕ ${res.message}`;
    }
  } catch (err) {
    resultEl.className = 'test-result error';
    resultEl.textContent = 'Network error testing API key.';
  }
}

async function saveApiKey() {
  const provider = document.getElementById('aiProvider').value;
  const key = document.getElementById('aiApiKey').value.trim();
  const model = document.getElementById('aiModel').value.trim();
  const btn = document.getElementById('btnSaveKey');

  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const res = await fetch(`${API_BASE}/api/config`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ provider, key, model })
    }).then(r => r.json());

    if (res.success) {
      toast('AI Settings saved successfully.');
      await loadAllData();
      closeSettingsModal();
    } else {
      toast('Failed to save configuration.');
    }
  } catch (err) {
    toast('Error connecting to backend.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save & Connect 💾';
  }
}

async function saveSmsConfig() {
  const provider = document.getElementById('smsProvider').value;
  const twilio_sid = document.getElementById('twilioSid').value.trim();
  const twilio_token = document.getElementById('twilioToken').value.trim();
  const twilio_from = document.getElementById('twilioFrom').value.trim();
  const fast2sms_key = document.getElementById('fast2smsKey').value.trim();
  const btn = document.getElementById('btnSaveSms');

  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const res = await fetch(`${API_BASE}/api/sms/config`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ provider, twilio_sid, twilio_token, twilio_from, fast2sms_key })
    }).then(r => r.json());

    if (res.success) {
      toast('SMS Gateway preferences saved in SQLite.');
      await loadAllData();
      closeSettingsModal();
    } else {
      toast('Failed to save SMS preferences.');
    }
  } catch (err) {
    toast('Error saving SMS preferences.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save SMS Gateway 💾';
  }
}

async function testSmsSend() {
  const resultEl = document.getElementById('smsTestResult');
  resultEl.style.display = 'block';
  resultEl.className = 'test-result';
  resultEl.textContent = 'Dispatching test SMS...';

  try {
    const res = await fetch(`${API_BASE}/api/sms/send`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        to_phone: '+91 98765 43210',
        message: '[HOSTELAID] Test emergency alert broadcast from settings.'
      })
    }).then(r => r.json());

    if (res.success) {
      resultEl.className = 'test-result success';
      resultEl.textContent = `✓ SMS Dispatched successfully: ${res.status}`;
      loadAllData();
    } else {
      resultEl.className = 'test-result error';
      resultEl.textContent = `✕ SMS test failed: ${res.error}`;
    }
  } catch (err) {
    resultEl.className = 'test-result error';
    resultEl.textContent = 'Network error during SMS test.';
  }
}

function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}
