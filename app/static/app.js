import { api, setToken, getToken } from "./modules/api.js";
import {
  parseDate,
  formatFull,
  formatRelative,
  escapeHtml,
  initials,
  bytes,
  durationFromMs,
} from "./modules/format.js";
import { icons } from "./modules/icons.js";
import { toast } from "./modules/toast.js";
import { openSheet, confirm } from "./modules/dialog.js";
import { openDateTimePicker } from "./modules/datetime-picker.js";

/* ================================================================
   状态
   ================================================================ */
const TOKEN_KEY = "pair-events-token";

const state = {
  token: localStorage.getItem(TOKEN_KEY) || "",
  me: null,
  events: [],
  loadingList: false,
  loadingDetail: false,
};

setToken(state.token);

/* ================================================================
   DOM 引用
   ================================================================ */
const els = {
  loginScreen: document.querySelector("#loginScreen"),
  loginForm: document.querySelector("#loginForm"),
  loginToken: document.querySelector("#loginToken"),
  loginTokenToggle: document.querySelector("#loginTokenToggle"),
  loginAdminLinks: document.querySelectorAll("[data-admin-entry]"),

  appShell: document.querySelector("#appShell"),
  identityNames: document.querySelector("#identityNames"),
  identityPair: document.querySelector("#identityPair"),
  avatarMe: document.querySelector("#avatarMe"),
  avatarYou: document.querySelector("#avatarYou"),
  refreshBtn: document.querySelector("#refreshBtn"),
  adminEntryBtn: document.querySelector("#adminEntryBtn"),
  logoutBtn: document.querySelector("#logoutBtn"),

  listScreen: document.querySelector("#listScreen"),
  detailScreen: document.querySelector("#detailScreen"),
  eventsList: document.querySelector("#eventsList"),
  eventDetail: document.querySelector("#eventDetail"),
  detailBack: document.querySelector("#detailBack"),
  newEventFab: document.querySelector("#newEventFab"),

  adminScreen: document.querySelector("#adminScreen"),
  adminBackBtn: document.querySelector("#adminBackBtn"),
  pairForm: document.querySelector("#pairForm"),
  pairResult: document.querySelector("#pairResult"),
  loadPairsBtn: document.querySelector("#loadPairsBtn"),
  pairsList: document.querySelector("#pairsList"),
};

/* ================================================================
   工具
   ================================================================ */
function show(node) {
  if (!node) return;
  node.hidden = false;
}
function hide(node) {
  if (!node) return;
  node.hidden = true;
}

function setBusy(button, busyText) {
  if (!button) return () => {};
  const original = button.innerHTML;
  button.disabled = true;
  button.classList.add("btn-loading");
  button.textContent = busyText;
  return () => {
    button.disabled = false;
    button.classList.remove("btn-loading");
    button.innerHTML = original;
  };
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast("已复制");
    } catch {
      toast("复制失败，请手动选中", "error");
    }
    ta.remove();
  }
}

function whoLabel(authorId) {
  if (!state.me) return `成员 #${authorId}`;
  if (authorId === state.me.user.id) return state.me.user.display_name + "（你）";
  if (authorId === state.me.counterpart.id) return state.me.counterpart.display_name;
  return `成员 #${authorId}`;
}

function visibilityBadge(mode) {
  if (mode === "mutual_submit") {
    return `<span class="badge badge-quiet">${icons.lock}互相提交</span>`;
  }
  return `<span class="badge">${icons.globe}公开</span>`;
}

function unlockBadge(submission, mode) {
  if (submission.unlocked) {
    return `<span class="badge badge-success">${icons.unlock}已解锁</span>`;
  }
  if (mode === "mutual_submit") {
    if (submission.current_user_submitted && !submission.counterpart_submitted) {
      return `<span class="badge badge-warn">${icons.lock}等 TA 写下</span>`;
    }
    if (!submission.current_user_submitted && submission.counterpart_submitted) {
      return `<span class="badge badge-warn">${icons.lock}等你写下</span>`;
    }
    return `<span class="badge badge-quiet">${icons.lock}尚未开始</span>`;
  }
  return `<span class="badge badge-quiet">${icons.lock}尚未开始</span>`;
}

