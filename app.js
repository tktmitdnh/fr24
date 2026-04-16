(function () {
  "use strict";

  const JST_OFFSET_MIN = 9 * 60;
  const API_URL = window.FR24_PUBLIC_API_URL || "";
  const TYPES_CACHE = new Map();
  const DAY_CACHE = new Map();
  let SELECTED_TYPE_KEYS = new Set();
  let MANIFEST = null;

  function pad2(n) { return n.toString().padStart(2, "0"); }

  function jsonp(resource, params) {
    if (!API_URL) {
      return Promise.reject(new Error("Set window.FR24_PUBLIC_API_URL in public_site/config.js"));
    }
    return new Promise((resolve, reject) => {
      const callbackName = `fr24Jsonp_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const query = new URLSearchParams(Object.assign({}, params || {}, { resource, prefix: callbackName, t: Date.now().toString() }));
      const script = document.createElement("script");
      const cleanup = () => {
        delete window[callbackName];
        script.remove();
      };
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("JSONP timeout"));
      }, 30000);
      window[callbackName] = (payload) => {
        window.clearTimeout(timer);
        cleanup();
        if (payload && payload.ok === false) {
          reject(new Error(payload.error || "Unknown API error"));
          return;
        }
        resolve(payload);
      };
      script.onerror = () => {
        window.clearTimeout(timer);
        cleanup();
        reject(new Error("Failed to load public API"));
      };
      script.src = `${API_URL}?${query.toString()}`;
      document.body.appendChild(script);
    });
  }

  function isoToDate(dstr) {
    if (!dstr) return null;
    const d = new Date(dstr);
    if (isNaN(d.getTime())) return null;
    return d;
  }

  function formatIso(dtIso) {
    if (!dtIso) return "-";
    const d = new Date(dtIso);
    if (isNaN(d.getTime())) return "-";
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function formatDelay(min) {
    if (min === null || min === undefined) return "-";
    const v = Math.round(min);
    const sign = v >= 0 ? "+" : "-";
    return `${sign}${Math.abs(v)} min`;
  }

  function getSelectedDayBoundsJST() {
    const dateStr = document.getElementById("dateInput").value;
    const dayStart = new Date(dateStr + "T00:00:00+09:00");
    const dayEnd = new Date(dateStr + "T24:00:00+09:00");
    return { dayStart, dayEnd };
  }

  function minutesFromDayStart(d, dayStart) {
    return (d.getTime() - dayStart.getTime()) / 60000.0;
  }

  function clampDate(d, minD, maxD) {
    const t = d.getTime();
    if (t < minD.getTime()) return new Date(minD.getTime());
    if (t > maxD.getTime()) return new Date(maxD.getTime());
    return d;
  }

  function aircraftFamily(typeRaw) {
    const t = (typeRaw || "").toUpperCase();
    if (t.includes("320") || t.includes("321") || t.includes("A20N") || t.includes("A21N")) return "A32X";
    if (t.includes("737") || t.includes("738") || t.includes("73H") || t.includes("739") || t.includes("73M")) return "B737";
    if (t.includes("767") || t.includes("763")) return "B767";
    if (t.includes("777") || t.includes("772") || t.includes("773")) return "B777";
    if (t.includes("787") || t.includes("788") || t.includes("789") || t.includes("781")) return "B787";
    if (t.includes("Q84") || t.includes("DH8D") || t.includes("DHC8")) return "Q400";
    return "default";
  }

  function getBarColor(airline, typeRaw) {
    const fam = aircraftFamily(typeRaw);
    const palette = {
      NH: { default:"#2b6cb0", A32X:"#4c6fff", B737:"#3182ce", B767:"#1d4ed8", B777:"#1e3a8a", B787:"#2563eb", Q400:"#0ea5e9" },
      JL: { default:"#c53030", A32X:"#f97373", B737:"#f56565", B767:"#e53e3e", B777:"#b91c1c", B787:"#9b2c2c", Q400:"#f97373" },
      HD: { default:"#805ad5", A32X:"#9f7aea", B737:"#6d28d9", B767:"#5b21b6", B777:"#4c1d95", B787:"#7c3aed", Q400:"#a855f7" },
      "6J":{ default:"#38a169", A32X:"#4ade80", B737:"#22c55e", B767:"#16a34a", B777:"#15803d", B787:"#047857", Q400:"#4ade80" },
      BC: { default:"#dd6b20", A32X:"#fdba74", B737:"#f97316", B767:"#ea580c", B777:"#c2410c", B787:"#9a3412", Q400:"#fdba74" },
      MM: { default:"#ec4899", A32X:"#f472b6", B737:"#f9a8d4", B767:"#db2777", B777:"#be185d", B787:"#c026d3", Q400:"#fbcfe8" },
      GK: { default:"#94a3b8", A32X:"#cbd5e1", B737:"#d1d5db", B767:"#9ca3af", B777:"#6b7280", B787:"#64748b", Q400:"#e5e7eb" }
    };
    const base = palette[airline] || palette.NH;
    return base[fam] || base.default;
  }

  function buildTimeScale() {
    const scale = document.getElementById("time-scale");
    scale.innerHTML = "";
    const width = scale.clientWidth || scale.parentElement.clientWidth;
    const totalMinutes = 24 * 60;
    const pxPerMin = width / totalMinutes;
    for (let h = 0; h <= 24; h++) {
      const x = h * 60 * pxPerMin;
      const label = document.createElement("div");
      label.className = "time-label";
      label.style.left = x + "px";
      label.textContent = pad2(h % 24) + ":00";
      scale.appendChild(label);
    }
    const gridLayer = document.createElement("div");
    gridLayer.style.position = "absolute";
    gridLayer.style.left = "0";
    gridLayer.style.right = "0";
    gridLayer.style.top = "0";
    gridLayer.style.bottom = "0";
    scale.appendChild(gridLayer);
    for (let m = 0; m <= totalMinutes; m += 15) {
      const x = m * pxPerMin;
      const line = document.createElement("div");
      line.className = "time-grid-line";
      if (m % 60 === 0) line.classList.add("time-grid-line-hour");
      line.style.left = x + "px";
      gridLayer.appendChild(line);
    }
  }

  function getSelectedTypeKeys() {
    return Array.from(document.querySelectorAll('#typeList input[type="checkbox"]:checked'))
      .map(el => el.value)
      .filter(Boolean);
  }

  function updateTypeDropdownLabel(items) {
    const btn = document.getElementById("typeDropdownBtn");
    if (!btn) return;
    const total = items.length;
    const selected = getSelectedTypeKeys().length;
    if (total === 0) {
      btn.textContent = "No types";
    } else if (selected === 0) {
      btn.textContent = "No types selected";
    } else if (selected === total) {
      btn.textContent = `All types (${total})`;
    } else {
      btn.textContent = `${selected} / ${total} types`;
    }
  }

  function renderTypeCheckboxes(items) {
    const list = document.getElementById("typeList");
    list.innerHTML = "";
    for (const item of items) {
      const label = document.createElement("label");
      label.className = "type-chip";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = item.key;
      input.checked = SELECTED_TYPE_KEYS.size === 0 || SELECTED_TYPE_KEYS.has(item.key);
      input.addEventListener("change", () => {
        SELECTED_TYPE_KEYS = new Set(getSelectedTypeKeys());
        updateTypeDropdownLabel(items);
        loadTimeline();
      });
      const text = document.createElement("span");
      text.textContent = item.label;
      label.appendChild(input);
      label.appendChild(text);
      list.appendChild(label);
    }
    SELECTED_TYPE_KEYS = new Set(getSelectedTypeKeys());
    updateTypeDropdownLabel(items);
  }

  function setAllTypeCheckboxes(checked) {
    const inputs = document.querySelectorAll('#typeList input[type="checkbox"]');
    for (const input of inputs) input.checked = checked;
    SELECTED_TYPE_KEYS = new Set(getSelectedTypeKeys());
  }

  function currentTypeOptions() {
    const airline = document.getElementById("airlineSelect").value || "ALL";
    return TYPES_CACHE.get(airline) || [];
  }

  function applyTypeOptions(typeMap) {
    TYPES_CACHE.clear();
    Object.keys(typeMap || {}).forEach((key) => {
      const items = Array.isArray(typeMap[key]) ? typeMap[key].slice().sort((a, b) => a.label.localeCompare(b.label)) : [];
      TYPES_CACHE.set(key, items);
    });
    renderTypeCheckboxes(currentTypeOptions());
  }

  function filterEvents(events) {
    const airline = document.getElementById("airlineSelect").value;
    const selectedTypes = getSelectedTypeKeys();
    const hasTypeInputs = document.querySelectorAll('#typeList input[type="checkbox"]').length > 0;
    const scopes = [];
    if (document.getElementById("scopeDomestic").checked) scopes.push("DOMESTIC");
    if (document.getElementById("scopeInternational").checked) scopes.push("INTERNATIONAL");
    const airport = document.getElementById("airportInput").value.trim().toUpperCase();
    const reg = document.getElementById("regInput").value.trim().toUpperCase();
    const flight = document.getElementById("flightInput").value.trim().toUpperCase();

    if ((hasTypeInputs && selectedTypes.length === 0) || scopes.length === 0) {
      return [];
    }

    return (events || []).filter((ev) => {
      if (airline && airline !== "ALL" && (ev.airline || "") !== airline) return false;
      if (selectedTypes.length > 0 && !selectedTypes.includes(ev.aircraft_type_key || "")) return false;
      if (scopes.length > 0 && !scopes.includes(ev.service_scope || "")) return false;
      if (airport && ![String(ev.origin || "").toUpperCase(), String(ev.destination || "").toUpperCase()].includes(airport)) return false;
      if (reg && String(ev.reg || "").toUpperCase() !== reg) return false;
      if (flight && String(ev.flight || "").toUpperCase() !== flight) return false;
      return true;
    });
  }

  function showDetails(ev) {
    const panel = document.getElementById("details-panel");
    const withSchedule = document.getElementById("withSchedule").checked;
    const lines = [];
    lines.push(`Flight: ${ev.flight || ""}  Reg: ${ev.reg || ""}  Airline: ${ev.airline || ""}`);
    lines.push(`Type: ${ev.aircraft_type || ""}`);
    lines.push(`Route: ${ev.origin || ""} -> ${ev.destination || ""}`);
    lines.push("");
    lines.push(
      `First seen (block out): ${formatIso(ev.first_seen)}\n` +
      `Takeoff:                ${formatIso(ev.takeoff)}\n` +
      `Landing:                ${formatIso(ev.landed)}\n` +
      `Last seen (block in):   ${formatIso(ev.last_seen)}`
    );
    lines.push("");
    if (withSchedule && (ev.scheduled_dep || ev.scheduled_arr)) {
      lines.push(`STD: ${formatIso(ev.scheduled_dep)}   ATD(block out): ${formatIso(ev.first_seen)}   Delay: ${formatDelay(ev.dep_delay_min)}`);
      lines.push(`STA: ${formatIso(ev.scheduled_arr)}   ATA(block in):  ${formatIso(ev.last_seen)}   Delay: ${formatDelay(ev.arr_delay_min)}`);
      if (ev.long_delay_flag) {
        lines.push("");
        lines.push("※ 1時間以上の遅延便です（出発または到着）");
      }
    } else {
      lines.push("STD/STA: hidden or unavailable in this view");
    }
    panel.textContent = lines.join("\n");
  }

  function renderTimeline(events) {
    const { dayStart, dayEnd } = getSelectedDayBoundsJST();
    const body = document.getElementById("timeline-body");
    body.innerHTML = "";
    buildTimeScale();
    const totalMinutes = 24 * 60;
    const rightHeader = document.getElementById("timeline-header-right");
    const width = rightHeader.clientWidth || 1400;
    const pxPerMin = width / totalMinutes;

    const byReg = {};
    for (const ev of events) {
      const reg = ev.reg || "(unknown)";
      if (!byReg[reg]) byReg[reg] = [];
      byReg[reg].push(ev);
    }

    const regs = Object.keys(byReg);
    const regMeta = {};
    for (const reg of regs) {
      const sample = byReg[reg][0] || {};
      regMeta[reg] = { airline: sample.airline || "", type: sample.aircraft_type || "" };
    }

    const sortMode = document.getElementById("sortSelect").value;
    regs.sort((a, b) => {
      if (sortMode === "airline_reg") {
        const aa = regMeta[a].airline.localeCompare(regMeta[b].airline);
        if (aa !== 0) return aa;
      } else if (sortMode === "type_reg") {
        const tt = regMeta[a].type.localeCompare(regMeta[b].type);
        if (tt !== 0) return tt;
      }
      return a.localeCompare(b);
    });

    for (const reg of regs) {
      const label = document.createElement("div");
      label.className = "reg-label";
      label.textContent = reg;

      const infoCell = document.createElement("div");
      infoCell.className = "info-cell";
      infoCell.textContent = `${regMeta[reg].airline || "-"} / ${regMeta[reg].type || "-"}`;

      const row = document.createElement("div");
      row.className = "reg-row";
      const track = document.createElement("div");
      track.style.position = "relative";
      row.appendChild(track);

      body.appendChild(label);
      body.appendChild(infoCell);
      body.appendChild(row);

      const eventsForReg = byReg[reg].sort((a, b) => (a.start || "").localeCompare(b.start || ""));
      for (const ev of eventsForReg) {
        const s = isoToDate(ev.start);
        const e = isoToDate(ev.end);
        if (!s || !e) continue;

        const ss = clampDate(s, dayStart, dayEnd);
        const ee = clampDate(e, dayStart, dayEnd);
        if (ee.getTime() <= ss.getTime()) continue;

        const startMin = minutesFromDayStart(ss, dayStart);
        const endMin = minutesFromDayStart(ee, dayStart);
        const left = Math.max(0, startMin * pxPerMin);
        const widthPx = Math.max(2, (endMin - startMin) * pxPerMin);

        function addTaxiSegment(tStartIso, tEndIso) {
          if (!tStartIso || !tEndIso) return;
          const ts0 = isoToDate(tStartIso);
          const te0 = isoToDate(tEndIso);
          if (!ts0 || !te0) return;
          const ts = clampDate(ts0, dayStart, dayEnd);
          const te = clampDate(te0, dayStart, dayEnd);
          if (te.getTime() <= ts.getTime()) return;
          const tStart = minutesFromDayStart(ts, dayStart);
          const tEnd = minutesFromDayStart(te, dayStart);
          const taxiDiv = document.createElement("div");
          taxiDiv.className = "taxi-bar";
          taxiDiv.style.left = Math.max(0, tStart * pxPerMin) + "px";
          taxiDiv.style.width = Math.max(1, (tEnd - tStart) * pxPerMin) + "px";
          taxiDiv.style.backgroundColor = getBarColor(ev.airline || "", ev.aircraft_type || "");
          track.appendChild(taxiDiv);
        }

        addTaxiSegment(ev.taxi_out_start, ev.taxi_out_end);
        addTaxiSegment(ev.taxi_in_start, ev.taxi_in_end);

        const bar = document.createElement("div");
        bar.className = "flight-bar";
        bar.style.left = left + "px";
        bar.style.width = widthPx + "px";
        bar.style.backgroundColor = getBarColor(ev.airline || "", ev.aircraft_type || "");
        if (ev.long_delay_flag) bar.classList.add("long-delay");
        const labelSpan = document.createElement("span");
        labelSpan.className = "flight-bar-label";
        labelSpan.textContent = `${ev.flight || "??"} ${ev.origin || ""}-${ev.destination || ""}`;
        bar.appendChild(labelSpan);
        bar.addEventListener("click", () => showDetails(ev));
        track.appendChild(bar);
      }
    }
  }

  function toggleTypePanel(forceOpen) {
    const panel = document.getElementById("typePanel");
    if (!panel) return;
    const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : !panel.classList.contains("open");
    panel.classList.toggle("open", shouldOpen);
  }

  async function loadManifest() {
    MANIFEST = await jsonp("manifest", {});
    const statusBar = document.getElementById("status-bar");
    const updated = MANIFEST.last_data_update_utc ? new Date(MANIFEST.last_data_update_utc).toLocaleString() : "-";
    statusBar.textContent = `Public data status: ${MANIFEST.source_rows ?? "-"} rows / ${MANIFEST.cumulative_files ?? "-"} files / updated ${updated} / snapshot ${MANIFEST.generated_at_utc ? new Date(MANIFEST.generated_at_utc).toLocaleString() : "-"}`;

    const dateInput = document.getElementById("dateInput");
    if (MANIFEST.default_date) {
      dateInput.value = MANIFEST.default_date;
      if (Array.isArray(MANIFEST.available_dates) && MANIFEST.available_dates.length > 0) {
        dateInput.min = MANIFEST.available_dates[0];
        dateInput.max = MANIFEST.available_dates[MANIFEST.available_dates.length - 1];
      }
    }
  }

  async function loadTypeOptions() {
    const typeMap = await jsonp("type_options", {});
    applyTypeOptions(typeMap || {});
  }

  async function loadDateEvents(dateStr) {
    if (DAY_CACHE.has(dateStr)) return DAY_CACHE.get(dateStr);
    const payload = await jsonp("timeline", { date: dateStr });
    const events = Array.isArray(payload) ? payload : [];
    DAY_CACHE.set(dateStr, events);
    return events;
  }

  async function loadTimeline() {
    const err = document.getElementById("error");
    if (err) err.textContent = "Loading...";
    const date = document.getElementById("dateInput").value;
    if (!date) {
      if (err) err.textContent = "No date selected";
      return;
    }
    try {
      const allEvents = await loadDateEvents(date);
      const filtered = filterEvents(allEvents);
      if (err) err.textContent = `Loaded ${filtered.length} events`;
      renderTimeline(filtered);
    } catch (e) {
      if (err) err.textContent = "Error loading timeline: " + e;
      alert("Error loading timeline: " + e);
    }
  }

  function init() {
    document.getElementById("reloadBtn").addEventListener("click", loadTimeline);
    document.getElementById("typeDropdownBtn").addEventListener("click", (ev) => {
      ev.stopPropagation();
      toggleTypePanel();
    });
    document.getElementById("typeAllBtn").addEventListener("click", () => {
      setAllTypeCheckboxes(true);
      renderTypeCheckboxes(currentTypeOptions());
      loadTimeline();
    });
    document.getElementById("typeNoneBtn").addEventListener("click", () => {
      setAllTypeCheckboxes(false);
      renderTypeCheckboxes(currentTypeOptions());
      loadTimeline();
    });
    document.getElementById("sortSelect").addEventListener("change", loadTimeline);
    document.getElementById("scopeDomestic").addEventListener("change", loadTimeline);
    document.getElementById("scopeInternational").addEventListener("change", loadTimeline);
    document.getElementById("withSchedule").addEventListener("change", loadTimeline);
    document.getElementById("airlineSelect").addEventListener("change", () => {
      SELECTED_TYPE_KEYS = new Set();
      renderTypeCheckboxes(currentTypeOptions());
      loadTimeline();
    });
    document.getElementById("airportInput").addEventListener("change", loadTimeline);
    document.getElementById("regInput").addEventListener("change", loadTimeline);
    document.getElementById("flightInput").addEventListener("change", loadTimeline);
    document.getElementById("dateInput").addEventListener("change", loadTimeline);

    document.addEventListener("click", (ev) => {
      const panel = document.getElementById("typePanel");
      const dropdown = document.querySelector(".type-dropdown");
      if (!panel || !dropdown) return;
      if (!dropdown.contains(ev.target)) toggleTypePanel(false);
    });

    let resizeTimer = null;
    window.addEventListener("resize", () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => loadTimeline(), 250);
    });

    Promise.resolve()
      .then(loadManifest)
      .then(loadTypeOptions)
      .then(loadTimeline)
      .catch((e) => {
        const err = document.getElementById("error");
        if (err) err.textContent = "Init failed: " + e;
      });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
