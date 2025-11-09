/* TripMosaic - Client-only prototype
   - No backend, all data in localStorage
   - Features: trips, itinerary (drag/drop), map POIs (Leaflet), expenses (equal/percent/shares basics),
     balances, chat (local), polls, tasks + RSVP, file upload (base64), export JSON.
*/

// ---------- helpers ----------
const LS_KEY = 'tripmosaic_client_v1';
function uid(pref='id'){ return pref + '_' + Date.now() + '_' + Math.floor(Math.random()*9000) }
function loadData(){ try{ return JSON.parse(localStorage.getItem(LS_KEY) || '[]') }catch(e){ return [] } }
function saveData(v){ localStorage.setItem(LS_KEY, JSON.stringify(v)) }
function toast(msg, t=2000){ const el=document.createElement('div'); el.className='toast'; el.textContent=msg; document.body.appendChild(el); setTimeout(()=>el.remove(), t) }
function qs(s){ return document.querySelector(s) }
function qsa(s){ return Array.from(document.querySelectorAll(s)) }

// ---------- state ----------
let allData = loadData(); // array of objects with .type (trip,itinerary,expense,member,message,poll,task,file)
let view = 'landing'; // landing | dashboard | trip
let currentTrip = null;
let mapInstances = {}; // tripId->Leaflet map

// ---------- core models ----------
// Trip: { type:'trip', id, title, startDate, endDate, cover, createdAt }
// Member: { type:'member', tripId, memberId, name, email, role }
// Itinerary: { type:'itinerary', tripId, itemId, title, day, time, location, lat,lng, notes, assignedTo, rsvp:{memberId:status} }
// Expense: { type:'expense', tripId, id, title, amount, currency, payer, participants[], splitType:'equal'|'percent'|'shares', shares:{} }
// Message: { type:'message', tripId, id, sender, text, ts }
// Poll: { type:'poll', tripId, id, question, options:[{opt, votes:[]}] }
// Task: { type:'task', tripId, id, title, assignedTo, due, completed }
// File: { type:'file', tripId, id, name, mime, dataBase64 }

// ---------- rendering ----------
function render(){
  const app = qs('#app'); if(!app) return;
  if(view === 'landing') return renderLanding(app);
  if(view === 'dashboard') return renderDashboard(app);
  if(view === 'trip') return renderTrip(app, currentTrip);
}

// --- Landing ---
function renderLanding(root){
  root.innerHTML = `
    <div class="container">
      <div class="header">
        <div>
          <div class="hlogo">TripMosaic</div>
          <div class="small">Collaborative trip planner — prototype (local only)</div>
        </div>
        <div class="controls">
          <button class="btn" id="btnNewTrip">Create New Trip</button>
          <button class="btn secondary" id="btnViewAll">View Trips</button>
        </div>
      </div>
      <div style="margin-top:14px" class="card">
        <div class="small">Quick: Create a trip then open it. In trip, click map to add POI markers and add expenses. Invite members to track balances.</div>
      </div>
    </div>
  `;
  qs('#btnNewTrip').addEventListener('click', ()=>{
    const t = { type:'trip', id: uid('trip'), title: 'Weekend Getaway', startDate: new Date().toISOString(), endDate:'', cover:'', createdAt: new Date().toISOString() };
    allData.push(t); saveData(allData); toast('Trip created'); currentTrip = t.id; view='trip'; render();
  });
  qs('#btnViewAll').addEventListener('click', ()=>{ view='dashboard'; render() });
}