/* ================================================================
   路由（基于 hash）
   ================================================================ */
function parseHash() {
  const raw = location.hash.slice(1);
  if (!raw) return { name: "list" };
  if (raw === "admin") return { name: "admin" };
  if (raw.startsWith("token=")) {
    return { name: "token-import", token: decodeURIComponent(raw.slice(6)) };
  }
  const m = raw.match(/^event-(\d+)$/);
  if (m) return { name: "event", id: Number(m[1]) };
  return { name: "list" };
}

function navigate(hash) {
  if (location.hash === hash) {
    applyRoute();
  } else {
    location.hash = hash;
  }
}

async function applyRoute() {
  const route = parseHash();

  if (route.name === "token-import") {
    const token = route.token.trim();
    if (token) {
      try {
        await connectWithToken(token);
        toast("已自动登录");
      } catch (err) {
        toast(err.message, "error");
      }
    }
    history.replaceState(null, "", location.pathname + location.search);
    applyRoute();
    return;
  }

  if (route.name === "admin") {
    showAdminScreen();
    return;
  }

  if (!state.token || !state.me) {
    showLoginScreen();
    return;
  }

  if (route.name === "event") {
    showDetailScreen(route.id);
    return;
  }
  showListScreen();
}

/* ================================================================
   屏幕切换
   ================================================================ */
function showLoginScreen() {
  show(els.loginScreen);
  hide(els.appShell);
  hide(els.adminScreen);
  els.loginToken.value = state.token || "";
}

function showListScreen() {
  hide(els.loginScreen);
  show(els.appShell);
  hide(els.adminScreen);
  show(els.listScreen);
  hide(els.detailScreen);
}

function showDetailScreen(id) {
  hide(els.loginScreen);
  show(els.appShell);
  hide(els.adminScreen);
  hide(els.listScreen);
  show(els.detailScreen);
  loadDetail(id).catch((err) => {
    toast(err.message, "error");
    navigate("");
  });
}

function showAdminScreen() {
  hide(els.loginScreen);
  hide(els.appShell);
  show(els.adminScreen);
}

/* ================================================================
   登录 / 退出
   ================================================================ */
async function connectWithToken(token) {
  setToken(token);
  state.token = token;
  const me = await api.me();
  localStorage.setItem(TOKEN_KEY, token);
  state.me = me;
  applyIdentity();
  await loadEvents();
}

function applyIdentity() {
  if (!state.me) {
    els.identityNames.textContent = "未连接";
    els.identityPair.textContent = "—";
    els.avatarMe.textContent = "·";
    els.avatarYou.textContent = "·";
    return;
  }
  const me = state.me.user.display_name;
  const you = state.me.counterpart.display_name;
  els.identityNames.textContent = `${me} · ${you}`;
  els.identityPair.textContent = `Pair #${state.me.pair_id}`;
  els.avatarMe.textContent = initials(me);
  els.avatarYou.textContent = initials(you);
}

function clearSession() {
  state.token = "";
  state.me = null;
  state.events = [];
  setToken("");
  localStorage.removeItem(TOKEN_KEY);
  applyIdentity();
  navigate("");
}

/* ================================================================
   事件列表
   ================================================================ */
async function loadEvents() {
  state.loadingList = true;
  renderEventsList();
  try {
    const events = await api.listEvents();
    state.events = events;
  } finally {
    state.loadingList = false;
  }
  renderEventsList();
}

function renderEventsList() {
  if (state.loadingList) {
    els.eventsList.innerHTML = `
      <div class="skeleton">
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
      </div>
    `;
    return;
  }
  if (!state.events.length) {
    els.eventsList.innerHTML = `
      <div class="empty-state">
        还没有任何事件。点右下角的「记一笔」开始第一段记忆吧。
      </div>
    `;
    return;
  }
  els.eventsList.innerHTML = state.events
    .map((event) => {
      const dateLabel = formatRelative(event.occurred_at || event.created_at);
      const desc = event.description
        ? `<p class="event-card-desc">${escapeHtml(event.description)}</p>`
        : "";
      return `
        <article class="event-card" tabindex="0" role="button" data-event-id="${event.id}">
          <h3>${escapeHtml(event.title)}</h3>
          ${desc}
          <div class="event-card-meta">
            <span>${icons.calendar}<span>${escapeHtml(dateLabel)}</span></span>
            <span class="dot"></span>
            ${visibilityBadge(event.visibility_mode)}
            ${unlockBadge(event.submission_state, event.visibility_mode)}
          </div>
        </article>
      `;
    })
    .join("");
}

