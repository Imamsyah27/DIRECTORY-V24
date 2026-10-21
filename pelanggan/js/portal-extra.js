/**
 * Portal pelanggan — tambahan: tab, pengumuman, Supply & Stock (lihat + pesan),
 * arsip pribadi, dan grafik. Butuh sql/supply.sql di Supabase.
 */
let myArchives = [], mySupply = [], mySupplyOrders = [], _cuCharts = {};
const LOCALE = { id: "id-ID", en: "en-GB", vi: "vi-VN", ar: "ar" };
const loc = () => LOCALE[currentLang] || "id-ID";
const fmtDate = (iso, opt) => iso ? new Date(iso).toLocaleDateString(loc(), opt || { day: "2-digit", month: "short", year: "numeric" }) : "-";
const fmtNum = n => Number(n || 0).toLocaleString(loc());
const $ = id => document.getElementById(id);

async function cuRpc(name, params) {
    const res = await supabaseClient.rpc(name, { p_session_token: getSession(), ...(params || {}) });
    if (res.error) {
        console.error(res.error);
        const m = res.error.message || "";
        if (m.toLowerCase().includes("sesi") && !isAdminView()) { clearSession(); window.location.href = "index.html"; }
        else if (/does not exist|schema cache/i.test(m)) console.warn("Jalankan sql/supply.sql di Supabase");
    }
    return res;
}

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("#pTabs button").forEach(b => b.addEventListener("click", () => {
        document.querySelectorAll("#pTabs button").forEach(x => x.classList.toggle("active", x === b));
        document.querySelectorAll(".p-tab").forEach(p => p.style.display = p.id === "ptab-" + b.dataset.ptab ? "block" : "none");
        if (b.dataset.ptab === "home") setTimeout(() => Object.values(_cuCharts).forEach(c => c.resize()), 50);
    }));
    document.addEventListener("themechange", () => renderCharts());
    document.addEventListener("langchange", () => { renderAnnouncements(); renderSupply(); renderSupplyOrders(); renderArchive(); renderCharts(); });
    loadAnnouncements(); loadSupply();
});

/* ---------------- Pengumuman ---------------- */
let _anns = [];
async function loadAnnouncements() { const { data } = await cuRpc("cu_announcements"); _anns = data || []; renderAnnouncements(); }
function renderAnnouncements() {
    const hidden = JSON.parse(localStorage.getItem("ann_hidden") || "[]");
    const list = _anns.filter(a => !hidden.includes(a.id));
    $("annBox").innerHTML = list.map(a => `
        <div class="ann-card ${a.pinned ? "pinned" : ""}">
            <div class="ann-head"><b>${a.pinned ? "📌 " : "📣 "}${escapeHtml(a.judul)}</b>
                ${a.pinned ? `<span class="ann-tag">${escapeHtml(t("ann_important"))}</span>` : ""}
                <button type="button" class="ann-x" onclick="hideAnn(${a.id})" aria-label="Tutup">✕</button></div>
            ${a.isi ? `<div class="ann-body">${escapeHtml(a.isi).replace(/\n/g, "<br>")}</div>` : ""}
            <div class="ann-date">${fmtDate(a.created_at)}</div>
        </div>`).join("");
}
function hideAnn(id) {
    const h = JSON.parse(localStorage.getItem("ann_hidden") || "[]"); h.push(id);
    localStorage.setItem("ann_hidden", JSON.stringify(h)); renderAnnouncements();
}

