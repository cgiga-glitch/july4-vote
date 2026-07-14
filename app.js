/* =========================================================
   스케줄 정의 (지원 요청 시간대)
   ========================================================= */
const DAYS = [
  { date: "2026-06-14", label: "6/14 (일)", windows: [["13:00", "17:00"]] },
  { date: "2026-06-15", label: "6/15 (월)", windows: [["09:00", "12:00"], ["13:00", "17:00"]] },
  { date: "2026-06-16", label: "6/16 (화)", windows: [["09:00", "12:00"]] },
];
const SLOT_MINUTES = 30;
const GRID_START = "09:00";
const GRID_END = "17:00"; // exclusive end of last slot

/* ---------- time helpers ---------- */
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function toHHMM(mins) {
  const h = Math.floor(mins / 60).toString().padStart(2, "0");
  const m = (mins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}
function buildRows() {
  const rows = [];
  for (let t = toMinutes(GRID_START); t < toMinutes(GRID_END); t += SLOT_MINUTES) {
    rows.push(toHHMM(t));
  }
  return rows;
}
const ROWS = buildRows();

function isAvailable(dayDef, rowStart) {
  const start = toMinutes(rowStart);
  return dayDef.windows.some(([ws, we]) => start >= toMinutes(ws) && start < toMinutes(we));
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function slotKey(date, rowStart) {
  return `${date}|${rowStart}`;
}

/* =========================================================
   상태
   ========================================================= */
const selected = new Set();   // 이번 세션에서 내가 선택 중인 슬롯 (key)
let bookedMap = {};            // 서버에 이미 저장된 슬롯: key -> 이름 (한 슬롯 = 한 사람)

function currentName() {
  return document.getElementById("nameInput").value.trim();
}

/* =========================================================
   서버에서 현재 예약 현황 불러오기
   ========================================================= */
async function loadBookings() {
  try {
    const res = await fetch(APPS_SCRIPT_URL + "?action=summary", { method: "GET" });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "불러오기 실패");
    bookedMap = data.bookings || {};
    return data;
  } catch (err) {
    document.getElementById("statusMsg").textContent = "현황 불러오기 실패: " + err.message;
    document.getElementById("statusMsg").className = "status-msg err";
    return null;
  }
}

/* =========================================================
   설문 캘린더 렌더링 + 드래그 선택
   한 슬롯 = 한 사람만 선택 가능. 선택 시 이름이 슬롯에 표시됨.
   ========================================================= */
function renderSurveyCalendar() {
  const grid = document.getElementById("calendarGrid");
  grid.innerHTML = "";
  grid.style.gridTemplateColumns = `64px repeat(${DAYS.length}, 1fr)`;

  grid.appendChild(el("div", "cal-head", ""));
  DAYS.forEach((d) => grid.appendChild(el("div", "cal-head", d.label)));

  const name = currentName();

  ROWS.forEach((rowStart) => {
    grid.appendChild(el("div", "cal-time", rowStart));
    DAYS.forEach((d) => {
      const available = isAvailable(d, rowStart);
      const key = slotKey(d.date, rowStart);
      const owner = bookedMap[key];
      let cls = "cal-cell";
      let label = "";

      if (!available) {
        cls += " unavailable";
      } else if (owner && owner !== name) {
        // 다른 사람이 이미 선점한 슬롯 → 잠금
        cls += " taken";
        label = owner;
      } else if (selected.has(key)) {
        // 내가 선택 중 (신규 선택 또는 기존 내 예약)
        cls += " selected";
        label = name || "";
      }

      const cell = el("div", cls);
      cell.dataset.date = d.date;
      cell.dataset.time = rowStart;
      if (label) cell.textContent = label;

      const lockedForMe = !available || (owner && owner !== name);
      if (!lockedForMe) attachDragHandlers(cell);

      grid.appendChild(cell);
    });
  });
}

let dragState = null; // { adding: bool, touched: Set }

function attachDragHandlers(cell) {
  cell.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    if (!currentName()) {
      const statusEl = document.getElementById("statusMsg");
      statusEl.textContent = "먼저 이름을 입력해 주세요.";
      statusEl.className = "status-msg err";
      return;
    }
    const key = slotKey(cell.dataset.date, cell.dataset.time);
    const adding = !selected.has(key);
    dragState = { adding, touched: new Set() };
    paintCell(cell, adding);
  });
  cell.addEventListener("mouseenter", () => {
    if (!dragState) return;
    paintCell(cell, dragState.adding);
  });
}

document.addEventListener("mouseup", () => {
  if (dragState) {
    dragState = null;
    updateTotalHours();
  }
});

function paintCell(cell, adding) {
  const key = slotKey(cell.dataset.date, cell.dataset.time);
  if (dragState.touched.has(key)) return;
  dragState.touched.add(key);
  if (adding) {
    selected.add(key);
    cell.classList.add("selected");
    cell.textContent = currentName();
  } else {
    selected.delete(key);
    cell.classList.remove("selected");
    cell.textContent = "";
  }
  updateTotalHours();
}

function updateTotalHours() {
  const hours = (selected.size * SLOT_MINUTES) / 60;
  document.getElementById("totalHours").textContent = `${hours}시간`;
  updateNameLockState();
}

/* 슬롯을 하나라도 선택한 상태에서는 이름을 바꿀 수 없도록 잠근다.
   선택을 모두 해제하면 다시 이름을 입력/수정할 수 있다. */
function updateNameLockState() {
  const nameInput = document.getElementById("nameInput");
  if (selected.size > 0) {
    nameInput.readOnly = true;
    nameInput.classList.add("locked");
  } else {
    nameInput.readOnly = false;
    nameInput.classList.remove("locked");
  }
}