els.eventsList.addEventListener("click", (e) => {
  const card = e.target.closest("[data-event-id]");
  if (!card) return;
  navigate(`#event-${card.dataset.eventId}`);
});
els.eventsList.addEventListener("keydown", (e) => {
  const card = e.target.closest("[data-event-id]");
  if (!card) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    navigate(`#event-${card.dataset.eventId}`);
  }
});

/* ================================================================
   详情
   ================================================================ */
async function loadDetail(id) {
  state.loadingDetail = true;
  els.eventDetail.innerHTML = `
    <div class="skeleton">
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
    </div>
  `;
  let event;
  try {
    event = await api.getEvent(id);
  } finally {
    state.loadingDetail = false;
  }
  renderDetail(event);
}

function renderDetail(event) {
  const submission = event.submission_state;
  const contents = event.contents || { comments: [], voices: [], submission_state: submission };
  const canDelete = state.me && event.creator_id === state.me.user.id;

  const items = [
    ...contents.comments.map((c) => ({ ...c, _t: c.created_at })),
    ...contents.voices.map((v) => ({ ...v, _t: v.created_at })),
  ].sort((a, b) => new Date(a._t) - new Date(b._t));

  const lockedNote = !submission.unlocked
    ? `<div class="locked-note">
         此事件设为「双方提交后可见」。当前只显示你已经提交的内容；当 ${escapeHtml(
           state.me?.counterpart?.display_name || "对方"
         )} 也提交时，全部内容会一起解锁。
       </div>`
    : "";

  const itemsHtml = items.length
    ? `<div class="content-list">${items.map(renderContentItem).join("")}</div>`
    : `<div class="empty-state">还没有内容。先写一句话，或上传一段语音吧。</div>`;

  const occurred = event.occurred_at
    ? `<span><strong>发生于</strong> ${escapeHtml(formatFull(event.occurred_at))}</span>`
    : `<span><strong>发生时间</strong> 未填</span>`;

  els.eventDetail.innerHTML = `
    <header class="detail-header">
      <div class="detail-eyebrow">
        ${visibilityBadge(event.visibility_mode)}
        ${unlockBadge(submission, event.visibility_mode)}
      </div>
      <div class="detail-title-row">
        <h1 class="detail-title">${escapeHtml(event.title)}</h1>
        ${
          canDelete
            ? `<button class="icon-btn" type="button" data-act="delete" aria-label="删除事件">${icons.trash}</button>`
            : ""
        }
      </div>
      ${
        event.description
          ? `<p class="detail-description">${escapeHtml(event.description)}</p>`
          : ""
      }
      <div class="detail-meta">
        ${occurred}
        <span><strong>创建者</strong> ${escapeHtml(whoLabel(event.creator_id))}</span>
        <span><strong>建于</strong> ${escapeHtml(formatRelative(event.created_at))}</span>
      </div>
    </header>

    <div class="status-strip" aria-label="提交状态">
      <div class="status-cell">
        <span class="status-cell-label">你</span>
        <span class="status-cell-value ${submission.current_user_submitted ? "is-yes" : "is-no"}">
          ${submission.current_user_submitted ? "已写下" : "未写"}
        </span>
      </div>
      <div class="status-cell">
        <span class="status-cell-label">${escapeHtml(state.me?.counterpart?.display_name || "TA")}</span>
        <span class="status-cell-value ${submission.counterpart_submitted ? "is-yes" : "is-no"}">
          ${submission.counterpart_submitted ? "已写下" : "未写"}
        </span>
      </div>
      <div class="status-cell">
        <span class="status-cell-label">解锁</span>
        <span class="status-cell-value ${submission.unlocked ? "is-yes" : "is-no"}">
          ${submission.unlocked ? "已解锁" : "未解锁"}
        </span>
      </div>
    </div>

    <p class="section-label">写一笔</p>
    ${composerHtml()}

    <p class="section-label">记忆</p>
    ${lockedNote}
    ${itemsHtml}
  `;

  bindDetailEvents(event);
}