/* ---------------- Supply & Stock ---------------- */
async function loadSupply() {
    const [a, b] = await Promise.all([cuRpc("cu_supply"), cuRpc("cu_my_supply_orders")]);
    mySupply = a.data || []; mySupplyOrders = b.data || [];
    renderSupply(); renderSupplyOrders(); renderKpi();
}
const _supImg = {};   // "id:versi" -> dataURL
const supImgKey = s => s.id + ":" + s.img_v;
function renderSupply() {
    $("supplyEmpty").style.display = mySupply.length ? "none" : "block";
    $("supplyList").innerHTML = mySupply.map(s => {
        const out = !(s.total > 0), src = s.img_v && _supImg[supImgKey(s)];
        return `
        <article class="shop-card ${out ? "is-out" : ""}">
            <div class="shop-media" ${s.img_v ? `onclick="openSupplyImg(${s.id})"` : ""} data-sid="${s.id}">
                ${src ? `<img src="${src}" alt="${escapeHtml(s.item || s.nama)}">` : `<div class="shop-ph">${s.img_v ? "⏳" : "📦"}</div>`}
                <span class="shop-batch">${escapeHtml(s.nama)}</span>
                ${out ? `<span class="shop-out">${escapeHtml(t("supply_out"))}</span>` : ""}
            </div>
            <div class="shop-body">
                <div class="supply-name">${escapeHtml(s.item || s.nama)}</div>
                <div class="supply-meta">${escapeHtml(t("supply_updated"))}: ${fmtDate(s.updated_at)}</div>
                <div class="shop-stock"><span>${escapeHtml(t("supply_stock"))}</span><b>${out ? "0" : fmtNum(s.total)}</b>${out ? "" : `<small>${escapeHtml(s.satuan)}</small>`}</div>
                <div class="supply-order">
                    <input type="number" min="1" max="${s.total}" id="sq${s.id}" placeholder="${escapeHtml(t("supply_qty_ph"))}" ${out ? "disabled" : ""}>
                    <button type="button" class="btn btn-primary" onclick="askOrder(${s.id})" ${out ? "disabled" : ""}>${escapeHtml(t("supply_order_btn"))}</button>
                </div>
            </div>
        </article>`;
    }).join("");
    hydrateSupplyImages();
}
/* gambar dimuat per batch lalu di-cache; hanya diunduh ulang jika admin mengganti gambarnya */
function hydrateSupplyImages() {
    mySupply.filter(s => s.img_v && !_supImg[supImgKey(s)]).forEach(async s => {
        const { data } = await cuRpc("cu_supply_image", { p_batch_id: s.id });
        if (!data) return;
        _supImg[supImgKey(s)] = `data:${data.mime};base64,${data.data}`;
        const el = document.querySelector(`.shop-media[data-sid="${s.id}"]`);
        if (el) { const ph = el.querySelector(".shop-ph"); if (ph) ph.outerHTML = `<img src="${_supImg[supImgKey(s)]}" alt="${escapeHtml(s.item || s.nama)}">`; }
    });
}
function openSupplyImg(id) {
    const s = mySupply.find(x => x.id === id), src = s && _supImg[supImgKey(s)]; if (!src) return;
    $("modalBox").innerHTML = `<img src="${src}" alt="" class="shop-zoom"><div class="modal-title" style="margin-top:12px;">${escapeHtml(s.item || s.nama)}</div>
        <div class="modal-sub">${escapeHtml(s.nama)}</div>
        <button type="button" class="btn btn-ghost btn-block" id="zoomClose">${escapeHtml(t("modal_close"))}</button>`;
    $("modalOverlay").classList.add("show"); $("zoomClose").addEventListener("click", closeModal);
}
function askOrder(batchId) {
    const s = mySupply.find(x => x.id === batchId); if (!s) return;
    const q = parseInt($("sq" + batchId).value, 10);
    if (!q || q < 1 || q > s.total) { showToast(t("supply_qty_err"), "danger"); return; }
    $("modalBox").innerHTML = `<div class="modal-title">📦 ${escapeHtml(t("supply_order_btn"))}</div>
        <div class="modal-sub">${escapeHtml(t("supply_confirm", { q: fmtNum(q), u: s.satuan, i: s.item || s.nama }))}</div>
        <button type="button" class="btn btn-primary btn-block" id="ordYes">${escapeHtml(t("supply_order_btn"))}</button>
        <button type="button" class="btn btn-ghost btn-block" id="ordNo" style="margin-top:8px;">${escapeHtml(t("modal_close"))}</button>`;
    $("modalOverlay").classList.add("show");
    $("ordNo").addEventListener("click", closeModal);
    $("ordYes").addEventListener("click", async () => {
        $("ordYes").disabled = true;
        const { error } = await cuRpc("cu_place_supply_order", { p_batch_id: batchId, p_qty: q });
        closeModal();
        if (error) { showToast(error.message || "Error", "danger"); return; }
        showToast(t("supply_ordered_ok"), "success"); loadSupply();
    });
}
function renderSupplyOrders() {
    $("supplyOrdersEmpty").style.display = mySupplyOrders.length ? "none" : "block";
    $("supplyOrdersTable").style.display = mySupplyOrders.length ? "table" : "none";
    $("supplyOrdersBody").innerHTML = mySupplyOrders.map(o => `
        <tr><td>${fmtDate(o.created_at)}</td><td><b>${escapeHtml(o.item || o.nama)}</b></td><td>${fmtNum(o.qty)} ${escapeHtml(o.satuan)}</td>
        <td><span class="badge ${o.status === "sent" ? "badge-done" : "badge-proses"}">${o.status === "sent" ? "✅ " + escapeHtml(t("supply_status_sent")) : "⏳ " + escapeHtml(t("supply_status_pending"))}</span></td>
        <td>${o.status === "pending" ? `<button type="button" class="btn btn-ghost mini" onclick="cancelOrder(${o.id})">${escapeHtml(t("supply_cancel"))}</button>` : ""}</td></tr>`).join("");
}
async function cancelOrder(id) { const { error } = await cuRpc("cu_cancel_supply_order", { p_id: id }); if (!error) loadSupply(); }

