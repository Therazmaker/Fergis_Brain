
// Netlify fix marker: externalized JS
window.__FB_JS_LOADED__ = true;
document.addEventListener("DOMContentLoaded", async () => {
  const sp = document.getElementById("statusPill");
  if (sp && sp.textContent && sp.textContent.trim() === "Sin conectar") {
    sp.textContent = "JS cargado ✅";
    sp.classList.remove("bad");
  }
});

// Netlify proxy (avoids browser CORS)
  const API_BASE = "https://script.google.com/macros/s/AKfycbxG1FFqdk4HmqMoy2TaKHsms_bJq17E1GFLzm8QNqJbmxNx8jpCo1k2zL_DoLGoIrYh/exec";

  // ---------- State ----------
  let CATALOG = { emotions: [], tags: [], people: [] };
  let LAST_ENTRIES = []; // last loaded list for export
  let chartIntensity = null;
  let chartEmotions = null;

  function getApiKey(){ return localStorage.getItem("fbrain_api_key") || ""; }
  function setApiKey(k){ localStorage.setItem("fbrain_api_key", k); }

  function getProfile(){ return localStorage.getItem("fbrain_profile") || "Fergis"; }
  function setProfile(p){ localStorage.setItem("fbrain_profile", p); }

  function shortKey(k){ return (!k) ? "—" : (k.length<=10 ? k : (k.slice(0,6)+"…"+k.slice(-4))); }

  function setStatus(ok, text){
    const pill = document.getElementById("statusPill");
    pill.textContent = text;
    pill.classList.toggle("ok", ok);
    pill.classList.toggle("bad", !ok);
  }

  function toast(title, desc=""){
    document.getElementById("toastTitle").textContent = title;
    document.getElementById("toastDesc").textContent = desc;
    const t = document.getElementById("toast");
    t.classList.remove("hidden");
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(()=>t.classList.add("hidden"), 2400);
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function go(view){
    document.querySelectorAll("main section").forEach(s=>s.classList.add("hidden"));
    document.getElementById("view-"+view).classList.remove("hidden");
    document.querySelectorAll(".nav button").forEach(b=>b.classList.remove("active"));
    document.querySelector(`.nav button[data-view="${view}"]`)?.classList.add("active");
  }

  // ---------- API ----------
  async function parseJsonSafe_(r){
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    const txt = await r.text();
    // If we got HTML (often a 404 page), show a clearer error.
    if(ct.includes("text/html") || txt.trim().startsWith("<!DOCTYPE") || txt.trim().startsWith("<html")){
      return { ok:false, error:"API devolvió HTML (no JSON). Revisa API_BASE / deploy.", status:r.status, html: txt.slice(0,200) };
    }
    try{ return JSON.parse(txt); }
    catch(e){ return { ok:false, error:"Respuesta no es JSON válido.", status:r.status, raw: txt.slice(0,200) }; }
  }

  async function apiGet(params){
    const url = API_BASE + "?" + new URLSearchParams({ ...params, api_key: getApiKey() });
    const r = await fetch(url, { method:"GET" });
    return parseJsonSafe_(r);
  }

  async function apiPost(data){
    data.api_key = getApiKey();
    const r = await fetch(API_BASE, {
      method:"POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(data)
    });
    return parseJsonSafe_(r);
  }

  // ---------- UI Helpers ----------
  function fillSelect(id, arr, opts={}){
    const sel = document.getElementById(id);
    sel.innerHTML = "";
    if(opts.includeAll){
      const o = document.createElement("option"); o.value=""; o.textContent="Todas"; sel.appendChild(o);
    }
    if(opts.includeAny){
      const o = document.createElement("option"); o.value=""; o.textContent="—"; sel.appendChild(o);
    }
    (arr||[]).forEach(i=>{
      const o = document.createElement("option");
      o.value = i.name; o.textContent = i.name;
      sel.appendChild(o);
    });
  }

  function renderCatalogList(boxId, arr){
    const box = document.getElementById(boxId);
    box.innerHTML = "";
    if(!arr || arr.length===0){
      box.innerHTML = `<div class="item"><div class="main small">No hay items aún.</div></div>`;
      return;
    }
    arr.forEach(i=>{
      const d = document.createElement("div");
      d.className = "item";
      d.innerHTML = `<div class="main"><b>${escapeHtml(i.name)}</b><div class="small">sort: ${escapeHtml(String(i.sort ?? ""))}</div></div>`;
      box.appendChild(d);
    });
  }

  function renderTagChips(){
    const box = document.getElementById("tagChips");
    box.innerHTML = "";
    (CATALOG.tags||[]).forEach(t=>{
      const c = document.createElement("div");
      c.className = "chip";
      c.textContent = t.name;
      c.addEventListener("click", ()=>{
        c.classList.toggle("on");
      });
      box.appendChild(c);
    });
  }

  function getSelectedChipTags(){
    return [...document.querySelectorAll("#tagChips .chip.on")].map(el=>el.textContent.trim()).filter(Boolean);
  }

  // ---------- Data ----------
  async function refreshCatalog(){
    const res = await apiGet({ route:"catalog" });
    if(!res.ok){
      setStatus(false, "Sin conectar");
      toast("Error", "No pude cargar catálogos. Revisa API key.");
      return false;
    }
    CATALOG = { emotions: res.emotions||[], tags: res.tags||[], people: res.people||[], meds: res.meds||[], symptoms: res.symptoms||[] };

    // New form
    fillSelect("emotionInput", CATALOG.emotions, { includeAny:true });
    fillSelect("personInput", CATALOG.people, { includeAny:true });
    renderTagChips();

    // Filters
    fillSelect("filterEmotion", CATALOG.emotions, { includeAll:true });
    fillSelect("filterPerson", CATALOG.people, { includeAll:true });
    fillSelect("filterTag", CATALOG.tags, { includeAll:true });

    // Modal edit selects
    fillSelect("editEmotion", CATALOG.emotions, { includeAny:true });
    fillSelect("editPerson", CATALOG.people, { includeAny:true });

    // Catalog view lists
    renderCatalogList("peopleList", CATALOG.people);
    renderCatalogList("emotionsList", CATALOG.emotions);
    renderCatalogList("tagsList", CATALOG.tags);

    // Catalog chips (extra)
    renderMedsCatalogInUI_(CATALOG);
    renderSymptomsCatalogInUI_(CATALOG);

    setStatus(true, "Conectado");
    return true;
  }

  function currentProfile(){
    return getProfile();
  }

  async function refreshHome(){
    const from = new Date(Date.now() - 30*24*60*60*1000).toISOString();
    const res = await apiGet({ route:"entries", from, limit: 250, profile: currentProfile() });
    if(!res.ok) return;

    const entries = res.entries || [];
    LAST_ENTRIES = entries;

    document.getElementById("kpiCount").textContent = entries.length;

    const avg = entries.length ? (entries.reduce((a,e)=>a+(Number(e.intensity)||0),0)/entries.length) : 0;
    document.getElementById("kpiAvg").textContent = entries.length ? avg.toFixed(1) : "—";

    const byEm = {};
    entries.forEach(e=>{
      const em = (e.emotion||"").trim() || "—";
      byEm[em] = (byEm[em]||0) + 1;
    });
    const top = Object.entries(byEm).sort((a,b)=>b[1]-a[1])[0];
    document.getElementById("kpiTopEmotion").textContent = top ? `${top[0]} (${top[1]})` : "—";

    const latestBox = document.getElementById("homeLatest");
    latestBox.innerHTML = "";
    const latest = entries.slice(0,5);
    if(latest.length===0){
      latestBox.innerHTML = `<div class="item"><div class="main small">Aún no hay registros. Crea el primero 👇</div></div>`;
      return;
    }
    latest.forEach(e=>{
      const d = document.createElement("div");
      d.className = "item";
      const when = new Date(e.ts).toLocaleString();
      const tags = (Array.isArray(e.tags) ? e.tags : String(e.tags||"").split(",")).map(s=>String(s).trim()).filter(Boolean);
      d.innerHTML = `
        <div class="main">
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
            <span class="badge">${escapeHtml(e.emotion||"—")}</span>
            <span class="badge">${escapeHtml(String(e.intensity||"—"))}/10</span>
            <span class="badge">${escapeHtml(e.person||"—")}</span>
            <span class="badge">${escapeHtml(e.profile||"")}</span>
            <span class="small">${escapeHtml(when)}</span>
          </div>
          <div style="margin-top:6px">${escapeHtml(e.text||"")}</div>
          ${tags.length ? `<div class="chips">${tags.map(t=>`<div class="chip on" style="cursor:default">${escapeHtml(t)}</div>`).join("")}</div>` : ""}
        </div>
        <div>
          <button class="iconbtn" title="Editar" data-eid="${escapeHtml(e.id||"")}" data-action="edit">✏️</button>
        </div>
      `;
      d.querySelector('[data-action="edit"]').addEventListener("click", ()=>openEditModal(e));
      latestBox.appendChild(d);
    });
  }

  function clearForm(){
    document.getElementById("intensityInput").value="";
    document.getElementById("tagsInput").value="";
    document.getElementById("textInput").value="";
    document.querySelectorAll("#tagChips .chip").forEach(c=>c.classList.remove("on"));
    toast("Listo", "Formulario limpio");
  }

  async function saveEntry(){
    const chipTags = getSelectedChipTags();
    const extraTags = document.getElementById("tagsInput").value.split(",").map(t=>t.trim()).filter(Boolean);
    const tags = [...new Set([...chipTags, ...extraTags])];

    const entry = {
      profile: currentProfile(),
      type: document.getElementById("typeInput").value,
      person: document.getElementById("personInput").value,
      emotion: document.getElementById("emotionInput").value,
      intensity: Number(document.getElementById("intensityInput").value || 0),
      tags,
      text: document.getElementById("textInput").value.trim(),
      important: false
    };

    if(!entry.text){ toast("Falta texto", "Escribe algo en Texto 🙂"); return; }
    if(!entry.emotion){ toast("Falta emoción", "Elige una emoción (o créala en Catálogos)."); return; }

    const res = await apiPost({ route:"addEntry", entry });
    if(res.ok){
      toast("Guardado", "Registro enviado ✅");
      clearForm();
      await refreshAllLight();
      go("home");
    } else {
      toast("Error", res.error || "No se pudo guardar.");
    }
  }

  function resetFilters(){
    document.getElementById("filterEmotion").value="";
    document.getElementById("filterPerson").value="";
    document.getElementById("filterTag").value="";
    document.getElementById("filterMinI").value="";
    document.getElementById("filterMaxI").value="";
    document.getElementById("filterLimit").value="100";
    toast("Filtros", "Reseteados");
  }

  async function loadEntries(){
    const params = { route:"entries", limit: Number(document.getElementById("filterLimit").value || 100), profile: currentProfile() };

    const em = document.getElementById("filterEmotion").value.trim();
    const pe = document.getElementById("filterPerson").value.trim();
    const tag = document.getElementById("filterTag").value.trim();
    const minI = document.getElementById("filterMinI").value.trim();
    const maxI = document.getElementById("filterMaxI").value.trim();

    if(em) params.emotion = em;
    if(pe) params.person = pe;
    if(tag) params.tag = tag;
    if(minI) params.min_intensity = minI;
    if(maxI) params.max_intensity = maxI;

    const res = await apiGet(params);
    if(!res.ok){ toast("Error", "No pude cargar registros."); return; }

    const entries = res.entries || [];
    LAST_ENTRIES = entries;

    const box = document.getElementById("entriesList");
    box.innerHTML = "";
    if(entries.length===0){
      box.innerHTML = `<div class="item"><div class="main small">Sin resultados con esos filtros.</div></div>`;
      return;
    }

    entries.forEach(e=>{
      const d = document.createElement("div");
      d.className="item";
      const when = new Date(e.ts).toLocaleString();
      const tags = (Array.isArray(e.tags) ? e.tags : String(e.tags||"").split(",")).map(s=>String(s).trim()).filter(Boolean);

      d.innerHTML = `
        <div class="main">
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
            <span class="badge">${escapeHtml(e.emotion||"—")}</span>
            <span class="badge">${escapeHtml(String(e.intensity||"—"))}/10</span>
            <span class="badge">${escapeHtml(e.person||"—")}</span>
            <span class="badge">${escapeHtml(e.profile||"")}</span>
            <span class="small">${escapeHtml(when)}</span>
          </div>
          <div style="margin-top:6px">${escapeHtml(e.text||"")}</div>
          ${tags.length ? `<div class="chips">${tags.map(t=>`<div class="chip on" style="cursor:default">${escapeHtml(t)}</div>`).join("")}</div>` : ""}
          <div class="small" style="margin-top:6px">ID: <span class="mono">${escapeHtml(e.id||"")}</span></div>
        </div>
        <div class="right-actions">
          <button class="iconbtn" title="Editar">✏️</button>
          <button class="iconbtn" title="Copiar">📋</button>
        </div>
      `;

      const [btnEdit, btnCopy] = d.querySelectorAll(".iconbtn");
      btnEdit.addEventListener("click", ()=>openEditModal(e));
      btnCopy.addEventListener("click", ()=>copyText(e.text||""));

      box.appendChild(d);
    });

    toast("Registros", `Cargados: ${entries.length}`);
  }

  // ---------- Catalog Add ----------
  async function addCatalog(kind){
    let nameEl, sortEl;
    if(kind==="people"){ nameEl="newPersonName"; sortEl="newPersonSort"; }
    if(kind==="emotions"){ nameEl="newEmotionName"; sortEl="newEmotionSort"; }
    if(kind==="tags"){ nameEl="newTagName"; sortEl="newTagSort"; }

    const name = document.getElementById(nameEl).value.trim();
    const sort = Number(document.getElementById(sortEl).value || 999);
    if(!name){ toast("Falta nombre", "Escribe un nombre primero."); return; }

    const res = await apiPost({ route:"addCatalogItem", kind, name, sort, active:true });
    if(res.ok){
      document.getElementById(nameEl).value="";
      toast("Catálogo", res.added ? "Agregado ✅" : "Ya existía 🙂");
      await refreshCatalog();
    } else {
      toast("Error", res.error || "No pude agregar.");
    }
  }

  // ---------- Settings ----------
  function refreshHeader(){
    const k = getApiKey();
    document.getElementById("apiShort").textContent = "API: " + shortKey(k);
    const p = getProfile();
    document.getElementById("profileName").textContent = p;
  }

  function saveApiKey(){
    const k = document.getElementById("apiKeyInput").value.trim();
    if(!k){ toast("Falta API key", "Pégala en Settings."); return; }
    setApiKey(k);
    refreshHeader();
    toast("API key", "Guardada 🔐");
    initData();
  }

  async function testPing(){
    const res = await apiGet({ route:"ping" });
    if(res.ok && res.pong){ setStatus(true, "Conectado"); toast("Ping", "pong ✅"); }
    else { setStatus(false, "Sin conectar"); toast("Ping falló", "Revisa API key."); }
  }

  function toggleProfile(){
    const next = (getProfile()==="Fergis") ? "Carlos" : "Fergis";
    setProfile(next);
    refreshHeader();
    toast("Perfil", `Ahora: ${next}`);
    refreshAllLight();
    go("home");
  }

  // ---------- Export ----------
  function downloadBlob(filename, mime, content){
    const blob = new Blob([content], {type:mime});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1500);
  }

  function entriesToCsv(entries){
    const cols = ["id","ts","profile","type","person","emotion","intensity","tags","text"];
    const rows = [cols.join(",")];
    (entries||[]).forEach(e=>{
      const tags = Array.isArray(e.tags) ? e.tags.join("|") : String(e.tags||"");
      const vals = [
        e.id, e.ts, e.profile, e.type, e.person, e.emotion,
        e.intensity, tags, e.text
      ].map(v=>{
        const s = String(v ?? "");
        const escaped = s.replace(/"/g,'""');
        return `"${escaped}"`;
      });
      rows.push(vals.join(","));
    });
    return rows.join("\n");
  }

  function exportCsv(){
    const csv = entriesToCsv(LAST_ENTRIES);
    const fn = `fergis_brain_${currentProfile().toLowerCase()}_${new Date().toISOString().slice(0,10)}.csv`;
    downloadBlob(fn, "text/csv;charset=utf-8", csv);
    toast("Export", "CSV descargado ✅");
  }

  // ---------- Modal Edit/Delete ----------
  function openModal(){
    document.getElementById("modalOverlay").classList.remove("hidden");
  }
  function closeModal(){
    document.getElementById("modalOverlay").classList.add("hidden");
  }

  function copyText(t){
    navigator.clipboard?.writeText(String(t||"")).then(()=>toast("Copiado", "Listo ✅"))
      .catch(()=>toast("Ups", "No pude copiar aquí."));
  }

  function openEditModal(entry){
    document.getElementById("editId").value = entry.id || "";
    document.getElementById("editType").value = entry.type || "Event";
    document.getElementById("editPerson").value = entry.person || "";
    document.getElementById("editEmotion").value = entry.emotion || "";
    document.getElementById("editIntensity").value = (entry.intensity ?? 0);
    const tags = Array.isArray(entry.tags) ? entry.tags.join(", ") : String(entry.tags||"");
    document.getElementById("editTags").value = tags;
    document.getElementById("editText").value = entry.text || "";

    const when = entry.ts ? new Date(entry.ts).toLocaleString() : "";
    document.getElementById("modalMeta").innerHTML =
      `ID: <span class="mono">${escapeHtml(entry.id||"")}</span> · ${escapeHtml(when)} · Perfil: <b>${escapeHtml(entry.profile||"")}</b>`;

    openModal();
  }

  async function saveEdit(){
    const id = document.getElementById("editId").value.trim();
    if(!id){ toast("Error", "Este registro no tiene ID."); return; }

    const payload = {
      id,
      profile: currentProfile(),
      type: document.getElementById("editType").value,
      person: document.getElementById("editPerson").value,
      emotion: document.getElementById("editEmotion").value,
      intensity: Number(document.getElementById("editIntensity").value || 0),
      tags: document.getElementById("editTags").value.split(",").map(t=>t.trim()).filter(Boolean),
      text: document.getElementById("editText").value.trim()
    };

    const res = await apiPost({ route:"updateEntry", entry: payload });
    if(res.ok){
      toast("Actualizado", "Cambios guardados ✅");
      closeModal();
      await refreshAllLight();
      // keep user in same view
    } else {
      toast("Error", res.error || "No pude actualizar.");
    }
  }

  async function deleteEntry(){
    const id = document.getElementById("editId").value.trim();
    if(!id){ toast("Error", "Este registro no tiene ID."); return; }

    const sure = confirm("¿Seguro que quieres borrar este registro? (Se marcará como deleted)");
    if(!sure) return;

    const res = await apiPost({ route:"deleteEntry", id });
    if(res.ok){
      toast("Borrado", "Registro eliminado ✅");
      closeModal();
      await refreshAllLight();
    } else {
      toast("Error", res.error || "No pude borrar.");
    }
  }

  // ---------- Insights ----------
  function destroyChart(ch){
    try{ ch && ch.destroy(); }catch(e){}
  }

  
  async function refreshInsights(){
    // Use 30 days for charts, but calendar uses current month range
    const from = new Date(Date.now() - 30*24*60*60*1000).toISOString();
    const res = await apiGet({ route:"entries", from, limit: 500, profile: currentProfile() });
    if(!res.ok){ toast("Error", "No pude cargar insights."); return; }

    const entries = res.entries || [];

    // Intensity by day (avg per day)
    const byDay = {};
    entries.forEach(e=>{
      const d = new Date(e.ts);
      if(isNaN(d)) return;
      const key = d.toISOString().slice(0,10);
      byDay[key] = byDay[key] || {sum:0, n:0};
      byDay[key].sum += Number(e.intensity)||0;
      byDay[key].n += 1;
    });
    const days = Object.keys(byDay).sort();
    const dayVals = days.map(k => (byDay[k].sum / byDay[k].n));

    // Top emotions
    const byEm = {};
    entries.forEach(e=>{
      const em = (e.emotion||"—").trim() || "—";
      byEm[em] = (byEm[em]||0)+1;
    });
    const emPairs = Object.entries(byEm).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const emLabels = emPairs.map(p=>p[0]);
    const emCounts = emPairs.map(p=>p[1]);

    // Render charts (fixed-height containers prevent runaway growth)
    destroyChart(chartIntensity);
    destroyChart(chartEmotions);

    chartIntensity = new Chart(document.getElementById("chartIntensity"), {
      type: "line",
      data: { labels: days, datasets: [{ label: "Intensidad promedio", data: dayVals, tension: 0.25 }] },
      options: {
        responsive:true,
        maintainAspectRatio:false,
        animation:false,
        scales:{
          y:{ suggestedMin:0, suggestedMax:10, ticks:{ stepSize:1 } },
          x:{ ticks:{ maxRotation:0, autoSkip:true, maxTicksLimit:8 } }
        },
        plugins:{ legend:{ display:true }, tooltip:{ enabled:true } }
      }
    });

    chartEmotions = new Chart(document.getElementById("chartEmotions"), {
      type: "bar",
      data: { labels: emLabels, datasets: [{ label: "Frecuencia", data: emCounts }] },
      options: {
        responsive:true,
        maintainAspectRatio:false,
        animation:false,
        scales:{
          y:{ beginAtZero:true, ticks:{ precision:0 } },
          x:{ ticks:{ autoSkip:false, maxRotation:0 } }
        },
        plugins:{ legend:{ display:true } }
      }
    });

    // Calendar uses a month view but the counts/avg need data for that month.
    // We'll fetch a wider range (current month +/- buffer) to be safe.
    await renderCalendarForCurrentMonth_();

    toast("Insights", "Actualizados ✅");
  }

  // ----- Calendar -----
  let CAL_MONTH = null; // Date at first day of month

  function startOfMonth(d){
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  function endOfMonth(d){
    return new Date(d.getFullYear(), d.getMonth()+1, 0, 23,59,59,999);
  }
  function isoDate(d){
    return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10);
  }
  function monthTitle(d){
    const m = d.toLocaleString("es-ES", { month:"long" });
    return `${m[0].toUpperCase()+m.slice(1)} ${d.getFullYear()}`;
  }

  async function renderCalendarForCurrentMonth_(){
    if(!CAL_MONTH) CAL_MONTH = startOfMonth(new Date());

    const mStart = startOfMonth(CAL_MONTH);
    const mEnd = endOfMonth(CAL_MONTH);

    // Buffer: include first week spillover and last week spillover
    const gridStart = new Date(mStart);
    // Monday-based start
    const dow = (gridStart.getDay()+6)%7; // 0=Mon
    gridStart.setDate(gridStart.getDate() - dow);
    const gridEnd = new Date(mEnd);
    const dow2 = (gridEnd.getDay()+6)%7;
    gridEnd.setDate(gridEnd.getDate() + (6 - dow2));

    const res = await apiGet({
      route:"entries",
      from: new Date(gridStart.getTime() - 24*60*60*1000).toISOString(),
      to: new Date(gridEnd.getTime() + 24*60*60*1000).toISOString(),
      limit: 500,
      profile: currentProfile()
    });
    if(!res.ok) return;

    const entries = res.entries || [];
    const byDay = {};
    entries.forEach(e=>{
      const d = new Date(e.ts);
      if(isNaN(d)) return;
      const key = d.toISOString().slice(0,10);
      byDay[key] = byDay[key] || { n:0, sum:0 };
      byDay[key].n += 1;
      byDay[key].sum += Number(e.intensity)||0;
    });

    document.getElementById("calTitle").textContent = monthTitle(CAL_MONTH);

    const grid = document.getElementById("calGrid");
    grid.innerHTML = "";

    const day = new Date(gridStart);
    while(day <= gridEnd){
      const key = day.toISOString().slice(0,10);
      const inMonth = day.getMonth() === CAL_MONTH.getMonth();
      const info = byDay[key] || { n:0, sum:0 };
      const avg = info.n ? (info.sum/info.n) : null;

      const cell = document.createElement("div");
      cell.className = "calDay" + (inMonth ? "" : " muted");

      // A tiny visual hint by density (no flashy colors)
      const density = Math.min(1, info.n/6);
      cell.style.boxShadow = `inset 0 0 0 9999px rgba(37, 99, 235, ${0.06 + density*0.12})`;

      cell.innerHTML = `
        <div class="calNum">${day.getDate()}</div>
        <div class="calMeta">${info.n} registro${info.n===1?"":"s"}</div>
        ${avg!==null ? `<div class="calPill">Avg: ${avg.toFixed(1)}/10</div>` : `<div class="calPill">Avg: —</div>`}
      `;
      grid.appendChild(cell);
      day.setDate(day.getDate()+1);
    }
  }


    // ----- Meds (Check-in) -----
  let MED_MONTH = null; // Date at first day of month

  function firstOfMonth_(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
  function ym_(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
  function monthHuman_(d){
    const m = d.toLocaleString("es-ES", { month:"long" });
    return `${m[0].toUpperCase()+m.slice(1)} ${d.getFullYear()}`;
  }

  async function loadMedsCatalog_(){
    const cat = await apiGet({ route:"catalog" });
    if(!cat.ok) return [];
    return (cat.meds || []).map(x=>x.name).filter(Boolean);
  }

  function renderMedsCatalogInUI_(cat){
    const list = document.getElementById("medsList");
    if(!list) return;
    list.innerHTML = "";
    const meds = (cat.meds || []).map(x=>x.name).filter(Boolean);
    if(!meds.length){
      list.innerHTML = `<div class="small">Sin medicinas aún.</div>`;
      return;
    }
    meds.forEach(n=>{
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.textContent = n;
      list.appendChild(chip);
    });
  }


  function renderSymptomsCatalogInUI_(cat){
    const list = document.getElementById("symptomsList");
    if(!list) return;
    list.innerHTML = "";
    const items = (cat.symptoms || []).map(x=>x.name||x).filter(Boolean);
    if(!items.length){
      list.innerHTML = `<div class="small">Sin síntomas aún.</div>`;
      return;
    }
    items.forEach(n=>{
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.textContent = n;
      list.appendChild(chip);
    });
  }

  async function addSymptomFromUI_(){
    const name = document.getElementById("newSymptomName").value.trim();
    const sortVal = document.getElementById("newSymptomSort").value;
    const sort = sortVal === "" ? 999 : Number(sortVal);
    if(!name){ toast("Catálogo", "Pon un nombre."); return; }
    const res = await apiPost({ route:"addCatalogItem", kind:"symptoms", name, sort, active:true });
    if(!res.ok){ toast("Error", "No se pudo agregar."); return; }
    document.getElementById("newSymptomName").value = "";
    document.getElementById("newSymptomSort").value = "";
    toast("Catálogo", res.added ? "Agregado ✅" : "Ya existía ✅");
    await refreshCatalog();
  }

  async function addMedFromUI_(){
    const name = document.getElementById("newMedName").value.trim();
    const sortVal = document.getElementById("newMedSort").value;
    const sort = sortVal === "" ? 999 : Number(sortVal);
    if(!name){ toast("Catálogo", "Pon un nombre."); return; }
    const res = await apiPost({ route:"addCatalogItem", kind:"meds", name, sort });
    if(!res.ok){ toast("Error", "No se pudo agregar."); return; }
    document.getElementById("newMedName").value = "";
    document.getElementById("newMedSort").value = "";
    toast("Catálogo", res.added ? "Agregada ✅" : "Ya existía ✅");
    await refreshCatalog();
  }

  async function refreshMeds(){
    if(!MED_MONTH) MED_MONTH = firstOfMonth_(new Date());

    const meds = await loadMedsCatalog_();
    const sel = document.getElementById("medName");
    sel.innerHTML = "";
    if(meds.length){
      meds.forEach(n=>{
        const o = document.createElement("option");
        o.value = n; o.textContent = n;
        sel.appendChild(o);
      });
    } else {
      const o = document.createElement("option");
      o.value = ""; o.textContent = "(Agrega medicinas en Catálogos)";
      sel.appendChild(o);
    }

    await refreshMedsStats_();

    const from = new Date(Date.now() - 60*24*60*60*1000).toISOString();
    const r = await apiGet({ route:"meds", from, limit: 50, profile: getProfile() });
    const list = document.getElementById("medLogList");
    list.innerHTML = "";
    if(!r.ok){ list.innerHTML = `<div class="small">No pude cargar.</div>`; return; }
    const items = r.items || [];
    if(!items.length){ list.innerHTML = `<div class="small">Sin check-ins aún.</div>`; return; }

    items.forEach(it=>{
      const d = new Date(it.ts);
      const when = isNaN(d) ? String(it.ts||"") : d.toLocaleString();
      const dose = (it.dose!=="" && it.dose!==null && it.dose!==undefined) ? `${it.dose} ${it.unit||""}`.trim() : (it.unit||"");
      const div = document.createElement("div");
      div.className = "listItem";
      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
          <div>
            <div style="font-weight:900">${escapeHtml(it.med_name||"—")} ${dose?`<span class="pill">${escapeHtml(dose)}</span>`:""}</div>
            <div class="small">${escapeHtml(it.reason||"")}${it.notes?` • ${escapeHtml(it.notes)}`:""}</div>
          </div>
          <div class="small" style="white-space:nowrap">${escapeHtml(when)}</div>
        </div>
      `;
      list.appendChild(div);
    });
  }

  async function refreshMedsStats_(){
    if(!MED_MONTH) MED_MONTH = firstOfMonth_(new Date());
    document.getElementById("medMonthLabel").textContent = monthHuman_(MED_MONTH);

    const month = ym_(MED_MONTH);
    const res = await apiGet({ route:"medsStats", month, profile: getProfile() });

    const grid = document.getElementById("medStatsGrid");
    grid.innerHTML = "";
    if(!res.ok){ grid.innerHTML = `<div class="small">No pude cargar stats.</div>`; return; }

    const totals = res.totals || {};
    const pairs = Object.entries(totals).sort((a,b)=>(b[1].count||0)-(a[1].count||0));

    if(!pairs.length){
      grid.innerHTML = `<div class="small">Sin registros este mes.</div>`;
    } else {
      pairs.forEach(([name, t])=>{
        const chip = document.createElement("div");
        chip.className = "chip";
        chip.textContent = `${name}: ${t.count}`;
        grid.appendChild(chip);
      });
    }

    destroyChart(chartMeds);
    const labels = pairs.map(p=>p[0]);
    const counts = pairs.map(p=>p[1].count||0);

    chartMeds = new Chart(document.getElementById("chartMeds"), {
      type:"bar",
      data:{ labels, datasets:[{ label:"Veces este mes", data: counts }] },
      options:{ responsive:true, maintainAspectRatio:false, animation:false, scales:{ y:{ beginAtZero:true, ticks:{ precision:0 } } }, plugins:{ legend:{ display:true } } }
    });
  }

  async function saveMedLog_(){
    const med_name = document.getElementById("medName").value || "";
    if(!med_name){ toast("Check-in", "Selecciona una medicina."); return; }

    const doseRaw = document.getElementById("medDose").value;
    const unit = document.getElementById("medUnit").value;
    const reason = document.getElementById("medReason").value.trim();
    const notes = document.getElementById("medNotes").value.trim();

    const payload = {
      profile: getProfile(),
      med_name,
      dose: doseRaw === "" ? "" : Number(doseRaw),
      unit,
      reason,
      notes
    };

    const res = await apiPost({ route:"addMedLog", item: payload });
    if(!res.ok){ toast("Error", "No se pudo guardar."); return; }
    toast("Check-in", "Guardado ✅");
    clearMedForm_();
    await refreshMeds();
  }

  function clearMedForm_(){
    document.getElementById("medDose").value = "";
    document.getElementById("medReason").value = "";
    document.getElementById("medNotes").value = "";
  }



  // ----- Cycle (Check-in) -----
  let CYCLE_MONTH = null; // month for stats
  let CYCLE_CAL_MONTH = null; // month for calendar
  let CYCLE_SELECTED_SYMPTOMS = new Set();

  function renderCycleSymptomsChips_(){
    const box = document.getElementById("cycleSymptomsChips");
    if(!box) return;
    box.innerHTML = "";

    const items = (CATALOG.symptoms || []).map(x=>x.name||x).filter(Boolean);
    if(!items.length){
      box.innerHTML = `<div class="small">Sin catálogo de síntomas aún.</div>`;
      return;
    }

    items.forEach(name=>{
      const chip = document.createElement("div");
      chip.className = "chip" + (CYCLE_SELECTED_SYMPTOMS.has(name) ? " on" : "");
      chip.textContent = name;
      chip.addEventListener("click", ()=>{
        if(CYCLE_SELECTED_SYMPTOMS.has(name)) CYCLE_SELECTED_SYMPTOMS.delete(name);
        else CYCLE_SELECTED_SYMPTOMS.add(name);
        renderCycleSymptomsChips_();
      });
      box.appendChild(chip);
    });
  }

  function clearCycleForm_(){
    document.getElementById("cycleKind").value = "day";
    document.getElementById("cycleFlow").value = "";
    document.getElementById("cyclePain").value = "";
    document.getElementById("cycleMood").value = "";
    document.getElementById("cycleNotes").value = "";
    CYCLE_SELECTED_SYMPTOMS = new Set();
    renderCycleSymptomsChips_();
  }

  function ymFrom_(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }

  async function refreshCycle(){
    if(!CYCLE_MONTH) CYCLE_MONTH = firstOfMonth_(new Date());
    if(!CYCLE_CAL_MONTH) CYCLE_CAL_MONTH = startOfMonth(new Date());

    document.getElementById("cycleMonthLabel").textContent = monthHuman_(CYCLE_MONTH);
    document.getElementById("cycleCalTitle").textContent = monthTitle(CYCLE_CAL_MONTH);

    renderCycleSymptomsChips_();
    await refreshCycleStats_();
    await renderCycleCalendar_();

    const from = new Date(Date.now() - 60*24*60*60*1000).toISOString();
    const r = await apiGet({ route:"cycle", from, limit: 80, profile: getProfile() });
    const list = document.getElementById("cycleLogList");
    list.innerHTML = "";
    if(!r.ok){ list.innerHTML = `<div class="small">No pude cargar.</div>`; return; }

    const items = r.items || [];
    if(!items.length){ list.innerHTML = `<div class="small">Sin registros aún.</div>`; return; }

    items.forEach(it=>{
      const d = new Date(it.ts);
      const when = isNaN(d) ? String(it.ts||"") : d.toLocaleString();
      const kind = String(it.kind||"day");
      const flow = it.flow!=="" && it.flow!==null && it.flow!==undefined ? Number(it.flow) : null;
      const pain = it.pain!=="" && it.pain!==null && it.pain!==undefined ? Number(it.pain) : null;
      const mood = it.mood!=="" && it.mood!==null && it.mood!==undefined ? Number(it.mood) : null;
      const symptoms = Array.isArray(it.symptoms) ? it.symptoms : String(it.symptoms||"").split(",").map(s=>s.trim()).filter(Boolean);

      const div = document.createElement("div");
      div.className = "listItem";
      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
          <div>
            <div style="font-weight:900">🩸 ${escapeHtml(kind)} ${flow!==null?`<span class="pill">Flujo: ${flow}</span>`:""} ${pain!==null?`<span class="pill">Dolor: ${pain}</span>`:""} ${mood!==null?`<span class="pill">Ánimo: ${mood}</span>`:""}</div>
            <div class="small">${symptoms.length?`Síntomas: ${escapeHtml(symptoms.join(", "))}`:""}${it.notes?` • ${escapeHtml(it.notes)}`:""}</div>
          </div>
          <div class="small" style="white-space:nowrap">${escapeHtml(when)}</div>
        </div>
      `;
      list.appendChild(div);
    });
  }

  async function refreshCycleStats_(){
    if(!CYCLE_MONTH) CYCLE_MONTH = firstOfMonth_(new Date());
    const month = ymFrom_(CYCLE_MONTH);

    const res = await apiGet({ route:"cycleStats", month, profile: getProfile() });
    if(!res.ok){
      document.getElementById("cycleKpiDays").textContent = "—";
      document.getElementById("cycleKpiAvgPain").textContent = "—";
      document.getElementById("cycleKpiAvgMood").textContent = "—";
      return;
    }

    document.getElementById("cycleKpiDays").textContent = String(res.days_with_logs ?? "—");
    document.getElementById("cycleKpiAvgPain").textContent = (res.avg_pain===null || res.avg_pain===undefined) ? "—" : Number(res.avg_pain).toFixed(1);
    document.getElementById("cycleKpiAvgMood").textContent = (res.avg_mood===null || res.avg_mood===undefined) ? "—" : Number(res.avg_mood).toFixed(1);
  }

  async function renderCycleCalendar_(){
    if(!CYCLE_CAL_MONTH) CYCLE_CAL_MONTH = startOfMonth(new Date());
    document.getElementById("cycleCalTitle").textContent = monthTitle(CYCLE_CAL_MONTH);

    const mStart = startOfMonth(CYCLE_CAL_MONTH);
    const mEnd = new Date(mStart.getFullYear(), mStart.getMonth()+1, 1);

    // Monday-based grid
    const gridStart = new Date(mStart);
    const dow = (gridStart.getDay()+6)%7;
    gridStart.setDate(gridStart.getDate() - dow);

    const gridEnd = new Date(mEnd);
    const dow2 = (gridEnd.getDay()+6)%7;
    gridEnd.setDate(gridEnd.getDate() + (6 - dow2));

    const res = await apiGet({
      route:"cycle",
      from: new Date(gridStart.getTime() - 24*60*60*1000).toISOString(),
      to: new Date(gridEnd.getTime() + 24*60*60*1000).toISOString(),
      limit: 600,
      profile: getProfile()
    });
    if(!res.ok) return;

    const items = res.items || [];
    const byDay = {};
    items.forEach(it=>{
      const d = new Date(it.ts);
      if(isNaN(d)) return;
      const key = d.toISOString().slice(0,10);
      byDay[key] = byDay[key] || { kinds:new Set(), maxFlow:null, sumPain:0, nPain:0 };
      byDay[key].kinds.add(String(it.kind||"day"));
      const flow = it.flow!=="" && it.flow!==null && it.flow!==undefined ? Number(it.flow) : null;
      if(flow!==null) byDay[key].maxFlow = (byDay[key].maxFlow===null) ? flow : Math.max(byDay[key].maxFlow, flow);
      const pain = it.pain!=="" && it.pain!==null && it.pain!==undefined ? Number(it.pain) : null;
      if(pain!==null && !isNaN(pain)){ byDay[key].sumPain += pain; byDay[key].nPain += 1; }
    });

    const grid = document.getElementById("cycleCalGrid");
    grid.innerHTML = "";

    const day = new Date(gridStart);
    while(day <= gridEnd){
      const key = day.toISOString().slice(0,10);
      const inMonth = day.getMonth() === CYCLE_CAL_MONTH.getMonth();
      const info = byDay[key];
      const avgPain = info && info.nPain ? (info.sumPain/info.nPain) : null;

      const cell = document.createElement("div");
      cell.className = "calDay" + (inMonth ? "" : " muted");

      const has = !!info;
      const tint = has ? 0.14 : 0.05;
      cell.style.boxShadow = `inset 0 0 0 9999px rgba(220, 38, 38, ${tint})`;

      const kindLabel = has ? [...info.kinds].join(",") : "—";
      const flowLabel = has && info.maxFlow!==null ? `F${info.maxFlow}` : "F—";
      const painLabel = avgPain!==null ? `P${avgPain.toFixed(0)}` : "P—";

      cell.innerHTML = `
        <div class="calNum">${day.getDate()}</div>
        <div class="calMeta">${has ? "Con registro" : "—"}</div>
        <div class="calPill">${escapeHtml(kindLabel)}</div>
        <div class="calPill">${flowLabel} · ${painLabel}</div>
      `;
      grid.appendChild(cell);
      day.setDate(day.getDate()+1);
    }
  }

  async function saveCycleLog_(kindOverride=null){
    const kind = kindOverride || document.getElementById("cycleKind").value;
    const flowRaw = document.getElementById("cycleFlow").value;
    const painRaw = document.getElementById("cyclePain").value;
    const moodRaw = document.getElementById("cycleMood").value;
    const notes = document.getElementById("cycleNotes").value.trim();

    const payload = {
      profile: getProfile(),
      kind,
      flow: flowRaw==="" ? "" : Number(flowRaw),
      pain: painRaw==="" ? "" : Number(painRaw),
      mood: moodRaw==="" ? "" : Number(moodRaw),
      symptoms: [...CYCLE_SELECTED_SYMPTOMS],
      notes
    };

    const res = await apiPost({ route:"addCycle", item: payload });
    if(!res.ok){ toast("Error", "No se pudo guardar."); return; }
    toast("Ciclo", "Guardado ✅");
    await refreshCycle();
  }

  // ---------- Init ----------
  async function refreshAllLight(){
    await refreshCatalog();
    await refreshHome();
  }

  async function refreshAll(){
    const ok = await refreshCatalog();
    if(ok){
      await refreshHome();
      await refreshInsights();
      toast("Refrescado", "Todo actualizado ✅");
    }
  }

  async function initData(){
    refreshHeader();
    document.getElementById("apiKeyInput").value = getApiKey();

    if(!getApiKey()){
      setStatus(false, "Sin API key");
      go("settings");
      return;
    }

    const ok = await refreshCatalog();
    if(ok){
      setStatus(true, "Conectado");
      await refreshHome();
      // insights only when user goes there
    }
    go("home");
  }

  function bindUI(){
    // routing
    document.querySelectorAll(".nav button[data-view]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const v = btn.getAttribute("data-view");
        go(v);
        if(v==="insights") refreshInsights();
        if(v==="meds") refreshMeds();
        if(v==="cycle") refreshCycle();
      });
    });

    // header
    document.getElementById("btnToggleProfile").addEventListener("click", toggleProfile);

    // home
    document.getElementById("btnHomeNew").addEventListener("click", ()=>go("new"));
    document.getElementById("btnHomeRefresh").addEventListener("click", refreshAll);
    document.getElementById("btnHomeAll").addEventListener("click", ()=>{ go("records"); loadEntries(); });
    document.getElementById("btnExportCsv").addEventListener("click", exportCsv);

    // new
    document.getElementById("btnSaveEntry").addEventListener("click", saveEntry);
    document.getElementById("btnClearForm").addEventListener("click", clearForm);

    // records
    document.getElementById("btnSearch").addEventListener("click", loadEntries);
    document.getElementById("btnResetFilters").addEventListener("click", resetFilters);
    document.getElementById("btnExportCsv2").addEventListener("click", exportCsv);

    // catalogs
    document.getElementById("btnAddPerson").addEventListener("click", ()=>addCatalog("people"));
    document.getElementById("btnAddEmotion").addEventListener("click", ()=>addCatalog("emotions"));
    document.getElementById("btnAddTag").addEventListener("click", ()=>addCatalog("tags"));

    // settings
    document.getElementById("btnSaveKey").addEventListener("click", saveApiKey);
    document.getElementById("btnPing").addEventListener("click", testPing);

    // insights
    document.getElementById("btnInsightsRefresh").addEventListener("click", refreshInsights);
    document.getElementById("calPrev").addEventListener("click", async ()=>{
      CAL_MONTH = startOfMonth(new Date(CAL_MONTH.getFullYear(), CAL_MONTH.getMonth()-1, 1));
      await renderCalendarForCurrentMonth_();
    });
    document.getElementById("calNext").addEventListener("click", async ()=>{
      CAL_MONTH = startOfMonth(new Date(CAL_MONTH.getFullYear(), CAL_MONTH.getMonth()+1, 1));
      await renderCalendarForCurrentMonth_();
    });
    document.getElementById("calToday").addEventListener("click", async ()=>{
      CAL_MONTH = startOfMonth(new Date());
      await renderCalendarForCurrentMonth_();
    });

    // modal
    document.getElementById("btnCloseModal").addEventListener("click", closeModal);
    document.getElementById("modalOverlay").addEventListener("click", (e)=>{
      if(e.target.id==="modalOverlay") closeModal();
    });
    document.getElementById("btnSaveEdit").addEventListener("click", saveEdit);
    document.getElementById("btnDeleteEntry").addEventListener("click", deleteEntry);
    document.getElementById("btnCopyText").addEventListener("click", ()=>copyText(document.getElementById("editText").value));
  
    // meds (check-in)
    document.getElementById("btnMedSave").addEventListener("click", saveMedLog_);
    document.getElementById("btnMedClear").addEventListener("click", clearMedForm_);
    document.getElementById("btnMedRefresh").addEventListener("click", refreshMeds);
    document.getElementById("medMonthPrev").addEventListener("click", async ()=>{
      if(!MED_MONTH) MED_MONTH = firstOfMonth_(new Date());
      MED_MONTH = firstOfMonth_(new Date(MED_MONTH.getFullYear(), MED_MONTH.getMonth()-1, 1));
      await refreshMedsStats_();
    });
    document.getElementById("medMonthNext").addEventListener("click", async ()=>{
      if(!MED_MONTH) MED_MONTH = firstOfMonth_(new Date());
      MED_MONTH = firstOfMonth_(new Date(MED_MONTH.getFullYear(), MED_MONTH.getMonth()+1, 1));
      await refreshMedsStats_();
    });


    // catalogs symptoms
    const btnAddSymptom = document.getElementById("btnAddSymptom");
    if(btnAddSymptom) btnAddSymptom.addEventListener("click", addSymptomFromUI_);

    // cycle
    document.getElementById("btnCycleSave").addEventListener("click", ()=>saveCycleLog_());
    document.getElementById("btnCycleQuickStart").addEventListener("click", ()=>saveCycleLog_("start"));
    document.getElementById("btnCycleQuickEnd").addEventListener("click", ()=>saveCycleLog_("end"));
    document.getElementById("btnCycleClear").addEventListener("click", clearCycleForm_);
    document.getElementById("btnCycleRefresh").addEventListener("click", refreshCycle);

    document.getElementById("cycleMonthPrev").addEventListener("click", async ()=>{
      if(!CYCLE_MONTH) CYCLE_MONTH = firstOfMonth_(new Date());
      CYCLE_MONTH = firstOfMonth_(new Date(CYCLE_MONTH.getFullYear(), CYCLE_MONTH.getMonth()-1, 1));
      document.getElementById("cycleMonthLabel").textContent = monthHuman_(CYCLE_MONTH);
      await refreshCycleStats_();
    });
    document.getElementById("cycleMonthNext").addEventListener("click", async ()=>{
      if(!CYCLE_MONTH) CYCLE_MONTH = firstOfMonth_(new Date());
      CYCLE_MONTH = firstOfMonth_(new Date(CYCLE_MONTH.getFullYear(), CYCLE_MONTH.getMonth()+1, 1));
      document.getElementById("cycleMonthLabel").textContent = monthHuman_(CYCLE_MONTH);
      await refreshCycleStats_();
    });

    document.getElementById("cycleCalPrev").addEventListener("click", async ()=>{
      CYCLE_CAL_MONTH = startOfMonth(new Date(CYCLE_CAL_MONTH.getFullYear(), CYCLE_CAL_MONTH.getMonth()-1, 1));
      await renderCycleCalendar_();
    });
    document.getElementById("cycleCalNext").addEventListener("click", async ()=>{
      CYCLE_CAL_MONTH = startOfMonth(new Date(CYCLE_CAL_MONTH.getFullYear(), CYCLE_CAL_MONTH.getMonth()+1, 1));
      await renderCycleCalendar_();
    });
    document.getElementById("cycleCalToday").addEventListener("click", async ()=>{
      CYCLE_CAL_MONTH = startOfMonth(new Date());
      await renderCycleCalendar_();
    });

    // catalogs meds
    const btnAddMed = document.getElementById("btnAddMed");
    if(btnAddMed) btnAddMed.addEventListener("click", addMedFromUI_);

}

  document.addEventListener("DOMContentLoaded", async ()=>{
    bindUI();
    try{ await initData(); }catch(e){ console.error(e); setStatus(false,"Sin conectar"); }
  });