function composerHtml() {
  return `
    <section class="composer">
      <div class="composer-tabs" role="tablist">
        <button type="button" class="composer-tab is-active" role="tab" aria-selected="true" data-tab="text">${icons.comment}<span>文字</span></button>
        <button type="button" class="composer-tab" role="tab" aria-selected="false" data-tab="voice">${icons.mic}<span>语音</span></button>
      </div>
      <form class="composer-pane is-active" data-pane="text">
        <textarea data-field="comment" rows="3" maxlength="2000" placeholder="写下此刻的感受、想说的话…" spellcheck="true"></textarea>
        <button type="submit" class="btn btn-primary btn-block">${icons.send}<span>提交文字</span></button>
      </form>
      <form class="composer-pane" data-pane="voice">
        <label class="file-drop">
          <input type="file" accept="audio/*" data-field="voice" />
          <span class="file-drop-mark">${icons.mic}</span>
          <span class="file-drop-text">
            <strong data-file-name>选择音频文件</strong>
            <span data-file-hint>支持常见音频格式</span>
          </span>
        </label>
        <button type="submit" class="btn btn-primary btn-block">${icons.upload}<span>上传语音</span></button>
      </form>
    </section>
  `;
}

function bindDetailEvents(event) {
  const root = els.eventDetail;

  root.querySelector('[data-act="delete"]')?.addEventListener("click", () => onDeleteEvent(event));

  // tab 切换
  root.querySelectorAll(".composer-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      root.querySelectorAll(".composer-tab").forEach((t) => {
        const active = t === tab;
        t.classList.toggle("is-active", active);
        t.setAttribute("aria-selected", String(active));
      });
      root.querySelectorAll(".composer-pane").forEach((p) => {
        p.classList.toggle("is-active", p.dataset.pane === target);
      });
    });
  });

  // 文字提交
  const textForm = root.querySelector('[data-pane="text"]');
  textForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const field = textForm.querySelector('[data-field="comment"]');
    const text = field.value.trim();
    if (!text) {
      toast("写点什么吧", "error");
      return;
    }
    const done = setBusy(textForm.querySelector('button[type="submit"]'), "发送中…");
    try {
      await api.postComment(event.id, text);
      field.value = "";
      await loadDetail(event.id);
      await loadEvents();
      toast("已记下");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      done();
    }
  });

  // 文件名预览
  const voiceForm = root.querySelector('[data-pane="voice"]');
  const voiceInput = voiceForm.querySelector('[data-field="voice"]');
  const fileNameEl = voiceForm.querySelector("[data-file-name]");
  const fileHintEl = voiceForm.querySelector("[data-file-hint]");
  voiceInput.addEventListener("change", () => {
    const file = voiceInput.files?.[0];
    if (file) {
      voiceForm.querySelector(".file-drop").classList.add("has-file");
      fileNameEl.textContent = file.name;
      fileHintEl.textContent = bytes(file.size);
    } else {
      voiceForm.querySelector(".file-drop").classList.remove("has-file");
      fileNameEl.textContent = "选择音频文件";
      fileHintEl.textContent = "支持常见音频格式";
    }
  });

  voiceForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = voiceInput.files?.[0];
    if (!file) {
      toast("先选择一个音频文件", "error");
      return;
    }
    const done = setBusy(voiceForm.querySelector('button[type="submit"]'), "上传中…");
    try {
      await api.uploadVoice(event.id, file, null);
      voiceInput.value = "";
      voiceInput.dispatchEvent(new Event("change"));
      await loadDetail(event.id);
      await loadEvents();
      toast("语音已上传");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      done();
    }
  });

  // 语音播放按钮
  root.querySelectorAll("[data-load-voice]").forEach((btn) => {
    btn.addEventListener("click", () => loadVoice(btn));
  });
}