/* ---------------- Arsip pribadi + grafik (dipanggil dashboard.js) ---------------- */
async function onOrdersLoaded() {
    const { data } = await cuRpc("cu_my_archives");
    myArchives = data || [];
    renderArchive(); renderKpi(); renderCharts();
}
function renderArchive() {
    $("arsipEmpty").style.display = myArchives.length ? "none" : "block";
    $("arsipBody").innerHTML = myArchives.map((a, i) => `
        <tr><td>${i + 1}</td><td><b>${escapeHtml(a.tagar)}</b></td><td>${escapeHtml(a.dashboard)}</td>
        <td>H${a.paket_terkirim} / H${a.paket_total}</td><td>${fmtDate(a.archived_at)}</td><td>${typeof renewalActionHtml === "function" ? renewalActionHtml("archive", a) : ""}</td></tr>`).join("");
}
function renderKpi() {
    const all = [...allOrders, ...myArchives];
    const first = all.map(o => o.created_at).filter(Boolean).sort()[0];
    $("kpiAll").textContent = all.length;
    $("kpiSince").textContent = first ? fmtDate(first, { month: "short", year: "numeric" }) : "-";
    $("kpiArsip").textContent = myArchives.length;
    $("kpiSupply").textContent = mySupplyOrders.length;
}
function renderCharts() {
    if (typeof Chart === "undefined") return;
    const all = [...allOrders, ...myArchives].filter(o => o.created_at);
    const key = d => `${d.getFullYear()}-${d.getMonth()}`;
    const now = new Date();
    let start = all.length ? new Date(Math.min(...all.map(o => new Date(o.created_at)))) : now;
    start = new Date(start.getFullYear(), start.getMonth(), 1);
    const minStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    if (start > minStart) start = minStart;
    const maxStart = new Date(now.getFullYear(), now.getMonth() - 23, 1);
    if (start < maxStart) start = maxStart;
    const keys = [], labels = [];
    for (let d = new Date(start); d <= now; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        keys.push(key(d)); labels.push(d.toLocaleDateString(loc(), { month: "short", year: "2-digit" }));
    }
    const per = {}; all.forEach(o => { const k = key(new Date(o.created_at)); per[k] = (per[k] || 0) + 1; });

    const dash = { BEM: 0, SEM: 0, LEM: 0 }; all.forEach(o => { const k = String(o.dashboard || "").toUpperCase(); if (k in dash) dash[k]++; });
    const st = { proses: 0, mendekati: 0, selesai: 0 }; allOrders.forEach(o => st[getOrderStatus(o.paket_terkirim, o.paket_total).key]++);

    const _tc = themeChartColors(), GOLD = _tc.gold, SILVER = _tc.info, ROSE = _tc.danger, GREEN = _tc.success;
    Chart.defaults.color = _tc.text; Chart.defaults.font.family = "Inter, sans-serif";
    const draw = (id, cfg) => { if (_cuCharts[id]) _cuCharts[id].destroy(); _cuCharts[id] = new Chart($(id), cfg); };
    const base = { responsive: true, maintainAspectRatio: false };
    draw("cuChartBulan", { type: "bar", data: { labels, datasets: [{ data: keys.map(k => per[k] || 0), backgroundColor: GOLD, borderRadius: 4 }] },
        options: { ...base, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: _tc.grid } } } } });
    const donut = (id, lab, data, colors) => draw(id, { type: "doughnut", data: { labels: lab, datasets: [{ data, backgroundColor: colors, borderColor: _tc.surface, borderWidth: 3 }] },
        options: { ...base, cutout: "66%", plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } } } } });
    donut("cuChartDash", ["BEM", "SEM", "LEM"], [dash.BEM, dash.SEM, dash.LEM], [GOLD, SILVER, ROSE]);
    donut("cuChartStatus", [t("status_proses"), t("status_mendekati"), t("status_selesai")], [st.proses, st.mendekati, st.selesai], [SILVER, _tc.warning, GREEN]);
}
