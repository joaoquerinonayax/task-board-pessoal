// ============================================================
//  Power BI Requests — team portal (requester side)
// ============================================================
(function () {
  'use strict';

  // ---------- i18n ----------
  const STORE_LANG = 'tb_lang', STORE_THEME = 'tb_theme';
  let lang = 'en';
  const T = {
    en: {
      'p.title': 'Power BI Requests', 'p.brand': 'Power BI Requests',
      'p.loading': 'Loading…', 'p.signinTitle': 'Sign in', 'p.signinSub': 'Submit and track your Power BI requests',
      'p.email': 'E-mail', 'p.password': 'Password', 'p.signin': 'Sign in',
      'p.invite': '🔒 Access by invitation — ask the admin to add you.',
      'p.config': '⚠️ Supabase not configured. Edit config.js (see README.md).',
      'p.new': '+ New request', 'p.signout': '⎋ Sign out',
      'p.emptyTitle': 'No requests yet', 'p.emptyBody': 'Click “New request” to submit your first Power BI request.',
      'p.select': 'Select a request on the left, or create a new one.',
      'p.requested': 'Requested', 'p.report': 'Report / area', 'p.category': 'Category', 'p.priority': 'Priority', 'p.status': 'Status',
      'p.description': 'Description', 'p.comments': 'Comments', 'p.noComments': 'No comments yet.',
      'p.addComment': 'Write a comment…', 'p.send': 'Send', 'p.you': 'You', 'p.admin': 'Admin',
      'p.newTitle': 'New request', 'p.fTitle': 'Title', 'p.fTitlePh': 'Short summary of what you need',
      'p.fReportPh': 'e.g. Executive Overview, Revenue Ops…', 'p.fDescPh': 'Describe the change/addition. Markdown supported. Use - [ ] for sub-items.',
      'p.cancel': 'Cancel', 'p.submit': 'Submit request', 'p.reqTitleRequired': 'Please enter a title.',
      'err.invalid': 'Wrong e-mail or password.', 'err.unconfirmed': 'E-mail not confirmed yet.',
      'err.signupOff': 'No account for this e-mail. Ask the admin for access.', 'err.rate': 'Too many attempts. Wait a moment.', 'err.generic': 'Something went wrong. Try again.',
      'cat.Change': 'Change', 'cat.Addition': 'Addition', 'cat.Improvement': 'Improvement', 'cat.Bug': 'Bug', 'cat.Question': 'Question',
      'st.Open': 'Open', 'st.In progress': 'In progress', 'st.Waiting': 'Waiting on you', 'st.Done': 'Done', 'st.Rejected': 'Rejected',
      'pr.Low': 'Low', 'pr.Medium': 'Medium', 'pr.High': 'High', 'pr.Critical': 'Critical',
    },
    'pt-BR': {
      'p.title': 'Chamados Power BI', 'p.brand': 'Chamados Power BI',
      'p.loading': 'Carregando…', 'p.signinTitle': 'Entrar', 'p.signinSub': 'Abra e acompanhe seus chamados do Power BI',
      'p.email': 'E-mail', 'p.password': 'Senha', 'p.signin': 'Entrar',
      'p.invite': '🔒 Acesso por convite — peça ao admin para te adicionar.',
      'p.config': '⚠️ Supabase não configurado. Edite o config.js (veja o README.md).',
      'p.new': '+ Novo chamado', 'p.signout': '⎋ Sair',
      'p.emptyTitle': 'Nenhum chamado ainda', 'p.emptyBody': 'Clique em “Novo chamado” para abrir seu primeiro pedido.',
      'p.select': 'Selecione um chamado à esquerda, ou crie um novo.',
      'p.requested': 'Aberto em', 'p.report': 'Relatório / área', 'p.category': 'Categoria', 'p.priority': 'Prioridade', 'p.status': 'Status',
      'p.description': 'Descrição', 'p.comments': 'Comentários', 'p.noComments': 'Nenhum comentário ainda.',
      'p.addComment': 'Escreva um comentário…', 'p.send': 'Enviar', 'p.you': 'Você', 'p.admin': 'Admin',
      'p.newTitle': 'Novo chamado', 'p.fTitle': 'Título', 'p.fTitlePh': 'Resumo curto do que você precisa',
      'p.fReportPh': 'ex.: Executive Overview, Revenue Ops…', 'p.fDescPh': 'Descreva a mudança/inclusão. Aceita Markdown. Use - [ ] para subitens.',
      'p.cancel': 'Cancelar', 'p.submit': 'Enviar chamado', 'p.reqTitleRequired': 'Informe um título.',
      'err.invalid': 'E-mail ou senha incorretos.', 'err.unconfirmed': 'E-mail ainda não confirmado.',
      'err.signupOff': 'Não há conta para esse e-mail. Peça acesso ao admin.', 'err.rate': 'Muitas tentativas. Espere um momento.', 'err.generic': 'Algo deu errado. Tente de novo.',
      'cat.Change': 'Alteração', 'cat.Addition': 'Inclusão', 'cat.Improvement': 'Melhoria', 'cat.Bug': 'Bug', 'cat.Question': 'Dúvida',
      'st.Open': 'Aberto', 'st.In progress': 'Em andamento', 'st.Waiting': 'Aguardando você', 'st.Done': 'Concluído', 'st.Rejected': 'Recusado',
      'pr.Low': 'Baixa', 'pr.Medium': 'Média', 'pr.High': 'Alta', 'pr.Critical': 'Crítica',
    },
  };
  function tr(k) { const d = T[lang] || T.en; return d[k] != null ? d[k] : (T.en[k] != null ? T.en[k] : k); }
  function localeFor() { return lang === 'pt-BR' ? 'pt-BR' : 'en-US'; }
  const CATEGORIES = ['Change', 'Addition', 'Improvement', 'Bug', 'Question'];
  const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

  function loadLang() { const l = localStorage.getItem(STORE_LANG); lang = (l === 'pt-BR' || l === 'en') ? l : 'en'; }
  function setLang(l) { lang = (l === 'pt-BR') ? 'pt-BR' : 'en'; localStorage.setItem(STORE_LANG, lang); applyStatic(); render(); }
  function applyStatic() {
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = tr(el.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-setlang]').forEach(b => b.classList.toggle('active', b.getAttribute('data-setlang') === lang));
    document.documentElement.lang = lang;
    document.title = tr('p.title');
  }
  function applyTheme() {
    let th = localStorage.getItem(STORE_THEME);
    if (!th) th = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', th);
  }

  // ---------- utils ----------
  function escHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function sanitize(html) {
    const tmp = document.createElement('div'); tmp.innerHTML = html || '';
    tmp.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input').forEach(n => n.remove());
    tmp.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(a => {
        const n = a.name.toLowerCase();
        if (n.startsWith('on')) el.removeAttribute(a.name);
        else if ((n === 'href' || n === 'src') && /^\s*(javascript|data):/i.test(a.value)) el.removeAttribute(a.name);
      });
      if (el.tagName === 'A') { el.setAttribute('rel', 'noopener'); el.setAttribute('target', '_blank'); }
    });
    return tmp.innerHTML;
  }
  function renderMd(md) {
    if (!md || !md.trim()) return '';
    let h = null;
    if (window.marked && window.marked.parse) { try { h = window.marked.parse(md, { breaks: true, gfm: true }); } catch (e) { h = null; } }
    if (h == null) h = '<p>' + escHtml(md).replace(/\n/g, '<br>') + '</p>';
    return sanitize(h);
  }
  function fmtDate(iso) { try { return new Date(iso).toLocaleString(localeFor(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function fmtDay(iso) { try { return new Date(iso).toLocaleDateString(localeFor(), { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } }
  function statusBadge(st) { st = st || 'Open'; return '<span class="tk-badge st-' + st.replace(/\s+/g, '-') + '">' + escHtml(tr('st.' + st)) + '</span>'; }
  function catBadge(c) { c = c || 'Change'; return '<span class="tk-badge tk-cat">' + escHtml(tr('cat.' + c)) + '</span>'; }
  function prioBadge(p) { p = p || 'Medium'; return '<span class="tk-badge pr-' + p + '">' + escHtml(tr('pr.' + p)) + '</span>'; }

  // ---------- state ----------
  let sb = null, USER_ID = null, USER_EMAIL = '';
  let tickets = [], activeId = null, comments = [], rtChannel = null;

  // ---------- auth ----------
  function initSb() {
    const cfg = window.SUPABASE_CONFIG || {};
    const key = cfg.anonKey || cfg.publishableKey;
    if (!cfg.url || !key || /YOUR-/.test(cfg.url) || /YOUR-/.test(key)) return false;
    if (!window.supabase || !window.supabase.createClient) return false;
    sb = window.supabase.createClient(cfg.url, key, { auth: { persistSession: true, autoRefreshToken: true } });
    return true;
  }
  function showAuthErr(msg) { const el = document.getElementById('auth-error'); el.textContent = msg || ''; el.hidden = !msg; }
  function transErr(msg) {
    if (!msg) return tr('err.generic');
    if (/Invalid login credentials/i.test(msg)) return tr('err.invalid');
    if (/Email not confirmed/i.test(msg)) return tr('err.unconfirmed');
    if (/not allowed|signup|disabled/i.test(msg)) return tr('err.signupOff');
    if (/rate limit|too many/i.test(msg)) return tr('err.rate');
    return msg;
  }
  function showAuth(showForm) {
    document.getElementById('auth-screen').hidden = false;
    document.getElementById('portal-root').hidden = true;
    document.getElementById('auth-loading').hidden = !!showForm;
    document.getElementById('auth-form').hidden = !showForm;
  }

  async function onLogin(session) {
    USER_ID = session.user.id; USER_EMAIL = session.user.email || '';
    try { if (sb.realtime && session.access_token) sb.realtime.setAuth(session.access_token); } catch (e) {}
    document.getElementById('auth-screen').hidden = true;
    document.getElementById('portal-root').hidden = false;
    document.getElementById('p-email').textContent = USER_EMAIL;
    document.getElementById('p-account').textContent = (USER_EMAIL ? USER_EMAIL[0] : '?').toUpperCase();
    await loadTickets();
    if (!activeId && tickets.length) activeId = tickets[0].id;
    if (activeId) await loadComments(activeId);
    render();
    subscribeRealtime();
  }
  function onLogout() {
    if (rtChannel && sb) { sb.removeChannel(rtChannel); rtChannel = null; }
    USER_ID = null; USER_EMAIL = ''; tickets = []; comments = []; activeId = null;
    document.getElementById('auth-email').value = '';
    document.getElementById('auth-password').value = '';
    showAuth(true);
  }

  // ---------- data ----------
  async function loadTickets() {
    const r = await sb.from('tickets').select('*').order('created_at', { ascending: false });
    if (r.error) { console.error(r.error); return; }
    tickets = r.data || [];
  }
  async function loadComments(ticketId) {
    const r = await sb.from('ticket_comments').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true });
    if (r.error) { console.error(r.error); comments = []; return; }
    comments = r.data || [];
  }
  async function createTicket(data) {
    const row = { title: data.title, description: data.description, category: data.category, report: data.report, priority: data.priority, status: 'Open', requester_email: USER_EMAIL };
    const r = await sb.from('tickets').insert(row).select().single();
    if (r.error) { alert(r.error.message); return null; }
    return r.data;
  }
  async function addComment(ticketId, body) {
    const r = await sb.from('ticket_comments').insert({ ticket_id: ticketId, body: body, author_id: USER_ID, author_email: USER_EMAIL }).select().single();
    if (r.error) { alert(r.error.message); return null; }
    return r.data;
  }
  function subscribeRealtime() {
    if (rtChannel) { sb.removeChannel(rtChannel); rtChannel = null; }
    rtChannel = sb.channel('portal_' + USER_ID)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, async () => { await loadTickets(); if (activeId) await loadComments(activeId); render(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ticket_comments' }, async () => { if (activeId) { await loadComments(activeId); render(); } })
      .subscribe();
  }

  // ---------- render ----------
  function render() {
    renderList();
    renderDetail();
  }
  function renderList() {
    const el = document.getElementById('ticket-list');
    if (!tickets.length) {
      el.innerHTML = '<div class="tk-empty"><strong>' + escHtml(tr('p.emptyTitle')) + '</strong><p>' + escHtml(tr('p.emptyBody')) + '</p></div>';
      return;
    }
    el.innerHTML = tickets.map(t => `
      <button class="tk-item${t.id === activeId ? ' active' : ''}" data-tk="${escHtml(t.id)}">
        <div class="tk-item-top">${statusBadge(t.status)}<span class="tk-item-date">${escHtml(fmtDay(t.created_at))}</span></div>
        <div class="tk-item-title">${escHtml(t.title || '—')}</div>
        <div class="tk-item-meta">${catBadge(t.category)}${prioBadge(t.priority)}</div>
      </button>`).join('');
    el.querySelectorAll('[data-tk]').forEach(b => b.addEventListener('click', async () => {
      activeId = b.dataset.tk; await loadComments(activeId); render();
    }));
  }
  function renderDetail() {
    const el = document.getElementById('ticket-detail');
    const t = tickets.find(x => x.id === activeId);
    if (!t) { el.innerHTML = '<div class="tk-select">' + escHtml(tr('p.select')) + '</div>'; return; }
    const desc = renderMd(t.description) || '<em style="color:var(--text-light)">—</em>';
    const commentsHtml = comments.length
      ? comments.map(c => {
          const mine = c.author_id === USER_ID;
          const who = mine ? tr('p.you') : (c.author_email || tr('p.admin'));
          return `<div class="tk-comment${mine ? ' mine' : ''}">
              <div class="tk-comment-head"><span class="tk-comment-who">${escHtml(who)}</span><span class="tk-comment-date">${escHtml(fmtDate(c.created_at))}</span></div>
              <div class="tk-comment-body md-body">${renderMd(c.body)}</div>
            </div>`;
        }).join('')
      : '<div class="tk-nocomments">' + escHtml(tr('p.noComments')) + '</div>';

    el.innerHTML = `
      <div class="tk-detail-head">
        <h2 class="tk-detail-title">${escHtml(t.title || '—')}</h2>
        <div class="tk-detail-badges">${statusBadge(t.status)}${catBadge(t.category)}${prioBadge(t.priority)}</div>
      </div>
      <div class="tk-detail-meta">
        ${t.report ? `<span><b>${escHtml(tr('p.report'))}:</b> ${escHtml(t.report)}</span>` : ''}
        <span><b>${escHtml(tr('p.requested'))}:</b> ${escHtml(fmtDay(t.created_at))}</span>
      </div>
      <div class="tk-section-label">${escHtml(tr('p.description'))}</div>
      <div class="md-body tk-desc">${desc}</div>
      <div class="tk-section-label">${escHtml(tr('p.comments'))}</div>
      <div class="tk-comments">${commentsHtml}</div>
      <div class="tk-comment-form">
        <textarea id="tk-comment-input" rows="2" placeholder="${escHtml(tr('p.addComment'))}"></textarea>
        <button class="btn-primary" id="tk-comment-send">${escHtml(tr('p.send'))}</button>
      </div>`;
    const input = document.getElementById('tk-comment-input');
    const send = document.getElementById('tk-comment-send');
    async function submit() {
      const body = input.value.trim(); if (!body) return;
      send.disabled = true;
      const c = await addComment(t.id, body);
      send.disabled = false;
      if (c) { input.value = ''; await loadComments(t.id); render(); }
    }
    send.addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } });
  }

  // ---------- new request modal ----------
  function openNewRequest() {
    const catOpts = CATEGORIES.map(c => `<option value="${c}">${escHtml(tr('cat.' + c))}</option>`).join('');
    const prOpts = PRIORITIES.map(p => `<option value="${p}"${p === 'Medium' ? ' selected' : ''}>${escHtml(tr('pr.' + p))}</option>`).join('');
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal modal-lg" role="dialog" aria-modal="true">
        <h2>${escHtml(tr('p.newTitle'))}</h2>
        <form id="nr-form" autocomplete="off">
          <div class="field"><label>${escHtml(tr('p.fTitle'))}</label><input type="text" id="nr-title" required placeholder="${escHtml(tr('p.fTitlePh'))}"></div>
          <div class="settings-row" style="gap:10px">
            <div class="field" style="flex:1;margin:0"><label>${escHtml(tr('p.category'))}</label><select id="nr-cat">${catOpts}</select></div>
            <div class="field" style="flex:1;margin:0"><label>${escHtml(tr('p.priority'))}</label><select id="nr-pr">${prOpts}</select></div>
          </div>
          <div class="field"><label>${escHtml(tr('p.report'))}</label><input type="text" id="nr-report" placeholder="${escHtml(tr('p.fReportPh'))}"></div>
          <div class="field"><label>${escHtml(tr('p.description'))}</label><textarea id="nr-desc" rows="6" placeholder="${escHtml(tr('p.fDescPh'))}"></textarea></div>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" id="nr-cancel">${escHtml(tr('p.cancel'))}</button>
            <button type="submit" class="btn-primary">${escHtml(tr('p.submit'))}</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(backdrop);
    document.getElementById('nr-title').focus();
    function close() { if (backdrop.parentNode) document.body.removeChild(backdrop); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
    document.getElementById('nr-cancel').addEventListener('click', close);
    document.getElementById('nr-form').addEventListener('submit', async e => {
      e.preventDefault();
      const title = document.getElementById('nr-title').value.trim();
      if (!title) { alert(tr('p.reqTitleRequired')); return; }
      const data = { title, category: document.getElementById('nr-cat').value, priority: document.getElementById('nr-pr').value, report: document.getElementById('nr-report').value.trim(), description: document.getElementById('nr-desc').value.trim() };
      const created = await createTicket(data);
      if (created) { await loadTickets(); activeId = created.id; await loadComments(activeId); render(); close(); }
    });
  }

  // ---------- boot ----------
  function wire() {
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-setlang]'); if (b) { e.preventDefault(); setLang(b.getAttribute('data-setlang')); }
    });
    document.getElementById('auth-form').addEventListener('submit', async e => {
      e.preventDefault();
      const email = document.getElementById('auth-email').value.trim();
      const password = document.getElementById('auth-password').value;
      if (!email || !password) return;
      const btn = document.getElementById('auth-submit'); const label = btn.textContent;
      btn.disabled = true; btn.textContent = '…'; showAuthErr('');
      try { const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; }
      catch (err) { showAuthErr(transErr(err && err.message)); }
      finally { btn.disabled = false; btn.textContent = label; }
    });
    document.getElementById('new-req-btn').addEventListener('click', openNewRequest);
    const accBtn = document.getElementById('p-account'), accMenu = document.getElementById('p-account-menu');
    accBtn.addEventListener('click', e => { e.stopPropagation(); accMenu.hidden = !accMenu.hidden; });
    document.addEventListener('click', e => { if (!e.target.closest('#p-account-menu') && !e.target.closest('#p-account')) accMenu.hidden = true; });
    document.getElementById('p-signout').addEventListener('click', async () => { accMenu.hidden = true; try { await sb.auth.signOut(); } catch (e) {} });
  }

  async function boot() {
    loadLang(); applyTheme(); applyStatic();
    if (!initSb()) {
      document.getElementById('auth-loading').hidden = true;
      document.getElementById('auth-form').hidden = true;
      document.getElementById('auth-config-error').hidden = false;
      return;
    }
    wire();
    showAuth(false);
    try {
      const { data } = await sb.auth.getSession();
      if (data && data.session) await onLogin(data.session); else showAuth(true);
    } catch (e) { showAuth(true); }
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session && !USER_ID) onLogin(session);
      else if (event === 'SIGNED_OUT') onLogout();
    });
  }
  boot();
})();