function renderContentItem(item) {
  const isSelf = state.me && item.author_id === state.me.user.id;
  const author = whoLabel(item.author_id);
  const time = formatRelative(item.created_at);

  if (item.type === "comment") {
    return `
      <article class="content-item ${isSelf ? "is-self" : ""}">
        <div class="content-author">
          <span class="who">${escapeHtml(author)}</span>
          <span class="dot"></span>
          <span>${escapeHtml(time)}</span>
        </div>
        <p class="content-text">${escapeHtml(item.text)}</p>
      </article>
    `;
  }

  // voice
  const dur = durationFromMs(item.duration_ms) || "";
  const sz = bytes(item.size_bytes);
  return `
    <article class="content-item ${isSelf ? "is-self" : ""}" data-voice-item="${item.id}">
      <div class="content-author">
        ${icons.mic}<span class="who">${escapeHtml(author)}</span>
        <span class="dot"></span>
        <span>${escapeHtml(time)}</span>
      </div>
      <div class="voice-row" data-voice-slot="${item.id}">
        <button type="button" class="voice-load-btn" data-load-voice="${item.id}">
          ${icons.mic}<span>播放语音</span>
        </button>
      </div>
      <div class="content-meta">
        ${dur ? `<span>${escapeHtml(dur)}</span>` : ""}
        ${sz ? `<span>${escapeHtml(sz)}</span>` : ""}
      </div>
    </article>
  `;
}

async function loadVoice(button) {
  const id = button.dataset.loadVoice;
  const slot = els.eventDetail.querySelector(`[data-voice-slot="${id}"]`);
  if (!slot) return;
  const done = setBusy(button, "加载中…");
  try {
    const blob = await api.voiceFile(id);
    const url = URL.createObjectURL(blob);
    slot.innerHTML = `<audio controls autoplay src="${url}"></audio>`;
  } catch (err) {
    toast(err.message, "error");
    done();
  }
}