// --- Dashboard ---
function renderDashboard(root){
  const trips = allData.filter(x=>x.type==='trip').sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
  root.innerHTML = `
    <div class="container">
      <div class="header">
        <div>
          <div class="hlogo">Trips</div>
          <div class="small">All trips (local)</div>
        </div>
        <div><button class="btn" id="btnNewFromDash">New Trip</button></div>
      </div>
      <div style="margin-top:12px" class="card">
        ${trips.length===0 ? '<div class="small">No trips yet</div>' : trips.map(t=>`
          <div class="list-item">
            <div>
              <div style="font-weight:600">${t.title}</div>
              <div class="small">Created: ${new Date(t.createdAt).toLocaleString()}</div>
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn" data-open="${t.id}">Open</button>
              <button class="btn secondary" data-export="${t.id}">Export</button>
              <button class="btn secondary" data-delete="${t.id}">Delete</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  qs('#btnNewFromDash').addEventListener('click', ()=>{ const t = { type:'trip', id: uid('trip'), title:'New Trip', startDate:new Date().toISOString(), createdAt:new Date().toISOString() }; allData.push(t); saveData(allData); render(); });

  qsa('[data-open]').forEach(b=> b.addEventListener('click', e=>{ currentTrip = e.currentTarget.getAttribute('data-open'); view='trip'; render(); }));
  qsa('[data-delete]').forEach(b=> b.addEventListener('click', e=>{
    const id = e.currentTarget.getAttribute('data-delete');
    if(!confirm('Delete trip?')) return;
    allData = allData.filter(x=> !(x.type==='trip' && x.id===id) && x.tripId !== id);
    saveData(allData); render();
  }));
  qsa('[data-export]').forEach(b=> b.addEventListener('click', e=>{
    const id = e.currentTarget.getAttribute('data-export');
    const payload = allData.filter(x=> x.type==='trip' ? x.id===id : x.tripId===id || false);
    const blob = new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download = `trip-${id}.json`; a.click(); URL.revokeObjectURL(url);
  }));
}