/* 이름 입력란: 입력할 때마다 화면 갱신(잠금/라벨 반영),
   포커스를 벗어나면(blur) 내가 이전에 저장해둔 슬롯을 자동으로 불러와 선택 상태로 표시 */
const nameInput = document.getElementById("nameInput");
nameInput.addEventListener("input", () => {
  renderSurveyCalendar();
  updateTotalHours();
});
nameInput.addEventListener("blur", () => {
  const name = currentName();
  if (!name) return;
  Object.entries(bookedMap).forEach(([key, owner]) => {
    if (owner === name) selected.add(key);
  });
  renderSurveyCalendar();
  updateTotalHours();
});

/* =========================================================
   제출
   ========================================================= */
document.getElementById("submitBtn").addEventListener("click", async () => {
  const name = currentName();
  const statusEl = document.getElementById("statusMsg");
  statusEl.className = "status-msg";

  if (!name) {
    statusEl.textContent = "이름을 입력해 주세요.";
    statusEl.className = "status-msg err";
    return;
  }
  if (selected.size === 0) {
    statusEl.textContent = "최소 한 개 이상의 시간을 선택해 주세요.";
    statusEl.className = "status-msg err";
    return;
  }

  const slots = Array.from(selected).map((key) => {
    const [date, start] = key.split("|");
    const end = toHHMM(toMinutes(start) + SLOT_MINUTES);
    return { date, start, end };
  });

  const btn = document.getElementById("submitBtn");
  btn.disabled = true;
  statusEl.textContent = "제출 중...";

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "submit", name, slots }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "알 수 없는 오류");

    await loadBookings(); // 최신 예약 현황 다시 불러오기

    if (data.conflicts && data.conflicts.length > 0) {
      const conflictTxt = data.conflicts
        .map((c) => `${c.date} ${c.start} (${c.owner})`)
        .join(", ");
      statusEl.textContent = `일부 시간은 이미 다른 사람이 선택해 저장되지 않았습니다: ${conflictTxt}`;
      statusEl.className = "status-msg err";
    } else {
      statusEl.textContent = `${name}님, 제출 완료 (총 ${(data.saved.length * SLOT_MINUTES) / 60}시간)`;
      statusEl.className = "status-msg ok";
    }

    // 다음 사람이 바로 이어서 입력할 수 있도록 이름/선택을 초기화하고 잠금을 해제
    selected.clear();
    nameInput.value = "";
    renderSurveyCalendar();
    updateTotalHours(); // 잠금 해제 포함
  } catch (err) {
    statusEl.textContent = "제출 실패: " + err.message + " (config.js의 URL을 확인하세요)";
    statusEl.className = "status-msg err";
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("surveyRefreshBtn").addEventListener("click", async () => {
  await loadBookings();
  renderSurveyCalendar();
});

document.getElementById("clearSelectionBtn").addEventListener("click", () => {
  selected.clear();
  updateTotalHours(); // 잠금도 함께 해제됨
  renderSurveyCalendar();
  const statusEl = document.getElementById("statusMsg");
  statusEl.textContent = "선택이 초기화되었습니다. 이름을 다시 입력할 수 있습니다.";
  statusEl.className = "status-msg";
});

/* =========================================================
   대시보드 (전체 예약 현황 + 인원별 누적 시간)
   ========================================================= */
function renderDashboardSkeleton() {
  const grid = document.getElementById("heatmap");
  grid.innerHTML = "";
  grid.style.gridTemplateColumns = `64px repeat(${DAYS.length}, 1fr)`;
  grid.appendChild(el("div", "cal-head", ""));
  DAYS.forEach((d) => grid.appendChild(el("div", "cal-head", d.label)));
  ROWS.forEach((rowStart) => {
    grid.appendChild(el("div", "cal-time", rowStart));
    DAYS.forEach((d) => {
      const available = isAvailable(d, rowStart);
      const key = slotKey(d.date, rowStart);
      const owner = bookedMap[key];
      const cls = "cal-cell" + (!available ? " unavailable" : owner ? " taken" : "");
      const cell = el("div", cls, owner || "");
      cell.dataset.date = d.date;
      cell.dataset.time = rowStart;
      grid.appendChild(cell);
    });
  });
}

async function loadDashboard() {
  const data = await loadBookings();
  if (!data) return;
  renderDashboardSkeleton();

  const tbody = document.getElementById("peopleTableBody");
  tbody.innerHTML = "";
  const people = Object.entries(data.byPerson || {}).sort((a, b) => b[1] - a[1]);
  if (people.length === 0) {
    const tr = document.createElement("tr");
    tr.appendChild(el("td", "muted", "아직 제출된 응답이 없습니다."));
    tbody.appendChild(tr);
  } else {
    people.forEach(([name, hours]) => {
      const tr = document.createElement("tr");
      tr.appendChild(el("td", "", name));
      tr.appendChild(el("td", "", `${hours}시간`));
      tbody.appendChild(tr);
    });
  }

  document.getElementById("lastUpdated").textContent =
    "마지막 업데이트: " + new Date().toLocaleTimeString("ko-KR");
}

document.getElementById("refreshBtn").addEventListener("click", loadDashboard);

/* =========================================================
   탭 전환
   ========================================================= */
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "dashboard") loadDashboard();
  });
});

/* =========================================================
   초기화
   ========================================================= */
(async function init() {
  await loadBookings();
  renderSurveyCalendar();
  updateTotalHours();
})();