async function onDeleteEvent(event) {
  const ok = await confirm({
    title: "删除这条记忆？",
    message: "这是不可恢复的操作，事件下的所有评论与语音都会一起被删除。",
    confirmText: "删除",
    cancelText: "取消",
    danger: true,
  });
  if (!ok) return;
  try {
    await api.deleteEvent(event.id);
    toast("已删除");
    state.events = state.events.filter((e) => e.id !== event.id);
    navigate("");
    await loadEvents();
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ================================================================
   新建事件
   ================================================================ */
function openNewEventSheet() {
  if (!state.me) {
    toast("请先登录", "error");
    return;
  }

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn btn-quiet";
  cancel.textContent = "取消";
  cancel.dataset.noAutofocus = "true";

  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "btn btn-primary";
  submit.textContent = "创建";

  let occurredAt = null;

  openSheet({
    title: "记一笔新事件",
    footer: [cancel, submit],
    render: ({ body, close }) => {
      body.innerHTML = `
        <form class="form-stack" id="newEventForm" novalidate>
          <div class="form-stack compact">
            <label class="field-label" for="newEventTitle">标题<span aria-hidden="true" style="color:var(--rose)"> *</span></label>
            <input id="newEventTitle" name="title" type="text" maxlength="200" required placeholder="例如：第一次一起看的展" autocomplete="off" />
          </div>

          <div class="form-stack compact">
            <label class="field-label" for="newEventDesc">描述</label>
            <textarea id="newEventDesc" name="description" rows="4" maxlength="4000" placeholder="背景、想保留的细节、心情…" spellcheck="true"></textarea>
          </div>

          <div class="form-stack compact">
            <label class="field-label">发生时间</label>
            <button type="button" class="dt-trigger is-empty" data-act="pick-time">
              <span class="dt-trigger-text">未填（点击选择）</span>
              ${icons.calendar}
            </button>
            <input type="hidden" name="occurred_at" />
          </div>

          <div class="form-stack compact">
            <label class="field-label">可见方式</label>
            <fieldset class="segmented">
              <label>
                <input type="radio" name="visibility_mode" value="public" checked />
                <span class="seg-title">${icons.globe}<span>公开</span></span>
                <span class="seg-desc">任意一方提交后双方立即可见</span>
              </label>
              <label>
                <input type="radio" name="visibility_mode" value="mutual_submit" />
                <span class="seg-title">${icons.lock}<span>双方提交后</span></span>
                <span class="seg-desc">两个人都写下后才互相揭晓</span>
              </label>
            </fieldset>
          </div>
        </form>
      `;

      const trigger = body.querySelector('[data-act="pick-time"]');
      const triggerText = trigger.querySelector(".dt-trigger-text");
      const hidden = body.querySelector('input[name="occurred_at"]');

      trigger.addEventListener("click", () => {
        openDateTimePicker({
          value: occurredAt,
          onConfirm: (d) => {
            occurredAt = d;
            if (d) {
              triggerText.textContent = formatFull(d);
              trigger.classList.remove("is-empty");
              hidden.value = d.toISOString();
            } else {
              triggerText.textContent = "未填（点击选择）";
              trigger.classList.add("is-empty");
              hidden.value = "";
            }
          },
        });
      });

      cancel.addEventListener("click", () => close());
      submit.addEventListener("click", async () => {
        const form = body.querySelector("#newEventForm");
        const fd = new FormData(form);
        const title = String(fd.get("title") || "").trim();
        const description = String(fd.get("description") || "").trim();
        const visibility_mode = String(fd.get("visibility_mode") || "public");

        if (!title) {
          toast("请填写标题", "error");
          form.querySelector('[name="title"]').focus();
          return;
        }

        const done = setBusy(submit, "创建中…");
        try {
          const created = await api.createEvent({
            title,
            description: description || null,
            occurred_at: occurredAt ? occurredAt.toISOString() : null,
            visibility_mode,
          });
          await loadEvents();
          toast("已创建");
          close();
          navigate(`#event-${created.id}`);
        } catch (err) {
          toast(err.message, "error");
        } finally {
          done();
        }
      });
    },
  });
}

/* ================================================================
   管理：配对
   ================================================================ */
function buildEntryLink(token) {
  const origin = `${location.protocol}//${location.host}`;
  return `${origin}/#token=${encodeURIComponent(token)}`;
}

function tokenBlock(label, token) {
  const safeLabel = escapeHtml(label);
  const safeToken = escapeHtml(token);
  const entry = buildEntryLink(token);
  return `
    <div class="token-block">
      <div class="token-label">
        <span>${safeLabel}</span>
        <div style="display:flex;gap:6px;">
          <button type="button" class="copy-btn" data-copy="${escapeHtml(token)}" title="复制 token">${icons.copy}<span>token</span></button>
          <button type="button" class="copy-btn" data-copy="${escapeHtml(entry)}" title="复制入口链接">${icons.link}<span>入口</span></button>
        </div>
      </div>
      <code class="token-code">${safeToken}</code>
    </div>
  `;
}

function bindCopyButtons(container) {
  container.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => copy(btn.dataset.copy || ""));
  });
}

async function onCreatePair(e) {
  e.preventDefault();
  const adminKey = document.querySelector("#adminKeyInput").value.trim();
  const userA = document.querySelector("#userAName").value.trim();
  const userB = document.querySelector("#userBName").value.trim();
  if (!adminKey || !userA || !userB) {
    toast("把表单填完整再生成吧", "error");
    return;
  }
  const submit = e.submitter || els.pairForm.querySelector('button[type="submit"]');
  const done = setBusy(submit, "生成中…");
  try {
    const data = await api.createPair(adminKey, userA, userB);
    els.pairResult.hidden = false;
    els.pairResult.innerHTML = `
      <h4>新配对 · Pair #${data.pair_id}</h4>
      <p style="margin:0;color:var(--brown-2);font-size:13.5px;">
        把每个人的 token 或入口链接发给对应的人即可。
      </p>
      ${tokenBlock(`${data.user_a.display_name} 的 token`, data.user_a_token)}
      ${tokenBlock(`${data.user_b.display_name} 的 token`, data.user_b_token)}
    `;
    bindCopyButtons(els.pairResult);
    await loadPairs(adminKey).catch(() => {});
    toast("配对已创建");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    done();
  }
}

async function loadPairs(adminKey) {
  const key = (adminKey || document.querySelector("#adminKeyInput").value).trim();
  if (!key) {
    toast("请先填写 Admin Key", "error");
    return;
  }
  const pairs = await api.listPairs(key);
  renderPairs(pairs);
}