// --- Trip View ---
function renderTrip(root, tripId){
  const trip = allData.find(t=> t.type==='trip' && t.id===tripId);
  if(!trip){ view='dashboard'; render(); return; }
  const members = allData.filter(x=> x.type==='member' && x.tripId===tripId);
  const itinerary = allData.filter(x=> x.type==='itinerary' && x.tripId===tripId).sort((a,b)=> (a.order||0)-(b.order||0));
  const expenses = allData.filter(x=> x.type==='expense' && x.tripId===tripId);
  const messages = allData.filter(x=> x.type==='message' && x.tripId===tripId).sort((a,b)=> new Date(a.ts)-new Date(b.ts));
  const polls = allData.filter(x=> x.type==='poll' && x.tripId===tripId);
  const tasks = allData.filter(x=> x.type==='task' && x.tripId===tripId);

  const balances = computeBalances(members, expenses);

  root.innerHTML = `
    <div class="container">
      <div class="header">
        <div>
          <div style="display:flex;gap:10px;align-items:center">
            <div class="hlogo">${trip.title}</div>
            <div class="badge small">${members.length} members</div>
          </div>
          <div class="small">Trip ID: ${trip.id}</div>
        </div>
        <div class="controls">
          <button class="btn secondary" id="btnBack">Back</button>
          <button class="btn" id="btnInvite">Invite</button>
        </div>
      </div>

      <div class="grid" style="margin-top:12px">
        <div>
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <h3 style="margin:0">Map & Itinerary</h3>
              <div class="small drag-hint">Drag items to reorder</div>
            </div>
            <div id="map" class="mapbox" style="margin-top:10px"></div>

            <div style="margin-top:12px">
              <h4>Itinerary</h4>
              <div id="itineraryList">
                ${itinerary.length===0? '<div class="small">No items. Click map to add a point or use Add Item.</div>' : itinerary.map(it=>`
                  <div draggable="true" class="list-item" data-itid="${it.itemId}">
                    <div>
                      <div style="font-weight:600">${it.title}</div>
                      <div class="small">${it.location||''} ${it.time? ' • ' + it.time : ''}</div>
                    </div>
                    <div style="display:flex;gap:8px">
                      <button class="small-btn" data-edit-it="${it.itemId}">Edit</button>
                      <button class="small-btn" data-del-it="${it.itemId}">Delete</button>
                    </div>
                  </div>
                `).join('')}
              </div>

              <div style="margin-top:8px" class="form-row">
                <input id="newItTitle" class="input" placeholder="Activity title"/>
                <input id="newItLoc" class="input small" placeholder="Location"/>
                <input id="newItTime" class="input small" placeholder="Time"/>
                <button class="btn" id="addItBtn">Add Item</button>
              </div>
            </div>
          </div>

          <div class="card" style="margin-top:12px">
            <h3>Chat</h3>
            <div id="chatBox" style="max-height:160px;overflow:auto;padding:8px;border:1px dashed #eef2ff;border-radius:6px">
              ${messages.length===0? '<div class="small">No messages</div>' : messages.map(m=>`<div style="margin-bottom:6px"><strong>${m.sender}:</strong> ${m.text} <div class="small">${new Date(m.ts).toLocaleTimeString()}</div></div>`).join('')}
            </div>
            <div style="margin-top:8px" class="form-row">
              <input id="chatSender" class="input small" placeholder="Your name"/>
              <input id="chatText" class="input" placeholder="Message"/>
              <button class="btn" id="sendMsg">Send</button>
            </div>
          </div>

          <div class="card" style="margin-top:12px">
            <h3>Polls</h3>
            <div id="pollList">${polls.length===0? '<div class="small">No polls yet</div>' : polls.map(p=> `
              <div class="list-item">
                <div><strong>${p.question}</strong><div class="small">${p.options.map(o=> o.opt + ' ('+o.votes.length+')').join(' • ')}</div></div>
                <div><button class="small-btn" data-vote="${p.id}">Vote</button></div>
              </div>
            `).join('')}</div>

            <div style="margin-top:8px" class="form-row">
              <input id="pollQ" class="input" placeholder="Question"/>
              <input id="pollOpts" class="input" placeholder="Options comma separated"/>
              <button class="btn" id="createPoll">Create</button>
            </div>
          </div>

        </div>

        <div>
          <div class="card">
            <h3>Members</h3>
            <div id="memberList">
              ${members.length===0? '<div class="small">No members. Invite to add.</div>' : members.map(m=>`
                <div class="list-item">
                  <div>${m.name}<div class="small">${m.email||''}</div></div>
                  <div><button class="small-btn" data-rem="${m.memberId}">Remove</button></div>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="card" style="margin-top:12px">
            <h3>Expenses</h3>
            <div class="form-row">
              <input id="expTitle" class="input" placeholder="Title"/>
              <input id="expAmount" class="input small" placeholder="Amount"/>
            </div>
            <div class="form-row" style="margin-top:8px">
              <input id="expPayer" class="input small" placeholder="Payer name"/>
              <input id="expParts" class="input" placeholder="Participants (comma names)"/>
            </div>
            <div class="form-row" style="margin-top:8px">
              <select id="expSplit" class="input small">
                <option value="equal">Equal</option>
                <option value="percent">Percent (comma numbers)</option>
                <option value="shares">Shares (comma numbers)</option>
              </select>
              <input id="expExtra" class="input" placeholder="Extra for percent/shares"/>
              <button class="btn" id="addExpenseBtn">Add Expense</button>
            </div>

            <div style="margin-top:12px" id="expenseList">
              ${expenses.length===0? '<div class="small">No expenses</div>' : expenses.map(ex=>`
                <div class="list-item">
                  <div>
                    <div style="font-weight:600">${ex.title} • ${ex.amount}</div>
                    <div class="small">Paid by ${ex.payer} • ${ex.participants.join(', ')}</div>
                  </div>
                  <div><button class="small-btn" data-expdel="${ex.id}">Del</button></div>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="card" style="margin-top:12px">
            <h3>Balances</h3>
            <div id="balances">
              ${Object.keys(balances).length===0? '<div class="small">No balances</div>' : Object.values(balances).map(b=>`
                <div style="display:flex;justify-content:space-between;margin-bottom:8px">
                  <div>${b.name}</div><div class="${b.balance>=0? 'balance-positive':'balance-negative'}">${b.balance>=0? '+'+b.balance.toFixed(2): b.balance.toFixed(2)}</div>
                </div>
              `).join('')}
            </div>
            <div class="footer-note">Positive = get money, Negative = owe money</div>
          </div>

          <div class="card" style="margin-top:12px">
            <h3>Tasks & RSVP</h3>
            <div id="taskList">
              ${tasks.length===0? '<div class="small">No tasks</div>' : tasks.map(t=>`
                <div class="list-item">
                  <div><input type="checkbox" ${t.completed? 'checked':''} data-taskchk="${t.id}"/> <span class="${t.completed? 'task-done':''}">${t.title}</span><div class="small">${t.assignedTo||''}</div></div>
                  <div><button class="small-btn" data-taskrem="${t.id}">Del</button></div>
                </div>
              `).join('')}
            </div>
            <div style="margin-top:8px" class="form-row">
              <input id="taskTitle" class="input" placeholder="Task title"/>
              <input id="taskAssign" class="input small" placeholder="Assign to (name)"/>
              <button class="btn" id="addTaskBtn">Add</button>
            </div>
          </div>

          <div class="card" style="margin-top:12px">
            <h3>Files (protected client-side)</h3>
            <input type="file" id="fileInput"/>
            <div id="filesList" style="margin-top:8px">
              ${allData.filter(f=> f.type==='file' && f.tripId===tripId).map(f=> `<div class="file-preview"><strong>${f.name}</strong> <div class="small">${f.mime}</div></div>`).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // attach handlers
  qs('#btnBack').addEventListener('click', ()=>{ view='dashboard'; currentTrip=null; render() });
  qs('#btnInvite').addEventListener('click', ()=> {
    const name = prompt('Member name (unique):'); if(!name) return;
    const mem = { type:'member', tripId, memberId: uid('mem'), name: name.trim(), email:'', role:'member' };
    allData.push(mem); saveData(allData); render();
  });

  // itinerary add via form
  qs('#addItBtn').addEventListener('click', ()=>{
    const title = qs('#newItTitle').value.trim(); if(!title) return alert('add title'); const loc = qs('#newItLoc').value.trim(); const time = qs('#newItTime').value.trim();
    const it = { type:'itinerary', tripId, itemId: uid('it'), title, location:loc, time, lat:null, lng:null, notes:'', order: itinerary.length+1 };
    allData.push(it); saveData(allData); qs('#newItTitle').value=''; render();
  });

  // edit/delete itinerary
  qsa('[data-del-it]').forEach(b=> b.addEventListener('click', e=>{ const id=e.currentTarget.getAttribute('data-del-it'); allData = allData.filter(x=> !(x.type==='itinerary' && x.itemId===id)); saveData(allData); render(); }));
  qsa('[data-edit-it]').forEach(b=> b.addEventListener('click', e=>{
    const id=e.currentTarget.getAttribute('data-edit-it'); const it = allData.find(x=> x.type==='itinerary' && x.itemId===id);
    if(!it) return;
    const newTitle = prompt('Title', it.title); if(newTitle!==null) it.title=newTitle;
    const newLoc = prompt('Location', it.location||''); if(newLoc!==null) it.location=newLoc;
    saveData(allData); render();
  }));

  // expense add
  qs('#addExpenseBtn').addEventListener('click', ()=>{
    const title = qs('#expTitle').value.trim(); const amount = parseFloat(qs('#expAmount').value||0); const payer = qs('#expPayer').value.trim(); const partsRaw = qs('#expParts').value.trim();
    const split = qs('#expSplit').value; const extra = qs('#expExtra').value.trim();
    if(!title||!amount||!payer||!partsRaw) return alert('fill fields');
    const parts = partsRaw.split(',').map(s=>s.trim()).filter(Boolean);
    const eobj = { type:'expense', tripId, id: uid('exp'), title, amount, currency:'USD', payer, participants: parts, splitType: split, extra: extra };
    allData.push(eobj); saveData(allData); qs('#expTitle').value=''; qs('#expAmount').value=''; qs('#expPayer').value=''; qs('#expParts').value=''; render();
  });

  qsa('[data-expdel]').forEach(b=> b.addEventListener('click', e=>{ const id=e.currentTarget.getAttribute('data-expdel'); allData = allData.filter(x=> !(x.type==='expense' && x.id===id)); saveData(allData); render(); }));

  // chat
  qs('#sendMsg').addEventListener('click', ()=>{
    const sender = qs('#chatSender').value.trim()||'Guest'; const text = qs('#chatText').value.trim(); if(!text) return;
    const m = { type:'message', tripId, id: uid('msg'), sender, text, ts: new Date().toISOString() };
    allData.push(m); saveData(allData); qs('#chatText').value=''; render();
  });

  // polls
  qs('#createPoll').addEventListener('click', ()=>{
    const q = qs('#pollQ').value.trim(); const opts = qs('#pollOpts').value.split(',').map(s=>s.trim()).filter(Boolean);
    if(!q||opts.length<2) return alert('question + >=2 options');
    const poll = { type:'poll', tripId, id: uid('poll'), question: q, options: opts.map(o=> ({ opt:o, votes:[] })) };
    allData.push(poll); saveData(allData); qs('#pollQ').value=''; qs('#pollOpts').value=''; render();
  });
  qsa('[data-vote]').forEach(b=> b.addEventListener('click', e=>{
    const pid = e.currentTarget.getAttribute('data-vote'); const poll = allData.find(x=> x.type==='poll' && x.id===pid);
    if(!poll) return; const voter = prompt('Your name'); if(!voter) return;
    const opt = prompt('Type option exactly: ' + poll.options.map(o=>o.opt).join(', ')); if(!opt) return;
    const o = poll.options.find(o=> o.opt === opt); if(!o) return alert('option not found'); o.votes.push(voter); saveData(allData); render();
  }));

  // tasks
  qs('#addTaskBtn').addEventListener('click', ()=>{
    const t = qs('#taskTitle').value.trim(); if(!t) return; const as = qs('#taskAssign').value.trim();
    const obj = { type:'task', tripId, id: uid('task'), title: t, assignedTo: as, due:null, completed:false };
    allData.push(obj); saveData(allData); qs('#taskTitle').value=''; render();
  });
  qsa('[data-taskrem]').forEach(b=> b.addEventListener('click', e=>{ const id=e.currentTarget.getAttribute('data-taskrem'); allData = allData.filter(x=> !(x.type==='task' && x.id===id)); saveData(allData); render(); }));
  qsa('[data-taskchk]').forEach(cb=> cb.addEventListener('change', e=>{ const id=e.currentTarget.getAttribute('data-taskchk'); const t = allData.find(x=> x.type==='task' && x.id===id); if(t) t.completed = e.currentTarget.checked; saveData(allData); render(); }));

  // member remove
  qsa('[data-rem]').forEach(b=> b.addEventListener('click', e=>{ const id=e.currentTarget.getAttribute('data-rem'); allData = allData.filter(x=> !(x.type==='member' && x.memberId===id)); saveData(allData); render(); }));

  qs('#fileInput')?.addEventListener('change', async (ev)=>{
    const f = ev.target.files[0]; if(!f) return;
    const base = await readFileAsBase64(f);
    const obj = { type:'file', tripId, id: uid('file'), name: f.name, mime: f.type, dataBase64: base, createdAt:new Date().toISOString() };
    allData.push(obj); saveData(allData); render();
  });

  // attach map (lazy)
  initMap('map', tripId);
  // drag/drop itinerary reorder
  attachDragHandlers();
}

// ---------- map ----------
function initMap(domId, tripId){
  if(mapInstances[tripId]) return;
  const el = qs('#'+domId); el.innerHTML=''; const map = L.map(el).setView([20.5937,78.9629],5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{ maxZoom:19 }).addTo(map);
  // existing itinerary markers
  allData.filter(x=> x.type==='itinerary' && x.tripId===tripId).forEach(it=>{
    if(it.lat && it.lng) L.marker([it.lat,it.lng]).addTo(map).bindPopup(it.title||it.location||'');
  });
  map.on('click', function(e){
    const lat=e.latlng.lat, lng=e.latlng.lng;
    const name = prompt('Place title (optional):','Point of interest'); if(name===null) return;
    const it = { type:'itinerary', tripId, itemId: uid('it'), title: name, location:'', time:'', lat, lng, notes:'', order: allData.filter(x=> x.type==='itinerary' && x.tripId===tripId).length+1 };
    allData.push(it); saveData(allData);
    L.marker([lat,lng]).addTo(map).bindPopup(it.title).openPopup();
    render();
  });
  mapInstances[tripId]=map;
}

// ---------- drag/drop itinerary ----------
function attachDragHandlers(){
  const list = qs('#itineraryList'); if(!list) return;
  let dragged=null;
  qsa('[draggable]').forEach(el=>{
    el.addEventListener('dragstart', e=>{ dragged = el; el.style.opacity='0.4'; });
    el.addEventListener('dragend', e=>{ dragged.style.opacity='1'; dragged=null; updateItOrder(); });
  });
  list.addEventListener('dragover', e=>{ e.preventDefault(); const after = getDragAfterElement(list, e.clientY); if(after==null) list.appendChild(dragged); else list.insertBefore(dragged, after); });
}
function getDragAfterElement(container, y){
  const draggableEls = [...container.querySelectorAll('[draggable]:not(.dragging)')];
  return draggableEls.reduce((closest, child)=>{
    const box = child.getBoundingClientRect(); const offset = y - box.top - box.height/2;
    if(offset<0 && offset>closest.offset){ return { offset: offset, element: child } } else return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}
function updateItOrder(){
  const list = qs('#itineraryList'); if(!list) return;
  const items = [...list.querySelectorAll('[data-itid]')];
  items.forEach((el, idx)=> {
    const id = el.getAttribute('data-itid');
    const it = allData.find(x=> x.type==='itinerary' && x.itemId===id);
    if(it) it.order = idx+1;
  });
  saveData(allData);
  render();
}

// ---------- balances / expense split ----------
function computeBalances(members, expenses){
  // map name -> {name, paid, owes}
  const balanceMap = {};
  members.forEach(m=> balanceMap[m.name] = { name:m.name, paid:0, owes:0 });
  // ensure expense participant/payer names are in map
  expenses.forEach(exp=>{
    if(!balanceMap[exp.payer]) balanceMap[exp.payer] = { name:exp.payer, paid:0, owes:0 };
    exp.participants.forEach(p=> { if(!balanceMap[p]) balanceMap[p] = { name:p, paid:0, owes:0 }; });
  });

  expenses.forEach(exp=>{
    const parts = exp.participants;
    if(exp.splitType === 'equal'){
      const per = parts.length ? exp.amount / parts.length : 0;
      if(balanceMap[exp.payer]) balanceMap[exp.payer].paid += exp.amount;
      parts.forEach(p => balanceMap[p].owes += per);
    } else if(exp.splitType === 'percent'){
      // exp.extra expected like "30,70" sums to 100
      const nums = exp.extra.split(',').map(s=> parseFloat(s.trim()) || 0);
      let sum = nums.reduce((a,b)=>a+b,0); if(sum<=0) sum=100;
      nums.forEach((n,i)=> { const name = parts[i]; const val = (n/sum) * exp.amount; if(balanceMap[name]) balanceMap[name].owes += val; });
      if(balanceMap[exp.payer]) balanceMap[exp.payer].paid += exp.amount;
    } else if(exp.splitType === 'shares'){
      const nums = exp.extra.split(',').map(s=> parseFloat(s.trim()) || 1);
      const sum = nums.reduce((a,b)=>a+b,0) || 1;
      nums.forEach((n,i)=> { const name = parts[i]; const val = (n/sum)*exp.amount; if(balanceMap[name]) balanceMap[name].owes += val; });
      if(balanceMap[exp.payer]) balanceMap[exp.payer].paid += exp.amount;
    }
  });

  const result = {};
  Object.keys(balanceMap).forEach(k => result[k] = { name: balanceMap[k].name, balance: (balanceMap[k].paid - balanceMap[k].owes) });
  return result;
}

// ---------- utilities ----------
function readFileAsBase64(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(); r.readAsDataURL(file); }) }

// ---------- boot ----------
function boot(){
  // ensure default data structure exists
  if(!Array.isArray(allData)) allData = [];
  // initial view
  view = allData.some(x=> x.type==='trip') ? 'dashboard' : 'landing';
  render();
}

// ---------- start ----------
boot();