function renderPairs(pairs) {
  if (!pairs.length) {
    els.pairsList.innerHTML = '<div class="empty-state">数据库里还没有任何配对。</div>';
    return;
  }
  els.pairsList.innerHTML = pairs
    .map((p) => {
      return `
        <article class="pair-card">
          <div class="pair-card-head">
            <div>
              <p class="card-eyebrow">Pair #${p.pair_id}</p>
              <h4>${escapeHtml(p.user_a.display_name)} <span style="color:var(--brown-3);font-weight:400;">·</span> ${escapeHtml(p.user_b.display_name)}</h4>
              <p style="margin:4px 0 0;color:var(--brown-3);font-size:12.5px;">建于 ${escapeHtml(formatFull(p.created_at))}</p>
            </div>
            <span class="badge badge-quiet">2 人</span>
          </div>
          <div class="pair-card-tokens">
            ${tokenBlock(p.user_a.display_name, p.user_a_token)}
            ${tokenBlock(p.user_b.display_name, p.user_b_token)}
          </div>
        </article>
      `;
    })
    .join("");
  bindCopyButtons(els.pairsList);
}

/* ================================================================
   事件绑定
   ================================================================ */
els.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const token = els.loginToken.value.trim();
  if (!token) {
    toast("先粘贴你的邀请 token", "error");
    return;
  }
  const submitBtn = els.loginForm.querySelector('button[type="submit"]');
  const done = setBusy(submitBtn, "进入中…");
  try {
    await connectWithToken(token);
    toast("欢迎回来");
    navigate("");
  } catch (err) {
    setToken("");
    state.token = "";
    state.me = null;
    localStorage.removeItem(TOKEN_KEY);
    toast(err.message || "无法登录", "error");
  } finally {
    done();
  }
});

els.loginTokenToggle.addEventListener("click", () => {
  const input = els.loginToken;
  const isPwd = input.type === "password";
  input.type = isPwd ? "text" : "password";
  els.loginTokenToggle.setAttribute("aria-label", isPwd ? "隐藏 token" : "显示 token");
  els.loginTokenToggle.querySelector(".icon-eye-open").hidden = isPwd;
  els.loginTokenToggle.querySelector(".icon-eye-closed").hidden = !isPwd;
});

els.loginAdminLinks.forEach((b) => b.addEventListener("click", () => navigate("#admin")));

els.refreshBtn.addEventListener("click", async () => {
  if (!state.me) return;
  const done = setBusy(els.refreshBtn, "");
  try {
    await loadEvents();
    if (parseHash().name === "event") await loadDetail(parseHash().id);
    toast("已刷新");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    done();
  }
});

els.adminEntryBtn.addEventListener("click", () => navigate("#admin"));

els.logoutBtn.addEventListener("click", async () => {
  const ok = await confirm({
    title: "退出当前账号？",
    message: "下次需要重新输入 token 才能进入。",
    confirmText: "退出",
    cancelText: "保留",
    danger: false,
  });
  if (!ok) return;
  clearSession();
  toast("已退出");
});

els.adminBackBtn.addEventListener("click", () => navigate(""));

els.detailBack.addEventListener("click", () => {
  if (history.length > 1) history.back();
  else navigate("");
});

els.newEventFab.addEventListener("click", openNewEventSheet);

els.pairForm.addEventListener("submit", onCreatePair);

els.loadPairsBtn.addEventListener("click", async () => {
  const done = setBusy(els.loadPairsBtn, "加载中…");
  try {
    await loadPairs();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    done();
  }
});

window.addEventListener("hashchange", () => applyRoute());

/* ================================================================
   启动
   ================================================================ */
(async function bootstrap() {
  // 初始 hash 可能是 #token=...，applyRoute 内部会处理
  if (state.token) {
    try {
      const me = await api.me();
      state.me = me;
      applyIdentity();
      await loadEvents().catch((err) => {
        toast(err.message, "error");
      });
    } catch (err) {
      // token 失效
      state.token = "";
      state.me = null;
      setToken("");
      localStorage.removeItem(TOKEN_KEY);
      toast("身份已失效，请重新登录", "error");
    }
  }
  applyRoute();
})();
