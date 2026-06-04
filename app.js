// ============================================================
//  Storage keys
// ============================================================
// UI preferences kept in localStorage (not sensitive)
const STORE_VIEW    = 'tb_view';
const STORE_GROUPBY = 'tb_groupby';
// Per-user task data is cached under namespaced keys: tb_<uid>_tasks etc.

// ============================================================
//  State
// ============================================================
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const PRIO_RANK  = { Critical: 0, High: 1, Medium: 2, Low: 3 };

let tasks = [];
let columns = [];
let groups = [];
let currentView = 'kanban';
let groupBy = false;
let sideSelectedPrio = 'Medium';
let modalSelectedPrio = 'Medium';
let modalSelectedColor = '#6161ff';
let modalSubtasks = [];          // working copy during modal session
let editingTaskId = null;
let editingColId  = null;
let editingGroupId = null;

// Drag state
let dragKind = null;             // 'card' | 'column' | null

// Supabase / cloud sync state
let sb = null;                   // Supabase client
let USER_ID = null;
let USER_EMAIL = '';
let syncStatus = 'idle';         // 'idle'|'saving'|'synced'|'error'
let saveTimer = null;
let pullTimer = null;
let pendingSave = false;
let lastPushAt = 0;
let rtChannel = null;
const dirty = { tasks: false, columns: false, groups: false, notes: false, presentations: false, prefs: false };
let seenCols = new Set();
let seenGroups = new Set();
let dragIndicator = null;        // card drop placeholder
let dragTarget = { colId: null, beforeCardId: null };
let columnDragId = null;         // id of column being dragged
// Notes
let notes = [];
let activeNoteId = null;
let notesGraph = false;
let noteCaret = null;
const GRAPH_COLORS = ['#6161ff', '#1a8cff', '#00a65a', '#e08a00', '#e0466e', '#9b5de5', '#00b8a9'];
let graphNodeSize = (function(){ const v = parseFloat(localStorage.getItem('tb_graph_size')); return (v >= 0.5 && v <= 2.5) ? v : 1; })();
let graphNodeColor = localStorage.getItem('tb_graph_color') || '#6161ff';
let graphZoom = 1, graphPanX = 0, graphPanY = 0;
let notesSearch = '';
let notesSort = (function(){ const v = localStorage.getItem('tb_notes_sort'); return ['manual', 'title', 'newest', 'oldest'].indexOf(v) >= 0 ? v : 'manual'; })();
let notesDragId = null;
let anConfig = (function(){ try { const o = JSON.parse(localStorage.getItem('tb_an_config') || '{}'); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } })();
let anConfigOpen = false;
function anOn(k) { return anConfig[k] !== false; }
function saveAnConfig() { try { localStorage.setItem('tb_an_config', JSON.stringify(anConfig)); } catch (e) {} markPrefsDirty(); }
function saveGraphPrefs() { try { localStorage.setItem('tb_graph_size', String(graphNodeSize)); localStorage.setItem('tb_graph_color', graphNodeColor); } catch (e) {} markPrefsDirty(); }
let graphRaf = 0;
let graphSelectedId = null;
let graphNodeOverrides = (function(){ try { const o = JSON.parse(localStorage.getItem('tb_graph_nodes') || '{}'); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } })();
let graphPositions = (function(){ try { const o = JSON.parse(localStorage.getItem('tb_graph_pos') || '{}'); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } })();
let notesTableMissing = false;
let presentations = [];
let activeDeckId = null;
let decksTableMissing = false;
let decksOmitTags = false;
let deckSearch = '';
let deckSort = (function(){ const v = localStorage.getItem('tb_deck_sort'); return (v === 'old' || v === 'az') ? v : 'new'; })();
// Tickets (admin)
let USER_ROLE = 'requester';
let tickets = [];
let ticketComments = [];
let ticketsRtChannel = null;
let ticketFilter = 'all';
// Notes editor prefs
let noteMode = (function(){ const m = localStorage.getItem('tb_note_mode'); return (m === 'md' || m === 'rich') ? m : 'split'; })();
let noteFocus = localStorage.getItem('tb_note_focus') === '1';
let tasksOmitCompleted = false;
let avatarUrl = '';
let sidebarHidden = localStorage.getItem('tb_sidebar_hidden') === '1';
let hiddenCols = new Set((function(){ try { return JSON.parse(localStorage.getItem('tb_hidden_cols') || '[]'); } catch (e) { return []; } })());
let _td = null;
function getTurndown() {
  if (_td) return _td;
  if (window.TurndownService) { try { _td = new window.TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*' }); if (_td.keep) _td.keep(['span', 'font', 'u', 'mark']); if (window.turndownPluginGfm && _td.use) _td.use(window.turndownPluginGfm.gfm); if (_td.addRule) _td.addRule('notelink', { filter: function(node){ return node.nodeName === 'A' && node.getAttribute && node.getAttribute('data-note-link'); }, replacement: function(content, node){ const t = node.getAttribute('data-note-link'); const lbl = (content || '').trim(); return '[[' + t + (lbl && lbl !== t ? '|' + lbl : '') + ']]'; } }); if (_td.addRule) _td.addRule('tableCellBr', { filter: function(node){ return node.nodeName === 'BR' && node.parentNode && (node.parentNode.nodeName === 'TD' || node.parentNode.nodeName === 'TH'); }, replacement: function(){ return ' '; } }); } catch (e) { _td = null; } }
  return _td;
}
function saveNotePrefs() { try { localStorage.setItem('tb_note_mode', noteMode); localStorage.setItem('tb_note_focus', noteFocus ? '1' : '0'); } catch (e) {} markPrefsDirty(); }

let filters = {
  priorities: new Set(PRIORITIES),
  cols: new Set(),
  groups: new Set(),
  deadline: 'all',
};

const PALETTE = [
  '#1a8cff', '#e08a00', '#00a65a', '#e2445c',
  '#6161ff', '#ff6b9d', '#00bcd4', '#9c27b0',
  '#607d8b', '#34495e', '#16a085', '#d35400'
];

// ============================================================
//  i18n  (English by default, Portuguese optional)
// ============================================================
const STORE_LANG = 'tb_lang';
let lang = 'en';
const I18N = {
  en: {
    'app.title':'João Querino Task Board',
    'auth.welcome':'Welcome back','auth.welcomeSub':'Sign in to access your board',
    'auth.createTitle':'Create your account','auth.createSub':'Fill in to create your access',
    'auth.email':'E-mail','auth.password':'Password','auth.signin':'Sign in','auth.create':'Create account',
    'auth.toSignin':'I already have an account — sign in','auth.toCreate':'Create account',
    'auth.noAccount':"Don't have an account?",'auth.loading':'Loading…',
    'auth.restricted':'🔒 Restricted access — ask the administrator for access.',
    'auth.configError':'⚠️ Supabase not configured. Edit config.js with your project URL and key (see README.md).',
    'auth.featKanban':'Kanban','auth.featCalendar':'Calendar','auth.featRealtime':'Real-time',
    'auth.created':'Account created! Confirm via e-mail OR disable "Confirm email" in Supabase, then sign in.',
    'auth.errInvalid':'Wrong e-mail or password.','auth.errExists':'This e-mail already has an account. Sign in.',
    'auth.errWeak':'Password must be at least 6 characters.','auth.errUnconfirmed':'E-mail not confirmed. Use the link or disable confirmation in Supabase.',
    'auth.errSignupOff':'Sign-ups are disabled. Ask the administrator for access.','auth.errRate':'Too many attempts. Wait a moment and try again.','auth.errGeneric':'Something went wrong. Try again.',
    'tb.export':'Export','tb.exportJson':'Export as JSON','tb.exportCsv':'Export as CSV','tb.import':'Import JSON',
    'tb.addTask':'Add Task','tb.theme':'Toggle light/dark theme','tb.sync':'Sync status','tb.account':'Account','tb.menu':'Menu',
    'acct.sync':'Sync now','acct.signout':'Sign out','acct.language':'Language',
    'view.kanban':'Kanban','view.table':'Table','view.cards':'Cards','view.calendar':'Calendar','view.notes':'Notes',
    'sb.search':'Search tasks...','sb.sortBy':'Sort by','sb.filter':'Filter','sb.group':'Group','sb.groupTitle':'Group tasks',
    'sort.manual':'Manual','sort.created':'Newest','sort.deadline':'Deadline','sort.priority':'Priority','sort.title':'Title (A–Z)',
    'side.addTask':'Add Task','side.taskName':'Task name','side.desc':'Description','side.priority':'Priority','side.deadline':'Deadline','side.column':'Column','side.addToBoard':'Add to Board','side.overview':'Overview','side.addColumn':'Add column','side.groups':'Groups','side.addGroup':'Add group',
    'prio.Critical':'Critical','prio.High':'High','prio.Medium':'Medium','prio.Low':'Low',
    'col.empty':'No tasks here','col.addTask':'Add task','col.edit':'Edit column',
    'card.moveLeft':'Move left','card.moveRight':'Move right','card.edit':'Edit','card.delete':'Delete',
    'empty.noMatch':'No tasks match your filters.','groups.empty':'No groups yet.','group.edit':'Edit group','group.none':'No group',
    'dl.today':'Today','dl.tomorrow':'Tomorrow',
    'th.task':'Task','th.priority':'Priority','th.deadline':'Deadline','th.status':'Status','th.added':'Added',
    'cal.prev':'Previous month','cal.next':'Next month','cal.today':'Today','cal.noDeadline':'without deadline',
    'm.newTask':'New task','m.editTask':'Edit task','m.taskName':'Task name','m.desc':'Description','m.priority':'Priority','m.deadline':'Deadline','m.column':'Column','m.group':'Group','m.noGroup':'— No group —','m.subtasks':'Subtasks','m.addSubtask':'Add subtask','m.noSubtasks':'No subtasks yet.','m.subPlaceholder':'Subtask...','m.cancel':'Cancel','m.save':'Save','m.remove':'Remove','m.of':'of','m.done':'done',
    'c.newCol':'New column','c.editCol':'Edit column','c.name':'Name','c.color':'Color','c.delete':'Delete column','c.cantDeleteLast':"You can't delete the last remaining column.",
    'c.confirmDel':'Delete "{name}"?','c.confirmDelMove':'Delete "{name}"?\n\n{n} task(s) will be moved to "{other}".',
    'g.newGroup':'New group','g.editGroup':'Edit group','g.delete':'Delete group','g.confirmDel':'Delete group "{name}"?','g.confirmDelTasks':'\n\n{n} task(s) will become ungrouped.',
    'f.priority':'Priority','f.status':'Status','f.group':'Group','f.deadline':'Deadline','f.any':'Any','f.overdue':'Overdue','f.next7':'Due in next 7 days','f.later':'Due later','f.none':'No deadline','f.noGroup':'No group','f.clear':'Clear filters','f.done':'Done',
    'rt.bold':'Bold (Ctrl+B)','rt.italic':'Italic (Ctrl+I)','rt.underline':'Underline','rt.h1':'Heading','rt.h2':'Subheading','rt.ul':'List','rt.ol':'Numbered list','rt.red':'Red','rt.orange':'Orange','rt.green':'Green','rt.blue':'Blue','rt.purple':'Purple','rt.link':'Insert link','rt.clear':'Clear formatting','rt.linkPrompt':'Link URL:','rt.placeholder':'Add a detailed description… (supports # heading, - list, **bold**)',
    'sync.idle':'Offline — changes saved on this device only','sync.saving':'Saving…','sync.synced':'All synced','sync.error':'Sync error — we will retry',
    'confirm.delTask':'Delete "{name}"?','confirm.signout':'Sign out? Your data stays saved in Supabase.',
    'import.invalid':'Invalid JSON file — "tasks" field not found.','import.confirm':'Import {n} tasks? This replaces your current data.','import.error':'Error reading file: ',
    'notes.new':'New note','notes.empty':'No notes yet.','notes.untitled':'Untitled note','notes.titlePh':'Note title','notes.contentPh':'Write in Markdown…','notes.delete':'Delete note','notes.gen':'Generate tasks','notes.select':'Select a note or create a new one.','notes.deleteConfirm':'Delete this note?','notes.tableMissing':'⚠ One-time setup needed: run supabase/notes.sql in your Supabase SQL Editor to sync notes to the cloud. (Notes are cached locally meanwhile.)',
    'gen.title':'Generate tasks from note','gen.none':'No list items found. Use "- item" bullets or "- [ ] item" checkboxes in your note.','gen.column':'Target column','gen.cancel':'Cancel','gen.create':'Create tasks',
  },
  'pt-BR': {
    'app.title':'João Querino Task Board',
    'auth.welcome':'Bem-vindo de volta','auth.welcomeSub':'Entre para acessar seu quadro',
    'auth.createTitle':'Criar sua conta','auth.createSub':'Preencha para criar seu acesso',
    'auth.email':'E-mail','auth.password':'Senha','auth.signin':'Entrar','auth.create':'Criar conta',
    'auth.toSignin':'Já tenho conta — entrar','auth.toCreate':'Criar conta',
    'auth.noAccount':'Não tem conta?','auth.loading':'Carregando…',
    'auth.restricted':'🔒 Acesso restrito — peça acesso ao administrador.',
    'auth.configError':'⚠️ Supabase não configurado. Edite o config.js com a URL e a key do projeto (veja o README.md).',
    'auth.featKanban':'Kanban','auth.featCalendar':'Calendário','auth.featRealtime':'Tempo real',
    'auth.created':'Conta criada! Confirme pelo e-mail OU desative "Confirm email" no Supabase e entre.',
    'auth.errInvalid':'E-mail ou senha incorretos.','auth.errExists':'Esse e-mail já tem conta. Faça login.',
    'auth.errWeak':'A senha precisa de pelo menos 6 caracteres.','auth.errUnconfirmed':'E-mail não confirmado. Use o link ou desative a confirmação no Supabase.',
    'auth.errSignupOff':'Cadastros estão desativados. Peça acesso ao administrador.','auth.errRate':'Muitas tentativas. Espere um momento e tente de novo.','auth.errGeneric':'Algo deu errado. Tente de novo.',
    'tb.export':'Exportar','tb.exportJson':'Exportar como JSON','tb.exportCsv':'Exportar como CSV','tb.import':'Importar JSON',
    'tb.addTask':'Nova tarefa','tb.theme':'Alternar tema claro/escuro','tb.sync':'Status de sincronização','tb.account':'Conta','tb.menu':'Menu',
    'acct.sync':'Sincronizar agora','acct.signout':'Sair','acct.language':'Idioma',
    'view.kanban':'Kanban','view.table':'Tabela','view.cards':'Cartões','view.calendar':'Calendário','view.notes':'Notas',
    'sb.search':'Buscar tarefas...','sb.sortBy':'Ordenar por','sb.filter':'Filtrar','sb.group':'Agrupar','sb.groupTitle':'Agrupar tarefas',
    'sort.manual':'Manual','sort.created':'Mais recentes','sort.deadline':'Prazo','sort.priority':'Prioridade','sort.title':'Título (A–Z)',
    'side.addTask':'Nova tarefa','side.taskName':'Nome da tarefa','side.desc':'Descrição','side.priority':'Prioridade','side.deadline':'Prazo','side.column':'Coluna','side.addToBoard':'Adicionar ao quadro','side.overview':'Visão geral','side.addColumn':'Adicionar coluna','side.groups':'Grupos','side.addGroup':'Adicionar grupo',
    'prio.Critical':'Crítica','prio.High':'Alta','prio.Medium':'Média','prio.Low':'Baixa',
    'col.empty':'Nenhuma tarefa aqui','col.addTask':'Nova tarefa','col.edit':'Editar coluna',
    'card.moveLeft':'Mover para a esquerda','card.moveRight':'Mover para a direita','card.edit':'Editar','card.delete':'Excluir',
    'empty.noMatch':'Nenhuma tarefa corresponde aos filtros.','groups.empty':'Nenhum grupo ainda.','group.edit':'Editar grupo','group.none':'Sem grupo',
    'dl.today':'Hoje','dl.tomorrow':'Amanhã',
    'th.task':'Tarefa','th.priority':'Prioridade','th.deadline':'Prazo','th.status':'Status','th.added':'Criada',
    'cal.prev':'Mês anterior','cal.next':'Próximo mês','cal.today':'Hoje','cal.noDeadline':'sem prazo',
    'm.newTask':'Nova tarefa','m.editTask':'Editar tarefa','m.taskName':'Nome da tarefa','m.desc':'Descrição','m.priority':'Prioridade','m.deadline':'Prazo','m.column':'Coluna','m.group':'Grupo','m.noGroup':'— Sem grupo —','m.subtasks':'Subtarefas','m.addSubtask':'Nova subtarefa','m.noSubtasks':'Nenhuma subtarefa ainda.','m.subPlaceholder':'Subtarefa...','m.cancel':'Cancelar','m.save':'Salvar','m.remove':'Remover','m.of':'de','m.done':'concluídas',
    'c.newCol':'Nova coluna','c.editCol':'Editar coluna','c.name':'Nome','c.color':'Cor','c.delete':'Excluir coluna','c.cantDeleteLast':'Você não pode excluir a última coluna.',
    'c.confirmDel':'Excluir "{name}"?','c.confirmDelMove':'Excluir "{name}"?\n\n{n} tarefa(s) serão movidas para "{other}".',
    'g.newGroup':'Novo grupo','g.editGroup':'Editar grupo','g.delete':'Excluir grupo','g.confirmDel':'Excluir o grupo "{name}"?','g.confirmDelTasks':'\n\n{n} tarefa(s) ficarão sem grupo.',
    'f.priority':'Prioridade','f.status':'Status','f.group':'Grupo','f.deadline':'Prazo','f.any':'Qualquer','f.overdue':'Atrasada','f.next7':'Vence em 7 dias','f.later':'Vence depois','f.none':'Sem prazo','f.noGroup':'Sem grupo','f.clear':'Limpar filtros','f.done':'Pronto',
    'rt.bold':'Negrito (Ctrl+B)','rt.italic':'Itálico (Ctrl+I)','rt.underline':'Sublinhado','rt.h1':'Título','rt.h2':'Subtítulo','rt.ul':'Lista','rt.ol':'Lista numerada','rt.red':'Vermelho','rt.orange':'Laranja','rt.green':'Verde','rt.blue':'Azul','rt.purple':'Roxo','rt.link':'Inserir link','rt.clear':'Limpar formatação','rt.linkPrompt':'URL do link:','rt.placeholder':'Adicione uma descrição detalhada… (aceita # título, - lista, **negrito**)',
    'sync.idle':'Offline — alterações salvas só neste dispositivo','sync.saving':'Salvando…','sync.synced':'Tudo sincronizado','sync.error':'Erro de sincronização — vamos tentar de novo',
    'confirm.delTask':'Excluir "{name}"?','confirm.signout':'Sair da sua conta? Os dados continuam salvos no Supabase.',
    'import.invalid':'Arquivo JSON inválido — campo "tasks" não encontrado.','import.confirm':'Importar {n} tarefas? Isso substitui os dados atuais.','import.error':'Erro ao ler arquivo: ',
    'notes.new':'Nova nota','notes.empty':'Nenhuma nota ainda.','notes.untitled':'Nota sem título','notes.titlePh':'Título da nota','notes.contentPh':'Escreva em Markdown…','notes.delete':'Excluir nota','notes.gen':'Gerar tarefas','notes.select':'Selecione uma nota ou crie uma nova.','notes.deleteConfirm':'Excluir esta nota?','notes.tableMissing':'⚠ Configuração única: rode supabase/notes.sql no SQL Editor do Supabase para sincronizar as notas na nuvem. (As notas ficam salvas localmente enquanto isso.)',
    'gen.title':'Gerar tarefas da nota','gen.none':'Nenhum item de lista encontrado. Use marcadores "- item" ou caixas "- [ ] item" na nota.','gen.column':'Coluna destino','gen.cancel':'Cancelar','gen.create':'Criar tarefas',
  },
};
I18N.en.weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
I18N['pt-BR'].weekdays = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
Object.assign(I18N.en, {
  'tk.tab':'Tickets','tk.title':'Tickets','tk.all':'All','tk.empty':'No tickets match.','tk.openCount':'open',
  'tk.status':'Status','tk.priority':'Priority','tk.comments':'Comments','tk.noComments':'No comments yet.',
  'tk.reply':'Reply to the requester…','tk.send':'Send','tk.close':'Close',
  'tk.convert':'Convert to task','tk.converted':'✓ Converted to a task','tk.convertedMsg':'Added to your board (To Do).','tk.youAdmin':'You (admin)',
  'tk.st.Open':'Open','tk.st.In progress':'In progress','tk.st.Waiting':'Waiting','tk.st.Done':'Done','tk.st.Rejected':'Rejected',
  'tk.cat.Change':'Change','tk.cat.Addition':'Addition','tk.cat.Improvement':'Improvement','tk.cat.Bug':'Bug','tk.cat.Question':'Question',
  'tk.pr.Low':'Low','tk.pr.Medium':'Medium','tk.pr.High':'High','tk.pr.Critical':'Critical',
});
Object.assign(I18N['pt-BR'], {
  'tk.tab':'Chamados','tk.title':'Chamados','tk.all':'Todos','tk.empty':'Nenhum chamado.','tk.openCount':'em aberto',
  'tk.status':'Status','tk.priority':'Prioridade','tk.comments':'Comentários','tk.noComments':'Nenhum comentário ainda.',
  'tk.reply':'Responder ao solicitante…','tk.send':'Enviar','tk.close':'Fechar',
  'tk.convert':'Converter em tarefa','tk.converted':'✓ Convertido em tarefa','tk.convertedMsg':'Adicionado ao seu board (To Do).','tk.youAdmin':'Você (admin)',
  'tk.st.Open':'Aberto','tk.st.In progress':'Em andamento','tk.st.Waiting':'Aguardando','tk.st.Done':'Concluído','tk.st.Rejected':'Recusado',
  'tk.cat.Change':'Alteração','tk.cat.Addition':'Inclusão','tk.cat.Improvement':'Melhoria','tk.cat.Bug':'Bug','tk.cat.Question':'Dúvida',
  'tk.pr.Low':'Baixa','tk.pr.Medium':'Média','tk.pr.High':'Alta','tk.pr.Critical':'Crítica',
});
Object.assign(I18N.en, { 'notes.split':'Split','notes.md':'Markdown','notes.rich':'Rich','notes.focus':'Focus mode','notes.exitFocus':'Exit focus' });
Object.assign(I18N['pt-BR'], { 'notes.split':'Dividido','notes.md':'Markdown','notes.rich':'Visual','notes.focus':'Modo foco','notes.exitFocus':'Sair do foco' });
Object.assign(I18N.en, { 'an.tab':'Analytics','an.title':'Analytics','an.kTotal':'Total tasks','an.kDone':'Completed','an.kOpen':'Open','an.kOverdue':'Overdue','an.kRate':'Completion','an.doneWeek':'done this week','an.doneMonth':'done (30 days)','an.dueSoon':'due in 7 days','an.byStatus':'Tasks by status','an.byPriority':'Tasks by priority','an.byGroup':'Tasks by group','an.completions':'Completed per week (last 8)','an.subtasks':'Subtasks','an.subtaskProgress':'{d} of {t} subtasks done','an.notes':'Notes','an.noteCount':'Notes','an.noteWords':'Words written','an.lastEdited':'Last edited','an.never':'—','an.tickets':'Tickets','an.tkOpen':'Open','an.tkDone':'Resolved','an.byCategory':'By category','an.noData':'No data yet.','an.completionsHint':'Tracked from now on.','an.configure':'Configure','an.cfg.cards':'Summary cards' });
Object.assign(I18N['pt-BR'], { 'an.tab':'Análise','an.title':'Análise','an.kTotal':'Total de tarefas','an.kDone':'Concluídas','an.kOpen':'Em aberto','an.kOverdue':'Atrasadas','an.kRate':'Conclusão','an.doneWeek':'concluídas na semana','an.doneMonth':'concluídas (30 dias)','an.dueSoon':'vencem em 7 dias','an.byStatus':'Tarefas por status','an.byPriority':'Tarefas por prioridade','an.byGroup':'Tarefas por grupo','an.completions':'Concluídas por semana (últimas 8)','an.subtasks':'Subtarefas','an.subtaskProgress':'{d} de {t} subtarefas concluídas','an.notes':'Notas','an.noteCount':'Notas','an.noteWords':'Palavras escritas','an.lastEdited':'Última edição','an.never':'—','an.tickets':'Chamados','an.tkOpen':'Abertos','an.tkDone':'Resolvidos','an.byCategory':'Por categoria','an.noData':'Sem dados ainda.','an.completionsHint':'Registrado a partir de agora.','an.configure':'Configurar','an.cfg.cards':'Cards de resumo' });
Object.assign(I18N.en, { 'tb.changePhoto':'Change photo','tb.removePhoto':'Remove photo','tb.toggleSidebar':'Show / hide the sidebar','cols.btn':'Columns','cols.title':'Show columns' });
Object.assign(I18N['pt-BR'], { 'tb.changePhoto':'Trocar foto','tb.removePhoto':'Remover foto','tb.toggleSidebar':'Mostrar / ocultar a barra lateral','cols.btn':'Colunas','cols.title':'Mostrar colunas' });
Object.assign(I18N.en, { 'rt.smaller':'Smaller text','rt.bigger':'Bigger text','rt.highlight':'Highlight','rt.clearHl':'Clear highlight' });
Object.assign(I18N['pt-BR'], { 'rt.smaller':'Diminuir fonte','rt.bigger':'Aumentar fonte','rt.highlight':'Marca-texto','rt.clearHl':'Remover marca-texto' });
Object.assign(I18N.en, { 'pres.tab':'Presentations','pres.import':'Import HTML','pres.empty':'No presentations yet. Import an HTML slide deck.','pres.untitled':'Untitled deck','pres.titlePh':'Presentation title','pres.present':'Present','pres.delete':'Delete presentation','pres.deleteConfirm':'Delete this presentation?','pres.select':'Select a presentation, or import an HTML deck.','pres.tableMissing':'One-time setup: run supabase/presentations.sql in your Supabase SQL Editor to sync presentations to the cloud. (Cached locally meanwhile.)' });
Object.assign(I18N['pt-BR'], { 'pres.tab':'Apresentações','pres.import':'Importar HTML','pres.empty':'Nenhuma apresentação ainda. Importe um slide em HTML.','pres.untitled':'Apresentação sem título','pres.titlePh':'Título da apresentação','pres.present':'Apresentar','pres.delete':'Excluir apresentação','pres.deleteConfirm':'Excluir esta apresentação?','pres.select':'Selecione uma apresentação ou importe um HTML.','pres.tableMissing':'Configuração única: rode supabase/presentations.sql no SQL Editor para sincronizar na nuvem. (Cache local enquanto isso.)' });
Object.assign(I18N.en, { 'pres.search':'Search presentations…','pres.newest':'Newest','pres.oldest':'Oldest','pres.az':'Title A–Z','pres.tagsPh':'Add tag…','pres.noResults':'No matches.' });
Object.assign(I18N['pt-BR'], { 'pres.search':'Buscar apresentações…','pres.newest':'Mais recentes','pres.oldest':'Mais antigas','pres.az':'Título A–Z','pres.tagsPh':'Adicionar tag…','pres.noResults':'Nenhum resultado.' });
Object.assign(I18N.en, { 'theme.light':'Light','theme.dim':'Dim','theme.dark':'Dark','theme.midnight':'Midnight','theme.forest':'Forest','theme.ocean':'Ocean','theme.rose':'Rosé' });
Object.assign(I18N['pt-BR'], { 'theme.light':'Claro','theme.dim':'Suave','theme.dark':'Escuro','theme.midnight':'Meia-noite','theme.forest':'Floresta','theme.ocean':'Oceano','theme.rose':'Rosé' });
Object.assign(I18N.en, { 'rt.table':'Table','table.insert':'Insert table','table.addRow':'Add row','table.addCol':'Add column','table.delRow':'Delete row','table.delCol':'Delete column','table.alignLeft':'Align left','table.alignCenter':'Align center','table.alignRight':'Align right' });
Object.assign(I18N['pt-BR'], { 'rt.table':'Tabela','table.insert':'Inserir tabela','table.addRow':'Adicionar linha','table.addCol':'Adicionar coluna','table.delRow':'Excluir linha','table.delCol':'Excluir coluna','table.alignLeft':'Alinhar à esquerda','table.alignCenter':'Centralizar','table.alignRight':'Alinhar à direita' });
Object.assign(I18N.en, { 'ins.btn':'Insert','ins.date':"Today's date",'ins.datetime':'Date & time','ins.tag':'Tag','ins.attr':'Attribute','ins.link':'Link to note…','ins.tagPrompt':'Tag name:','ins.attrPrompt':'Attribute name:','ins.linkTitle':'Link to a note','ins.linkPh':'Search notes…','exp.btn':'Export','exp.copy':'Copy to clipboard','exp.html':'Export as HTML','exp.pdf':'Export as PDF','exp.copied':'Copied!','exp.popup':'Allow pop-ups to export PDF.','graph.title':'Notes graph','graph.back':'Back to notes','graph.zoomIn':'Zoom in','graph.zoomOut':'Zoom out','graph.reset':'Reset view','graph.nodeSize':'Node size','graph.nodeColor':'Node color','graph.openNote':'Open note','graph.resetNode':'Reset','graph.smaller':'Smaller','graph.bigger':'Bigger' });
Object.assign(I18N.en, { 'notes.import':'Import Markdown','notes.search':'Search notes…','notes.sort.manual':'Manual order','notes.sort.title':'Title (A–Z)','notes.sort.newest':'Newest first','notes.sort.oldest':'Oldest first' });
Object.assign(I18N['pt-BR'], { 'ins.btn':'Inserir','ins.date':'Data de hoje','ins.datetime':'Data e hora','ins.tag':'Tag','ins.attr':'Atributo','ins.link':'Linkar nota…','ins.tagPrompt':'Nome da tag:','ins.attrPrompt':'Nome do atributo:','ins.linkTitle':'Linkar a uma nota','ins.linkPh':'Buscar notas…','exp.btn':'Exportar','exp.copy':'Copiar para a área de transferência','exp.html':'Exportar como HTML','exp.pdf':'Exportar como PDF','exp.copied':'Copiado!','exp.popup':'Permita pop-ups para exportar o PDF.','graph.title':'Grafo de notas','graph.back':'Voltar às notas','graph.zoomIn':'Aproximar','graph.zoomOut':'Afastar','graph.reset':'Redefinir visão','graph.nodeSize':'Tamanho dos nodes','graph.nodeColor':'Cor dos nodes','graph.openNote':'Abrir nota','graph.resetNode':'Restaurar','graph.smaller':'Menor','graph.bigger':'Maior' });
Object.assign(I18N['pt-BR'], { 'notes.import':'Importar Markdown','notes.search':'Buscar notas…','notes.sort.manual':'Ordem manual','notes.sort.title':'Título (A–Z)','notes.sort.newest':'Mais recentes','notes.sort.oldest':'Mais antigas' });
function localeFor() { return lang === 'pt-BR' ? 'pt-BR' : 'en-US'; }
function tr(key) { const d = I18N[lang] || I18N.en; return d[key] != null ? d[key] : (I18N.en[key] != null ? I18N.en[key] : key); }
function prioLabel(p) { return tr('prio.' + p); }
function loadLang() { const l = localStorage.getItem(STORE_LANG); lang = (l === 'pt-BR' || l === 'en') ? l : 'en'; }
function setLang(l) { lang = (l === 'pt-BR') ? 'pt-BR' : 'en'; localStorage.setItem(STORE_LANG, lang); markPrefsDirty(); applyI18n(); }
function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = tr(el.getAttribute('data-i18n')); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.setAttribute('placeholder', tr(el.getAttribute('data-i18n-ph'))); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.setAttribute('title', tr(el.getAttribute('data-i18n-title'))); });
  document.querySelectorAll('[data-setlang]').forEach(b => b.classList.toggle('active', b.getAttribute('data-setlang') === lang));
  document.documentElement.lang = lang;
  document.title = tr('app.title');
  refreshIcons();
}
function applyI18n() {
  applyStaticI18n();
  const authScreen = document.getElementById('auth-screen');
  if (authScreen && !authScreen.hidden) setAuthMode(authMode);
  if (USER_ID) { refreshColumnSelects(); renderBoard(); }
}


// ============================================================
//  Defaults + seed
// ============================================================
const DEFAULT_COLS = [
  { id: 'todo',    name: 'To Do',   color: '#1a8cff' },
  { id: 'pending', name: 'Pending', color: '#e08a00' },
  { id: 'done',    name: 'Done',    color: '#00a65a' },
];


// ============================================================
//  Local cache (per user) + save scheduling
// ============================================================
const STORE_COLLAPSED = 'tb_collapsed';
let collapsedGroups = new Set();

function cacheKey(name) { return 'tb_' + (USER_ID || 'anon') + '_' + name; }
function cacheGet(name) {
  try { const r = localStorage.getItem(cacheKey(name)); return r ? JSON.parse(r) : null; } catch (e) { return null; }
}
function cacheSet(name, val) {
  try { localStorage.setItem(cacheKey(name), JSON.stringify(val)); } catch (e) {}
}
function cacheClearUser() {
  const prefix = 'tb_' + (USER_ID || 'anon') + '_';
  Object.keys(localStorage).filter(k => k.startsWith(prefix)).forEach(k => localStorage.removeItem(k));
}

// Instant paint from cache before the network round-trip.
function loadFromCache() {
  const c = cacheGet('columns'); columns = Array.isArray(c) ? c : [];
  const g = cacheGet('groups');  groups  = Array.isArray(g) ? g : [];
  const t = cacheGet('tasks');   tasks   = Array.isArray(t) ? t : [];
  tasks.forEach(x => { if (!Array.isArray(x.subtasks)) x.subtasks = []; if (x.group === undefined) x.group = ''; });
  const n = cacheGet('notes'); notes = Array.isArray(n) ? n : [];
  const dks = cacheGet('presentations'); presentations = Array.isArray(dks) ? dks : [];
}

function getGroup(id) { return groups.find(g => g.id === id); }

// Save = write cache immediately, then debounce a cloud push.
function saveColumns() { cacheSet('columns', columns); scheduleCloudSave('columns'); }
function saveGroups()  { cacheSet('groups',  groups);  scheduleCloudSave('groups'); }
function saveTasks()   { cacheSet('tasks',   tasks);   scheduleCloudSave('tasks'); }
function saveNotes()   { cacheSet('notes',   notes);   scheduleCloudSave('notes'); }

function loadGroupBy() { groupBy = localStorage.getItem(STORE_GROUPBY) === '1'; }
function saveGroupBy() { localStorage.setItem(STORE_GROUPBY, groupBy ? '1' : '0'); markPrefsDirty(); }

function loadCollapsed() {
  try { const a = JSON.parse(localStorage.getItem(STORE_COLLAPSED) || '[]'); if (Array.isArray(a)) collapsedGroups = new Set(a); } catch (e) {}
}
function saveCollapsed() { localStorage.setItem(STORE_COLLAPSED, JSON.stringify([...collapsedGroups])); markPrefsDirty(); }

function loadView() {
  const v = localStorage.getItem(STORE_VIEW);
  if (v === 'kanban' || v === 'table' || v === 'cards' || v === 'calendar' || v === 'notes' || v === 'tickets' || v === 'analytics' || v === 'slides') currentView = v;
}
function saveView() { localStorage.setItem(STORE_VIEW, currentView); markPrefsDirty(); }

// New columns/groups created on another device should auto-appear instead of
// being hidden by an existing filter selection.
function noteSeen() { columns.forEach(c => seenCols.add(c.id)); groups.forEach(g => seenGroups.add(g.id)); }
function addNewToFilters() {
  columns.forEach(c => { if (!seenCols.has(c.id)) filters.cols.add(c.id); });
  groups.forEach(g => { if (!seenGroups.has(g.id)) filters.groups.add(g.id); });
  filters.groups.add('');
  noteSeen();
}

// ============================================================
//  Utils
// ============================================================
function escHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function uid() { return 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }
function refreshIcons() { if (window.lucide && window.lucide.createIcons) { try { window.lucide.createIcons(); } catch (e) {} } }
function getCol(id) { return columns.find(c => c.id === id); }
// Stamp/clear the completion time when a task enters/leaves the 'done' column
function markCompletion(t) { if (t.col === 'done') { if (!t.completed) t.completed = Date.now(); } else { t.completed = null; } }

// ---- Rich text helpers ----
function isHtmlContent(s) { return /<[a-z][\s\S]*>/i.test(s || ''); }
function stripHtml(html) {
  if (!html) return '';
  if (!isHtmlContent(html)) return html;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
}
function sanitizeHtml(html) {
  const ALLOWED = new Set(['B','STRONG','I','EM','U','H1','H2','H3','H4','H5','H6','UL','OL','LI','P','BR','SPAN','A','DIV','BLOCKQUOTE','FONT','CODE','PRE','HR','TABLE','THEAD','TBODY','TR','TD','TH','S','DEL']);
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  (function clean(node) {
    let i = 0;
    while (i < node.childNodes.length) {
      const child = node.childNodes[i];
      if (child.nodeType === 8) { child.remove(); continue; }       // comment
      if (child.nodeType !== 1) { i++; continue; }                  // text/other
      if (!ALLOWED.has(child.tagName)) {                            // unwrap unknown tag
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        child.remove();
        continue;
      }
      [...child.attributes].forEach(attr => {
        const n = attr.name.toLowerCase();
        if (n === 'style') {
          const color = child.style.color;
          const bg = child.style.backgroundColor;
          const fs = child.style.fontSize;
          const ta = child.style.textAlign;
          child.removeAttribute('style');
          if (color) child.style.color = color;
          if (bg) child.style.backgroundColor = bg;
          if (fs) child.style.fontSize = fs;
          if (ta) child.style.textAlign = ta;
        } else if (n === 'color' && child.tagName === 'FONT') {
          // keep font color
        } else if (n === 'data-note-link') {
          // keep wiki-link target
        } else if (n === 'class' && /(^|\s)note-link(\s|$)/.test(attr.value)) {
          // keep note-link class
        } else if (n === 'align' && (child.tagName === 'TD' || child.tagName === 'TH')) {
          // keep cell alignment (round-trips to GFM :--:)
        } else if (n === 'href' && child.tagName === 'A') {
          if (/^\s*(javascript|data):/i.test(attr.value)) child.removeAttribute('href');
          else { child.setAttribute('rel', 'noopener'); child.setAttribute('target', '_blank'); }
        } else {
          child.removeAttribute(attr.name);
        }
      });
      if ((child.tagName === 'TD' || child.tagName === 'TH') && child.style && child.style.textAlign) child.setAttribute('align', child.style.textAlign);
      clean(child);
      i++;
    }
  })(tmp);
  return tmp.innerHTML;
}
function richToStored(editor) {
  const html = sanitizeHtml(editor.innerHTML);
  return stripHtml(html).trim() ? html.trim() : '';
}
function setupRichEditor(editor, toolbar) {
  try { document.execCommand('styleWithCSS', false, true); } catch (e) {}
  let fontLevel = 3;
  const currentBlockTag = () => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return '';
    let node = sel.getRangeAt(0).startContainer;
    while (node && node !== editor) {
      if (node.nodeType === 1 && /^(H1|H2|H3|P|DIV|LI|BLOCKQUOTE)$/.test(node.tagName)) return node.tagName;
      node = node.parentNode;
    }
    return '';
  };
  toolbar.addEventListener('mousedown', e => {
    if (e.target.closest('button, .rich-color, .rich-hl')) e.preventDefault();
  });
  editor.addEventListener('mousedown', () => { const m = toolbar.querySelector('.rich-table-menu'); if (m) m.hidden = true; });
  toolbar.addEventListener('click', e => {
    const colorEl = e.target.closest('.rich-color');
    if (colorEl) {
      editor.focus();
      try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
      document.execCommand('foreColor', false, colorEl.dataset.color);
      return;
    }
    const hlEl = e.target.closest('.rich-hl');
    if (hlEl) {
      editor.focus();
      try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
      try { document.execCommand('hiliteColor', false, hlEl.dataset.hl); } catch (_) { document.execCommand('backColor', false, hlEl.dataset.hl); }
      return;
    }
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.tabletoggle) { const m = toolbar.querySelector('.rich-table-menu'); if (m) m.hidden = !m.hidden; return; }
    if (btn.dataset.tableop) { editor.focus(); tableOp(editor, btn.dataset.tableop); const m = toolbar.querySelector('.rich-table-menu'); if (m) m.hidden = true; return; }
    editor.focus();
    if (btn.dataset.fontstep) {
      fontLevel = Math.max(1, Math.min(7, fontLevel + parseInt(btn.dataset.fontstep)));
      try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
      document.execCommand('fontSize', false, fontLevel);
    } else if (btn.dataset.cmd) {
      document.execCommand(btn.dataset.cmd, false, null);
    } else if (btn.dataset.block) {
      const tag = btn.dataset.block.toUpperCase();
      if (currentBlockTag() === tag) document.execCommand('formatBlock', false, '<div>');
      else document.execCommand('formatBlock', false, '<' + btn.dataset.block + '>');
    } else if (btn.dataset.link) {
      const url = prompt(tr('rt.linkPrompt'));
      if (url) document.execCommand('createLink', false, url);
    }
  });
  editor.addEventListener('keydown', e => {
    if (e.key !== ' ') return;
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;
    const before = node.textContent.slice(0, range.startOffset);
    const headingMap = { '###': 'h3', '##': 'h2', '#': 'h1' };
    const consume = () => {
      const r = document.createRange();
      r.setStart(node, 0); r.setEnd(node, range.startOffset);
      r.deleteContents();
    };
    if (headingMap[before]) { e.preventDefault(); consume(); document.execCommand('formatBlock', false, '<' + headingMap[before] + '>'); }
    else if (before === '-' || before === '*') { e.preventDefault(); consume(); document.execCommand('insertUnorderedList'); }
    else if (before === '1.') { e.preventDefault(); consume(); document.execCommand('insertOrderedList'); }
  });
}
function richEditorMarkup(id) {
  return `
    <div class="rich-toolbar" id="${id}-toolbar">
      <button type="button" data-cmd="bold" title="${escHtml(tr('rt.bold'))}"><b>B</b></button>
      <button type="button" data-cmd="italic" title="${escHtml(tr('rt.italic'))}"><i>I</i></button>
      <button type="button" data-cmd="underline" title="${escHtml(tr('rt.underline'))}"><u>U</u></button>
      <button type="button" data-fontstep="-1" title="${escHtml(tr('rt.smaller'))}"><i data-lucide="a-arrow-down"></i></button>
      <button type="button" data-fontstep="1" title="${escHtml(tr('rt.bigger'))}"><i data-lucide="a-arrow-up"></i></button>
      <span class="rich-sep"></span>
      <button type="button" data-block="h1" title="${escHtml(tr('rt.h1'))}">H1</button>
      <button type="button" data-block="h2" title="${escHtml(tr('rt.h2'))}">H2</button>
      <button type="button" data-cmd="insertUnorderedList" title="${escHtml(tr('rt.ul'))}">•</button>
      <button type="button" data-cmd="insertOrderedList" title="${escHtml(tr('rt.ol'))}">1.</button>
      <span class="rich-sep"></span>
      <span class="rich-color" data-color="#e2445c" style="background:#e2445c" title="${escHtml(tr('rt.red'))}"></span>
      <span class="rich-color" data-color="#fdab3d" style="background:#fdab3d" title="${escHtml(tr('rt.orange'))}"></span>
      <span class="rich-color" data-color="#00c875" style="background:#00c875" title="${escHtml(tr('rt.green'))}"></span>
      <span class="rich-color" data-color="#579bfc" style="background:#579bfc" title="${escHtml(tr('rt.blue'))}"></span>
      <span class="rich-color" data-color="#6161ff" style="background:#6161ff" title="${escHtml(tr('rt.purple'))}"></span>
      <span class="rich-sep"></span>
      <span class="rich-hl-label" title="${escHtml(tr('rt.highlight'))}"><i data-lucide="highlighter"></i></span>
      <span class="rich-hl" data-hl="#fff59d" style="background:#fff59d" title="${escHtml(tr('rt.highlight'))}"></span>
      <span class="rich-hl" data-hl="#c5f7c8" style="background:#c5f7c8" title="${escHtml(tr('rt.highlight'))}"></span>
      <span class="rich-hl" data-hl="#ffc9de" style="background:#ffc9de" title="${escHtml(tr('rt.highlight'))}"></span>
      <span class="rich-hl" data-hl="#bfe0ff" style="background:#bfe0ff" title="${escHtml(tr('rt.highlight'))}"></span>
      <span class="rich-hl rich-hl-clear" data-hl="transparent" title="${escHtml(tr('rt.clearHl'))}">⌀</span>
      <span class="rich-sep"></span>
      <span class="rich-tablewrap"><button type="button" data-tabletoggle="1" title="${escHtml(tr('rt.table'))}"><i data-lucide="table"></i></button><div class="rich-table-menu" hidden><button type="button" data-tableop="insert"><i data-lucide="table"></i>${escHtml(tr('table.insert'))}</button><button type="button" data-tableop="addRow"><i data-lucide="plus"></i>${escHtml(tr('table.addRow'))}</button><button type="button" data-tableop="addCol"><i data-lucide="plus"></i>${escHtml(tr('table.addCol'))}</button><button type="button" data-tableop="delRow"><i data-lucide="minus"></i>${escHtml(tr('table.delRow'))}</button><button type="button" data-tableop="delCol"><i data-lucide="minus"></i>${escHtml(tr('table.delCol'))}</button><button type="button" data-tableop="alignLeft"><i data-lucide="align-left"></i>${escHtml(tr('table.alignLeft'))}</button><button type="button" data-tableop="alignCenter"><i data-lucide="align-center"></i>${escHtml(tr('table.alignCenter'))}</button><button type="button" data-tableop="alignRight"><i data-lucide="align-right"></i>${escHtml(tr('table.alignRight'))}</button></div></span>
      <span class="rich-sep"></span>
      <button type="button" data-link="1" title="${escHtml(tr('rt.link'))}"><i data-lucide="link"></i></button>
      <button type="button" data-cmd="removeFormat" title="${escHtml(tr('rt.clear'))}"><i data-lucide="eraser"></i></button>
    </div>
    <div class="rich-editor" id="${id}" contenteditable="true" data-placeholder="${escHtml(tr('rt.placeholder'))}"></div>
  `;
}
function subtaskCounts(t) {
  const arr = t.subtasks || [];
  return { done: arr.filter(s => s.done).length, total: arr.length };
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.round((d - today) / 86400000);
}
function formatDeadline(dateStr, isDone) {
  if (!dateStr) return null;
  if (isDone) {
    const d = new Date(dateStr + 'T00:00:00');
    return { text: '✓ ' + d.toLocaleDateString(localeFor(), { month: 'short', day: 'numeric' }), cls: 'done' };
  }
  const days = daysUntil(dateStr);
  if (days < 0) {
    const n = Math.abs(days);
    const txt = lang === 'pt-BR' ? (n + (n === 1 ? ' dia atrasada' : ' dias atrasada')) : (n + ' day' + (n === 1 ? '' : 's') + ' overdue');
    return { text: txt, cls: 'over' };
  }
  if (days === 0) return { text: tr('dl.today'),    cls: 'warn' };
  if (days === 1) return { text: tr('dl.tomorrow'), cls: 'warn' };
  if (days <= 7)  return { text: (lang === 'pt-BR' ? 'Em ' : 'In ') + days + 'd', cls: 'warn' };
  const d = new Date(dateStr + 'T00:00:00');
  return { text: d.toLocaleDateString(localeFor(), { month: 'short', day: 'numeric' }), cls: '' };
}

// ============================================================
//  Filter + sort
// ============================================================
function filterMatches(t) {
  if (!filters.priorities.has(t.priority)) return false;
  if (filters.cols.size && !filters.cols.has(t.col)) return false;
  if (filters.groups.size && !filters.groups.has(t.group || '')) return false;
  const d = filters.deadline;
  if (d !== 'all') {
    const days = daysUntil(t.deadline);
    if (d === 'none' && t.deadline) return false;
    if (d === 'overdue'  && (!t.deadline || days >= 0))  return false;
    if (d === 'this_week' && (!t.deadline || days < 0 || days > 7)) return false;
    if (d === 'later'    && (!t.deadline || days <= 7))  return false;
  }
  return true;
}
function activeFilterCount() {
  let n = 0;
  if (filters.priorities.size < PRIORITIES.length) n++;
  if (filters.cols.size && filters.cols.size < columns.length) n++;
  if (filters.groups.size && filters.groups.size < groups.length + 1) n++;
  if (filters.deadline !== 'all') n++;
  return n;
}
function resetFilters() {
  filters.priorities = new Set(PRIORITIES);
  filters.cols       = new Set(columns.map(c => c.id));
  filters.groups     = new Set([...groups.map(g => g.id), '']);
  filters.deadline   = 'all';
}
function getFilteredSorted() {
  const q = document.getElementById('search').value.trim().toLowerCase();
  const sortBy = document.getElementById('sort').value;
  let list = tasks.slice();
  if (q) list = list.filter(t =>
    (t.title || '').toLowerCase().includes(q) ||
    (t.desc  || '').toLowerCase().includes(q)
  );
  list = list.filter(filterMatches);
  if (hiddenCols.size) list = list.filter(t => !hiddenCols.has(t.col));
  if (sortBy === 'manual') return list;
  list.sort((a, b) => {
    if (sortBy === 'deadline') {
      if (!a.deadline && !b.deadline) return b.created - a.created;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline.localeCompare(b.deadline);
    }
    if (sortBy === 'priority') {
      const d = PRIO_RANK[a.priority] - PRIO_RANK[b.priority];
      if (d !== 0) return d;
      return b.created - a.created;
    }
    if (sortBy === 'title') return (a.title || '').localeCompare(b.title || '');
    return b.created - a.created;
  });
  return list;
}

// ============================================================
//  Subtask chip helper
// ============================================================
function subtaskChipHtml(t) {
  const { done, total } = subtaskCounts(t);
  if (!total) return '';
  const cls = (done === total) ? ' complete' : '';
  return `<span class="chip chip-subtask${cls}"><i data-lucide="check-square"></i> ${done}/${total}</span>`;
}

// ============================================================
//  Top-level render
// ============================================================
function renderBoard() {
  const board = document.getElementById('board');
  if (currentView === 'tickets' && USER_ROLE !== 'admin') currentView = 'kanban';
  board.className = 'board view-' + currentView + ((groupBy && currentView === 'cards') ? ' grouped' : '');
  document.body.classList.toggle('notes-active', currentView === 'notes');
  document.body.classList.toggle('tickets-active', currentView === 'tickets');
  document.body.classList.toggle('analytics-active', currentView === 'analytics');
  document.body.classList.toggle('slides-active', currentView === 'slides');
  if      (currentView === 'kanban')   renderKanban(board);
  else if (currentView === 'table')    renderTable(board);
  else if (currentView === 'calendar') renderCalendar(board);
  else if (currentView === 'notes')    renderNotes(board);
  else if (currentView === 'tickets')  renderTickets(board);
  else if (currentView === 'analytics') renderAnalytics(board);
  else if (currentView === 'slides')    renderPresentations(board);
  else                                 renderCards(board);
  renderOverview();
  renderGroupsList();
  refreshFilterBadge();
  const gb = document.getElementById('groupby-btn');
  if (gb) gb.classList.toggle('active', groupBy);
  refreshIcons();
}

// Build ordered group sections from a task list (real groups + "No group")
function groupOrder() {
  return [...groups, { id: '', name: tr('group.none'), color: '#9aa0b0' }];
}
function groupHeaderHtml(g, count, key) {
  const collapsed = collapsedGroups.has(key);
  return `<div class="group-header${collapsed ? ' collapsed' : ''}" data-gkey="${escHtml(key)}" style="--gc:${escHtml(g.color)}">
      <span class="group-toggle">${collapsed ? '▸' : '▾'}</span>
      <span class="group-name">${escHtml(g.name)}</span>
      <span class="group-count">${count}</span>
    </div>`;
}
function renderGroupedCards(items, showColChip, keyPrefix) {
  return groupOrder().map(g => {
    const sect = items.filter(t => (t.group || '') === g.id);
    if (!sect.length) return '';
    const key = keyPrefix + ':' + g.id;
    const cards = collapsedGroups.has(key) ? '' : sect.map(t => cardHtml(t, showColChip)).join('');
    return `<div class="group-section">${groupHeaderHtml(g, sect.length, key)}${cards}</div>`;
  }).join('');
}

// ---------- Kanban ----------
function renderKanban(board) {
  const list = getFilteredSorted();
  const byCol = {};
  columns.forEach(c => byCol[c.id] = []);
  list.forEach(t => { if (byCol[t.col]) byCol[t.col].push(t); });

  board.innerHTML = columns.filter(c => !hiddenCols.has(c.id)).map(c => {
    const items = byCol[c.id] || [];
    let cards;
    if (!items.length) cards = '<div class="col-empty">' + escHtml(tr('col.empty')) + '</div>';
    else if (groupBy)  cards = renderGroupedCards(items, false, 'k:' + c.id);
    else               cards = items.map(t => cardHtml(t, false)).join('');
    return `
      <section class="col" data-col="${escHtml(c.id)}">
        <div class="col-header" data-col-header="${escHtml(c.id)}" draggable="true" style="background:${escHtml(c.color)}">
          <div class="col-header-left">
            <span class="col-header-grip"><i data-lucide="grip-vertical"></i></span>
            <span class="col-header-name">${escHtml(c.name)}</span>
          </div>
          <div class="col-header-right">
            <span class="col-badge">${items.length}</span>
            <button class="col-menu-btn" data-edit-col="${escHtml(c.id)}" title="${escHtml(tr('col.edit'))}"><i data-lucide="more-horizontal"></i></button>
          </div>
        </div>
        <div class="col-body" data-col-body="${escHtml(c.id)}">${cards}</div>
        <button class="add-task-btn" data-add-col="${escHtml(c.id)}">${escHtml(tr('col.addTask'))}</button>
      </section>
    `;
  }).join('');

  attachCardHandlers(true);
  attachColumnHandlers();
}

// ---------- Cards (grid) ----------
function renderCards(board) {
  const list = getFilteredSorted();
  if (!list.length) {
    board.innerHTML = '<div class="table-empty">' + escHtml(tr('empty.noMatch')) + '</div>';
    return;
  }
  if (groupBy) {
    board.innerHTML = groupOrder().map(g => {
      const sect = list.filter(t => (t.group || '') === g.id);
      if (!sect.length) return '';
      const key = 'c:' + g.id;
      const grid = collapsedGroups.has(key) ? '' : `<div class="cards-grid">${sect.map(t => cardHtml(t, true)).join('')}</div>`;
      return `<div class="group-section-wide">${groupHeaderHtml(g, sect.length, key)}${grid}</div>`;
    }).join('');
  } else {
    board.innerHTML = list.map(t => cardHtml(t, true)).join('');
  }
  attachCardHandlers(false);
}

// ---------- Calendar ----------
let calYear = null, calMonth = null;
function ensureCalInit() {
  if (calYear == null) { const d = new Date(); calYear = d.getFullYear(); calMonth = d.getMonth(); }
}
function pad2(n) { return String(n).padStart(2, '0'); }
function ymdLocal(y, m, d) { return y + '-' + pad2(m + 1) + '-' + pad2(d); }

function renderCalendar(board) {
  ensureCalInit();
  const list = getFilteredSorted();
  const byDate = {};
  list.forEach(t => { if (t.deadline) (byDate[t.deadline] = byDate[t.deadline] || []).push(t); });
  const undated = list.filter(t => !t.deadline).length;

  const first = new Date(calYear, calMonth, 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();
  const todayStr = ymdLocal(today.getFullYear(), today.getMonth(), today.getDate());
  const monthLabel = first.toLocaleDateString(localeFor(), { month: 'long', year: 'numeric' });
  const WD = (I18N[lang] && I18N[lang].weekdays) || I18N.en.weekdays;

  let cells = '';
  for (let i = 0; i < startDay; i++) cells += '<div class="cal-cell cal-blank"></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const ds = ymdLocal(calYear, calMonth, day);
    const dayTasks = byDate[ds] || [];
    const isToday = ds === todayStr;
    const shown = dayTasks.slice(0, 4);
    const more = dayTasks.length - shown.length;
    const chips = shown.map(t => {
      const overdue = ds < todayStr && t.col !== 'done';
      const done = t.col === 'done';
      return '<div class="cal-task priority-' + escHtml(t.priority) + (overdue ? ' over' : '') + (done ? ' done' : '') +
             '" data-edit="' + escHtml(t.id) + '" title="' + escHtml(t.title) + '">' + escHtml(t.title) + '</div>';
    }).join('');
    const moreEl = more > 0 ? '<div class="cal-more">+' + more + '</div>' : '';
    cells += '<div class="cal-cell' + (isToday ? ' cal-today' : '') + '" data-cal-day="' + ds + '">' +
             '<div class="cal-daynum">' + day + '</div>' +
             '<div class="cal-tasks">' + chips + moreEl + '</div></div>';
  }
  const trailing = (startDay + daysInMonth) % 7;
  if (trailing) for (let i = trailing; i < 7; i++) cells += '<div class="cal-cell cal-blank"></div>';

  board.innerHTML =
    '<div class="cal-wrap">' +
      '<div class="cal-toolbar">' +
        '<div class="cal-nav">' +
          '<button class="icon-btn" id="cal-prev" title="' + escHtml(tr('cal.prev')) + '"><i data-lucide="chevron-left"></i></button>' +
          '<button class="btn-ghost" id="cal-today" style="padding:6px 12px">' + escHtml(tr('cal.today')) + '</button>' +
          '<button class="icon-btn" id="cal-next" title="' + escHtml(tr('cal.next')) + '"><i data-lucide="chevron-right"></i></button>' +
        '</div>' +
        '<div class="cal-month">' + escHtml(monthLabel) + '</div>' +
        '<div class="cal-legend">' + (undated ? undated + ' ' + tr('cal.noDeadline') : '') + '</div>' +
      '</div>' +
      '<div class="cal-weekdays">' + WD.map(d => '<div>' + d + '</div>').join('') + '</div>' +
      '<div class="cal-grid">' + cells + '</div>' +
    '</div>';

  document.getElementById('cal-prev').addEventListener('click', () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderBoard(); });
  document.getElementById('cal-next').addEventListener('click', () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderBoard(); });
  document.getElementById('cal-today').addEventListener('click', () => { const d = new Date(); calYear = d.getFullYear(); calMonth = d.getMonth(); renderBoard(); });
  board.querySelectorAll('[data-edit]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); openTaskModal(el.dataset.edit); }));
  board.querySelectorAll('[data-cal-day]').forEach(cell => cell.addEventListener('click', e => {
    if (e.target.closest('[data-edit]')) return;
    openTaskModalWithDate(cell.dataset.calDay);
  }));
}
function openTaskModalWithDate(ds) {
  openTaskModal(null);
  const dl = document.getElementById('m-deadline');
  if (dl) dl.value = ds;
}

// ---------- Table ----------
function renderTable(board) {
  const list = getFilteredSorted();
  if (!list.length) {
    board.innerHTML = '<div class="table-empty">' + escHtml(tr('empty.noMatch')) + '</div>';
    return;
  }
  const sortBy = document.getElementById('sort').value;
  const sortMark = (key) => sortBy === key ? 'active-sort' : '';
  let bodyRows;
  if (groupBy) {
    bodyRows = groupOrder().map(g => {
      const sect = list.filter(t => (t.group || '') === g.id);
      if (!sect.length) return '';
      const key = 't:' + g.id;
      const collapsed = collapsedGroups.has(key);
      const head = `<tr class="group-row${collapsed ? ' collapsed' : ''}" data-gkey="${escHtml(key)}"><td colspan="6" style="--gc:${escHtml(g.color)}"><span class="group-toggle">${collapsed ? '▸' : '▾'}</span>${escHtml(g.name)} <span class="group-count">${sect.length}</span></td></tr>`;
      const rows = collapsed ? '' : sect.map(t => tableRowHtml(t)).join('');
      return head + rows;
    }).join('');
  } else {
    bodyRows = list.map(t => tableRowHtml(t)).join('');
  }
  board.innerHTML = `
    <table class="task-table">
      <thead>
        <tr>
          <th data-sort="title" class="${sortMark('title')}">${escHtml(tr('th.task'))}</th>
          <th data-sort="priority" class="${sortMark('priority')}">${escHtml(tr('th.priority'))}</th>
          <th data-sort="deadline" class="${sortMark('deadline')}">${escHtml(tr('th.deadline'))}</th>
          <th>${escHtml(tr('th.status'))}</th>
          <th data-sort="created" class="${sortMark('created')}">${escHtml(tr('th.added'))}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
  board.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      document.getElementById('sort').value = th.dataset.sort;
      renderBoard();
    });
  });
  attachCardHandlers(false);
}

function tableRowHtml(t) {
  const col = getCol(t.col);
  const dl = formatDeadline(t.deadline, t.col === 'done');
  const createdStr = new Date(t.created).toLocaleDateString(localeFor(), { month: 'short', day: 'numeric' });
  const colChip = col
    ? `<span class="chip chip-col" style="background:${escHtml(col.color)}">${escHtml(col.name)}</span>`
    : `<span class="chip chip-deadline">—</span>`;
  const dlChip = dl
    ? `<span class="chip chip-deadline ${dl.cls}">${escHtml(dl.text)}</span>`
    : `<span class="chip chip-deadline">—</span>`;
  const descPlain = stripHtml(t.desc);
  const descHtml = descPlain ? `<div class="t-desc">${escHtml(descPlain)}</div>` : '';
  const stChip = subtaskChipHtml(t);
  const grp = (t.group && !groupBy) ? getGroup(t.group) : null;
  const groupChip = grp ? `<span class="chip chip-col" style="background:${escHtml(grp.color)}">${escHtml(grp.name)}</span>` : '';
  return `
    <tr class="t-row priority-${escHtml(t.priority)}" data-id="${escHtml(t.id)}">
      <td>
        <div class="t-title-row">
          <span class="t-title" data-edit="${escHtml(t.id)}">${escHtml(t.title)}</span>
          ${stChip}
          ${groupChip}
        </div>
        ${descHtml}
      </td>
      <td><span class="chip chip-prio" data-p="${escHtml(t.priority)}">${escHtml(prioLabel(t.priority))}</span></td>
      <td>${dlChip}</td>
      <td>${colChip}</td>
      <td style="color:var(--text-light);font-size:12px;">${createdStr}</td>
      <td class="t-actions">
        <button class="icon-btn" data-edit="${escHtml(t.id)}" title="${escHtml(tr('card.edit'))}"><i data-lucide="pencil"></i></button>
        <button class="icon-btn" data-del="${escHtml(t.id)}" title="${escHtml(tr('card.delete'))}"><i data-lucide="x"></i></button>
      </td>
    </tr>
  `;
}

// ---------- Card ----------
function cardHtml(t, showColumnChip) {
  const col = getCol(t.col);
  const colIdx = columns.findIndex(c => c.id === t.col);
  const dl = formatDeadline(t.deadline, t.col === 'done');
  const descPlain = stripHtml(t.desc);
  const descHtml = descPlain ? `<div class="card-desc">${escHtml(descPlain)}</div>` : '';
  const dlChip = dl ? `<span class="chip chip-deadline ${dl.cls}">${escHtml(dl.text)}</span>` : '';
  const colChip = (showColumnChip && col)
    ? `<span class="chip chip-col" style="background:${escHtml(col.color)}">${escHtml(col.name)}</span>` : '';
  const stChip = subtaskChipHtml(t);
  const grp = (t.group && !groupBy) ? getGroup(t.group) : null;
  const groupChip = grp ? `<span class="chip chip-col" style="background:${escHtml(grp.color)}">${escHtml(grp.name)}</span>` : '';
  const prevBtn = colIdx > 0
    ? `<button class="icon-btn" data-move="prev" data-id="${escHtml(t.id)}" title="${escHtml(tr('card.moveLeft'))}"><i data-lucide="chevron-left"></i></button>` : '';
  const nextBtn = colIdx > -1 && colIdx < columns.length - 1
    ? `<button class="icon-btn" data-move="next" data-id="${escHtml(t.id)}" title="${escHtml(tr('card.moveRight'))}"><i data-lucide="chevron-right"></i></button>` : '';
  const draggable = currentView === 'kanban' ? 'draggable="true"' : '';
  return `
    <article class="card priority-${escHtml(t.priority)}" ${draggable} data-id="${escHtml(t.id)}">
      <div class="card-title" data-edit="${escHtml(t.id)}">${escHtml(t.title)}</div>
      ${descHtml}
      <div class="card-meta">
        <span class="chip chip-prio" data-p="${escHtml(t.priority)}">${escHtml(prioLabel(t.priority))}</span>
        ${dlChip}
        ${stChip}
        ${groupChip}
        ${colChip}
      </div>
      <div class="card-actions">
        ${prevBtn}${nextBtn}
        <button class="icon-btn" data-edit="${escHtml(t.id)}" title="${escHtml(tr('card.edit'))}"><i data-lucide="pencil"></i></button>
        <button class="icon-btn" data-del="${escHtml(t.id)}" title="${escHtml(tr('card.delete'))}"><i data-lucide="x"></i></button>
      </div>
    </article>
  `;
}

// ---------- Overview ----------
function renderOverview() {
  const counts = {};
  columns.forEach(c => counts[c.id] = 0);
  tasks.forEach(t => { if (counts[t.col] != null) counts[t.col]++; });
  document.getElementById('overview').innerHTML = columns.map(c => `
    <div class="overview-row" style="background:${escHtml(c.color)}">
      <span>${escHtml(c.name)}</span>
      <span class="count">${counts[c.id] || 0}</span>
    </div>
  `).join('');
}

// ---------- Groups list (sidebar) ----------
function renderGroupsList() {
  const el = document.getElementById('groups-list');
  if (!el) return;
  if (!groups.length) { el.innerHTML = '<div class="group-empty">' + escHtml(tr('groups.empty')) + '</div>'; return; }
  const counts = {};
  groups.forEach(g => counts[g.id] = 0);
  tasks.forEach(t => { if (t.group && counts[t.group] != null) counts[t.group]++; });
  el.innerHTML = groups.map(g => `
    <div class="group-item" data-edit-group="${escHtml(g.id)}">
      <span class="g-dot" style="background:${escHtml(g.color)}"></span>
      <span class="g-name">${escHtml(g.name)}</span>
      <span class="group-count">${counts[g.id] || 0}</span>
      <button class="g-edit" data-edit-group="${escHtml(g.id)}" title="${escHtml(tr('group.edit'))}"><i data-lucide="more-horizontal"></i></button>
    </div>
  `).join('');
  el.querySelectorAll('[data-edit-group]').forEach(node => {
    node.addEventListener('click', e => { e.stopPropagation(); openGroupModal(node.dataset.editGroup); });
  });
}

// ============================================================
//  Card drag-and-drop (within / between columns)
// ============================================================
function ensureIndicator() {
  if (!dragIndicator) {
    dragIndicator = document.createElement('div');
    dragIndicator.className = 'drop-indicator';
  }
  return dragIndicator;
}
function removeIndicator() {
  if (dragIndicator && dragIndicator.parentNode) dragIndicator.parentNode.removeChild(dragIndicator);
}
function getInsertionPoint(colBody, clientY) {
  const cards = [...colBody.querySelectorAll('.card:not(.dragging)')];
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return card;
  }
  return null;
}
function moveTask(taskId, targetColId, beforeCardId) {
  const taskIdx = tasks.findIndex(t => t.id === taskId);
  if (taskIdx < 0) return;
  const [task] = tasks.splice(taskIdx, 1);
  task.col = targetColId;
  markCompletion(task);
  if (beforeCardId) {
    const refIdx = tasks.findIndex(t => t.id === beforeCardId);
    if (refIdx >= 0) { tasks.splice(refIdx, 0, task); }
    else tasks.push(task);
  } else {
    let lastIdx = -1;
    for (let i = 0; i < tasks.length; i++) if (tasks[i].col === targetColId) lastIdx = i;
    if (lastIdx >= 0) tasks.splice(lastIdx + 1, 0, task);
    else tasks.push(task);
  }
  saveTasks();
}

// ============================================================
//  Column drag-and-drop
// ============================================================
function showColumnIndicator(board, beforeCol) {
  removeColumnIndicator();
  const ind = document.createElement('div');
  ind.className = 'col-drop-indicator';
  if (beforeCol) board.insertBefore(ind, beforeCol);
  else board.appendChild(ind);
}
function removeColumnIndicator() {
  document.querySelectorAll('.col-drop-indicator').forEach(el => el.remove());
}
function reorderColumn(draggedId, beforeColId) {
  const idx = columns.findIndex(c => c.id === draggedId);
  if (idx < 0) return;
  const [col] = columns.splice(idx, 1);
  if (beforeColId) {
    const ref = columns.findIndex(c => c.id === beforeColId);
    if (ref >= 0) columns.splice(ref, 0, col);
    else columns.push(col);
  } else {
    columns.push(col);
  }
  saveColumns();
}

// ============================================================
//  Handlers
// ============================================================
function attachCardHandlers(isKanban) {
  document.querySelectorAll('[data-edit]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      openTaskModal(el.dataset.edit);
    });
  });
  document.querySelectorAll('[data-del]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const id = el.dataset.del;
      const t = tasks.find(x => x.id === id);
      if (t && confirm(tr('confirm.delTask').replace('{name}', t.title))) {
        tasks = tasks.filter(x => x.id !== id);
        saveTasks(); renderBoard();
      }
    });
  });
  document.querySelectorAll('[data-move]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const t = tasks.find(x => x.id === el.dataset.id);
      if (!t) return;
      const idx = columns.findIndex(c => c.id === t.col);
      const newIdx = idx + (el.dataset.move === 'next' ? 1 : -1);
      if (newIdx < 0 || newIdx >= columns.length) return;
      t.col = columns[newIdx].id;
      markCompletion(t);
      saveTasks(); renderBoard();
    });
  });
  if (!isKanban) return;
  document.querySelectorAll('[data-add-col]').forEach(el => {
    el.addEventListener('click', () => {
      document.getElementById('s-col').value = el.dataset.addCol;
      document.getElementById('s-title').focus();
      openSidebarIfMobile();
    });
  });
  // Card drag
  document.querySelectorAll('.card[draggable="true"]').forEach(card => {
    card.addEventListener('dragstart', e => {
      dragKind = 'card';
      card.classList.add('dragging');
      e.dataTransfer.setData('text/plain', card.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      removeIndicator();
      document.querySelectorAll('.col-body.drag-over').forEach(b => b.classList.remove('drag-over'));
      dragTarget = { colId: null, beforeCardId: null };
      dragKind = null;
    });
  });
  document.querySelectorAll('[data-col-body]').forEach(body => {
    body.addEventListener('dragover', e => {
      if (dragKind !== 'card') return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      body.classList.add('drag-over');
      document.querySelectorAll('.col-body.drag-over').forEach(b => {
        if (b !== body) b.classList.remove('drag-over');
      });
      const afterCard = getInsertionPoint(body, e.clientY);
      const ind = ensureIndicator();
      if (afterCard) afterCard.parentNode.insertBefore(ind, afterCard);
      else body.appendChild(ind);
      dragTarget = {
        colId: body.dataset.colBody,
        beforeCardId: afterCard ? afterCard.dataset.id : null,
      };
    });
    body.addEventListener('dragleave', e => {
      if (!body.contains(e.relatedTarget)) body.classList.remove('drag-over');
    });
    body.addEventListener('drop', e => {
      if (dragKind !== 'card') return;
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      if (!id) return;
      const sortEl = document.getElementById('sort');
      if (sortEl.value !== 'manual') sortEl.value = 'manual';
      moveTask(id, dragTarget.colId || body.dataset.colBody, dragTarget.beforeCardId);
      removeIndicator();
      body.classList.remove('drag-over');
      dragTarget = { colId: null, beforeCardId: null };
      renderBoard();
    });
  });
}

function attachColumnHandlers() {
  // Edit column menu button
  document.querySelectorAll('[data-edit-col]').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); openColumnModal(el.dataset.editCol); });
  });
  // Column drag (header is the handle)
  document.querySelectorAll('[data-col-header]').forEach(header => {
    header.addEventListener('dragstart', e => {
      // Ignore drags that originate from the menu button
      if (e.target.closest('.col-menu-btn')) { e.preventDefault(); return; }
      dragKind = 'column';
      columnDragId = header.dataset.colHeader;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'column:' + columnDragId);
      header.closest('.col').classList.add('col-dragging');
    });
    header.addEventListener('dragend', () => {
      document.querySelectorAll('.col-dragging').forEach(c => c.classList.remove('col-dragging'));
      removeColumnIndicator();
      columnDragId = null;
      dragKind = null;
    });
  });
}

// Board-level column drag handlers — attached ONCE at boot
function attachBoardDragHandlers() {
  const board = document.getElementById('board');
  board.addEventListener('dragover', e => {
    if (dragKind !== 'column') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const cols = [...board.querySelectorAll('.col:not(.col-dragging)')];
    let target = null;
    for (const c of cols) {
      const rect = c.getBoundingClientRect();
      if (e.clientX < rect.left + rect.width / 2) { target = c; break; }
    }
    showColumnIndicator(board, target);
  });
  board.addEventListener('drop', e => {
    if (dragKind !== 'column') return;
    e.preventDefault();
    const indicator = board.querySelector('.col-drop-indicator');
    const next = indicator ? indicator.nextElementSibling : null;
    const beforeColId = (next && next.classList && next.classList.contains('col')) ? next.dataset.col : null;
    reorderColumn(columnDragId, beforeColId);
    removeColumnIndicator();
    renderBoard();
  });
  // Collapse / expand group sections (delegated; data-group only on headers/group-rows)
  board.addEventListener('click', e => {
    const gh = e.target.closest('.group-header, tr.group-row');
    if (!gh || !board.contains(gh)) return;
    const gkey = gh.getAttribute('data-gkey');
    if (gkey === null) return;
    if (collapsedGroups.has(gkey)) collapsedGroups.delete(gkey);
    else collapsedGroups.add(gkey);
    saveCollapsed();
    renderBoard();
  });
}

// ============================================================
//  Priority toggle (shared)
// ============================================================
function setupPrioGrid(containerId, setter) {
  const c = document.getElementById(containerId);
  c.addEventListener('click', e => {
    const btn = e.target.closest('.prio-btn');
    if (!btn) return;
    c.querySelectorAll('.prio-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setter(btn.dataset.p);
  });
}

// ============================================================
//  Sidebar form
// ============================================================
function refreshColumnSelects() {
  const opts = columns.map(c => `<option value="${escHtml(c.id)}">${escHtml(c.name)}</option>`).join('');
  const s = document.getElementById('s-col');
  const prev = s.value;
  s.innerHTML = opts;
  if (columns.find(c => c.id === prev)) s.value = prev;
  const m = document.getElementById('m-col');
  if (m) {
    const prevM = m.value;
    m.innerHTML = opts;
    if (columns.find(c => c.id === prevM)) m.value = prevM;
  }
}
function setupSidebar() {
  setupPrioGrid('s-prio', v => sideSelectedPrio = v);
  const form = document.getElementById('side-form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const title = document.getElementById('s-title').value.trim();
    if (!title) return;
    tasks.push({
      id: uid(),
      title,
      desc: document.getElementById('s-desc').value.trim(),
      priority: sideSelectedPrio,
      deadline: document.getElementById('s-deadline').value || null,
      col: document.getElementById('s-col').value,
      created: Date.now(),
      subtasks: [],
    });
    saveTasks(); renderBoard();
    form.reset();
    sideSelectedPrio = 'Medium';
    document.querySelectorAll('#s-prio .prio-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.p === 'Medium');
    });
    refreshColumnSelects();
  });
  document.getElementById('s-title').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); }
  });
  document.getElementById('add-col-side').addEventListener('click', () => openColumnModal(null));
}

// ============================================================
//  Subtask management (inside task modal)
// ============================================================
function renderModalSubtasks() {
  const container = document.getElementById('m-subtasks-list');
  if (!container) return;
  const done = modalSubtasks.filter(s => s.done).length;
  const total = modalSubtasks.length;
  document.getElementById('m-subtask-meta').textContent = total ? (done + ' ' + tr('m.of') + ' ' + total + ' ' + tr('m.done')) : '';

  if (total === 0) {
    container.innerHTML = '<div class="subtask-empty">' + escHtml(tr('m.noSubtasks')) + '</div>';
    return;
  }
  container.innerHTML = modalSubtasks.map((st, i) => `
    <div class="subtask-row" data-idx="${i}">
      <input type="checkbox" class="subtask-check" ${st.done ? 'checked' : ''}>
      <input type="text" class="subtask-text ${st.done ? 'done' : ''}" value="${escHtml(st.text)}" placeholder="${escHtml(tr('m.subPlaceholder'))}">
      <button type="button" class="subtask-del" title="${escHtml(tr('m.remove'))}"><i data-lucide="x"></i></button>
    </div>
  `).join('');
  refreshIcons();
}

function setupSubtaskHandlers() {
  const container = document.getElementById('m-subtasks-list');
  container.addEventListener('change', e => {
    if (e.target.classList.contains('subtask-check')) {
      const row = e.target.closest('.subtask-row');
      const idx = parseInt(row.dataset.idx);
      modalSubtasks[idx].done = e.target.checked;
      row.querySelector('.subtask-text').classList.toggle('done', e.target.checked);
      const done = modalSubtasks.filter(s => s.done).length;
      const total = modalSubtasks.length;
      document.getElementById('m-subtask-meta').textContent = total ? (done + ' ' + tr('m.of') + ' ' + total + ' ' + tr('m.done')) : '';
    }
  });
  container.addEventListener('input', e => {
    if (e.target.classList.contains('subtask-text')) {
      const row = e.target.closest('.subtask-row');
      const idx = parseInt(row.dataset.idx);
      modalSubtasks[idx].text = e.target.value;
    }
  });
  container.addEventListener('keydown', e => {
    if (e.target.classList.contains('subtask-text') && e.key === 'Enter') {
      e.preventDefault();
      modalSubtasks.push({ id: uid(), text: '', done: false });
      renderModalSubtasks();
      const inputs = container.querySelectorAll('.subtask-text');
      if (inputs.length) inputs[inputs.length - 1].focus();
    }
  });
  container.addEventListener('click', e => {
    const delBtn = e.target.closest('.subtask-del');
    if (delBtn) {
      const idx = parseInt(delBtn.closest('.subtask-row').dataset.idx);
      modalSubtasks.splice(idx, 1);
      renderModalSubtasks();
    }
  });
  document.getElementById('m-add-subtask').addEventListener('click', () => {
    modalSubtasks.push({ id: uid(), text: '', done: false });
    renderModalSubtasks();
    const inputs = container.querySelectorAll('.subtask-text');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });
}

// ============================================================
//  Task modal
// ============================================================
function openTaskModal(id) {
  editingTaskId = id || null;
  const t = id ? tasks.find(x => x.id === id) : null;
  modalSelectedPrio = t ? t.priority : 'Medium';
  modalSubtasks = t && Array.isArray(t.subtasks)
    ? t.subtasks.map(s => ({ ...s }))
    : [];
  const colOpts = columns.map(c =>
    `<option value="${escHtml(c.id)}" ${t && t.col===c.id ? 'selected' : ''}>${escHtml(c.name)}</option>`
  ).join('');
  const tGroup = t ? (t.group || '') : '';
  const groupOpts = `<option value="" ${tGroup==='' ? 'selected' : ''}>${escHtml(tr('m.noGroup'))}</option>` +
    groups.map(g => `<option value="${escHtml(g.id)}" ${tGroup===g.id ? 'selected' : ''}>${escHtml(g.name)}</option>`).join('');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal modal-lg" role="dialog" aria-modal="true">
      <h2>${t ? escHtml(tr('m.editTask')) : escHtml(tr('m.newTask'))}</h2>
      <form id="m-form" autocomplete="off">
        <div class="field">
          <label for="m-title">${escHtml(tr('m.taskName'))}</label>
          <input type="text" id="m-title" required value="${t ? escHtml(t.title) : ''}">
        </div>
        <div class="field">
          <label>${escHtml(tr('m.desc'))}</label>
          ${richEditorMarkup('m-desc')}
        </div>
        <div class="field">
          <label>${escHtml(tr('m.priority'))}</label>
          <div class="prio-grid" id="m-prio">
            <button type="button" class="prio-btn ${modalSelectedPrio==='Critical'?'active':''}" data-p="Critical">${escHtml(prioLabel('Critical'))}</button>
            <button type="button" class="prio-btn ${modalSelectedPrio==='High'?'active':''}"     data-p="High">${escHtml(prioLabel('High'))}</button>
            <button type="button" class="prio-btn ${modalSelectedPrio==='Medium'?'active':''}"   data-p="Medium">${escHtml(prioLabel('Medium'))}</button>
            <button type="button" class="prio-btn ${modalSelectedPrio==='Low'?'active':''}"      data-p="Low">${escHtml(prioLabel('Low'))}</button>
          </div>
        </div>
        <div class="field">
          <label for="m-deadline">${escHtml(tr('m.deadline'))}</label>
          <input type="date" id="m-deadline" value="${t && t.deadline ? escHtml(t.deadline) : ''}">
        </div>
        <div class="field">
          <label for="m-col">${escHtml(tr('m.column'))}</label>
          <select id="m-col">${colOpts}</select>
        </div>
        <div class="field">
          <label for="m-group">${escHtml(tr('m.group'))}</label>
          <select id="m-group">${groupOpts}</select>
        </div>
        <div class="field">
          <div class="field-label-row">
            <label>${escHtml(tr('m.subtasks'))}</label>
            <span class="field-meta" id="m-subtask-meta"></span>
          </div>
          <div class="subtask-list" id="m-subtasks-list"></div>
          <button type="button" class="add-subtask-btn" id="m-add-subtask">${escHtml(tr('m.addSubtask'))}</button>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="m-cancel">${escHtml(tr('m.cancel'))}</button>
          <button type="submit" class="btn-primary">${escHtml(tr('m.save'))}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);
  document.getElementById('m-title').focus();
  setupPrioGrid('m-prio', v => modalSelectedPrio = v);
  // Init rich description editor
  const descEditor = document.getElementById('m-desc');
  const existingDesc = t ? (t.desc || '') : '';
  if (isHtmlContent(existingDesc)) descEditor.innerHTML = existingDesc;
  else descEditor.textContent = existingDesc;
  setupRichEditor(descEditor, document.getElementById('m-desc-toolbar'));
  renderModalSubtasks();
  setupSubtaskHandlers();
  refreshIcons();

  function close() {
    if (backdrop.parentNode) document.body.removeChild(backdrop);
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  document.getElementById('m-cancel').addEventListener('click', close);

  document.getElementById('m-form').addEventListener('submit', e => {
    e.preventDefault();
    const cleanedSubtasks = modalSubtasks
      .filter(s => s.text.trim())
      .map(s => ({ id: s.id, text: s.text.trim(), done: !!s.done }));
    const data = {
      title:    document.getElementById('m-title').value.trim(),
      desc:     richToStored(document.getElementById('m-desc')),
      priority: modalSelectedPrio,
      deadline: document.getElementById('m-deadline').value || null,
      col:      document.getElementById('m-col').value,
      group:    document.getElementById('m-group').value,
      subtasks: cleanedSubtasks,
    };
    if (!data.title) return;
    if (editingTaskId) {
      const t = tasks.find(x => x.id === editingTaskId);
      if (t) { Object.assign(t, data); markCompletion(t); }
    } else {
      const nt = { id: uid(), created: Date.now(), ...data }; markCompletion(nt); tasks.push(nt);
    }
    saveTasks(); renderBoard();
    close();
  });
}

// ============================================================
//  Column modal
// ============================================================
function openColumnModal(id) {
  editingColId = id || null;
  const col = id ? columns.find(c => c.id === id) : null;
  modalSelectedColor = col ? col.color : PALETTE[Math.floor(Math.random() * PALETTE.length)];
  const swatches = PALETTE.map(c =>
    `<button type="button" class="swatch ${c.toLowerCase() === modalSelectedColor.toLowerCase() ? 'active' : ''}" style="background:${c}" data-swatch="${c}"></button>`
  ).join('');
  const deleteBtn = col
    ? `<button type="button" class="btn-danger danger" id="c-delete">${escHtml(tr('c.delete'))}</button>`
    : '';
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h2>${col ? escHtml(tr('c.editCol')) : escHtml(tr('c.newCol'))}</h2>
      <form id="c-form" autocomplete="off">
        <div class="field">
          <label for="c-name">${escHtml(tr('c.name'))}</label>
          <input type="text" id="c-name" required value="${col ? escHtml(col.name) : ''}">
        </div>
        <div class="field">
          <label>${escHtml(tr('c.color'))}</label>
          <div class="color-row">
            <input type="color" id="c-color" value="${modalSelectedColor}">
            <div class="swatches" id="c-swatches">${swatches}</div>
          </div>
        </div>
        <div class="modal-actions">
          ${deleteBtn}
          <button type="button" class="btn-secondary" id="c-cancel">${escHtml(tr('m.cancel'))}</button>
          <button type="submit" class="btn-primary">${escHtml(tr('m.save'))}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);
  document.getElementById('c-name').focus();

  function setColor(hex) {
    modalSelectedColor = hex;
    document.getElementById('c-color').value = hex;
    document.querySelectorAll('#c-swatches .swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.swatch.toLowerCase() === hex.toLowerCase());
    });
  }
  document.getElementById('c-swatches').addEventListener('click', e => {
    const sw = e.target.closest('.swatch');
    if (sw) setColor(sw.dataset.swatch);
  });
  document.getElementById('c-color').addEventListener('input', e => setColor(e.target.value));

  function close() {
    if (backdrop.parentNode) document.body.removeChild(backdrop);
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  document.getElementById('c-cancel').addEventListener('click', close);

  if (col) {
    document.getElementById('c-delete').addEventListener('click', () => {
      if (columns.length <= 1) {
        alert(tr('c.cantDeleteLast'));
        return;
      }
      const taskCount = tasks.filter(t => t.col === col.id).length;
      const firstOther = columns.find(c => c.id !== col.id);
      const msg = taskCount
        ? tr('c.confirmDelMove').replace('{name}', col.name).replace('{n}', taskCount).replace('{other}', firstOther.name)
        : tr('c.confirmDel').replace('{name}', col.name);
      if (!confirm(msg)) return;
      tasks.forEach(t => { if (t.col === col.id) t.col = firstOther.id; });
      columns = columns.filter(c => c.id !== col.id);
      filters.cols.delete(col.id);
      saveColumns(); saveTasks();
      refreshColumnSelects();
      renderBoard();
      close();
    });
  }

  document.getElementById('c-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('c-name').value.trim();
    if (!name) return;
    if (col) {
      col.name  = name;
      col.color = modalSelectedColor;
    } else {
      const newCol = { id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
                       name, color: modalSelectedColor };
      columns.push(newCol);
      filters.cols.add(newCol.id);
    }
    saveColumns();
    refreshColumnSelects();
    renderBoard();
    close();
  });
}

// ============================================================
//  Group modal (create / edit / delete)
// ============================================================
function openGroupModal(id) {
  editingGroupId = id || null;
  const grp = id ? groups.find(g => g.id === id) : null;
  modalSelectedColor = grp ? grp.color : PALETTE[Math.floor(Math.random() * PALETTE.length)];
  const swatches = PALETTE.map(c =>
    `<button type="button" class="swatch ${c.toLowerCase() === modalSelectedColor.toLowerCase() ? 'active' : ''}" style="background:${c}" data-swatch="${c}"></button>`
  ).join('');
  const deleteBtn = grp ? `<button type="button" class="btn-danger danger" id="g-delete">${escHtml(tr('g.delete'))}</button>` : '';
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h2>${grp ? escHtml(tr('g.editGroup')) : escHtml(tr('g.newGroup'))}</h2>
      <form id="g-form" autocomplete="off">
        <div class="field">
          <label for="g-name">${escHtml(tr('c.name'))}</label>
          <input type="text" id="g-name" required value="${grp ? escHtml(grp.name) : ''}">
        </div>
        <div class="field">
          <label>${escHtml(tr('c.color'))}</label>
          <div class="color-row">
            <input type="color" id="g-color" value="${modalSelectedColor}">
            <div class="swatches" id="g-swatches">${swatches}</div>
          </div>
        </div>
        <div class="modal-actions">
          ${deleteBtn}
          <button type="button" class="btn-secondary" id="g-cancel">${escHtml(tr('m.cancel'))}</button>
          <button type="submit" class="btn-primary">${escHtml(tr('m.save'))}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);
  document.getElementById('g-name').focus();

  function setColor(hex) {
    modalSelectedColor = hex;
    document.getElementById('g-color').value = hex;
    document.querySelectorAll('#g-swatches .swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.swatch.toLowerCase() === hex.toLowerCase());
    });
  }
  document.getElementById('g-swatches').addEventListener('click', e => {
    const sw = e.target.closest('.swatch');
    if (sw) setColor(sw.dataset.swatch);
  });
  document.getElementById('g-color').addEventListener('input', e => setColor(e.target.value));

  function close() {
    if (backdrop.parentNode) document.body.removeChild(backdrop);
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  document.getElementById('g-cancel').addEventListener('click', close);

  if (grp) {
    document.getElementById('g-delete').addEventListener('click', () => {
      const n = tasks.filter(t => t.group === grp.id).length;
      if (!confirm(tr('g.confirmDel').replace('{name}', grp.name) + (n ? tr('g.confirmDelTasks').replace('{n}', n) : ''))) return;
      tasks.forEach(t => { if (t.group === grp.id) t.group = ''; });
      groups = groups.filter(g => g.id !== grp.id);
      filters.groups.delete(grp.id);
      saveGroups(); saveTasks();
      renderBoard();
      close();
    });
  }

  document.getElementById('g-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('g-name').value.trim();
    if (!name) return;
    if (grp) {
      grp.name = name;
      grp.color = modalSelectedColor;
    } else {
      const ng = { id: 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2,6), name, color: modalSelectedColor };
      groups.push(ng);
      filters.groups.add(ng.id);
    }
    saveGroups();
    renderBoard();
    close();
  });
}

// ============================================================
//  Filter popover
// ============================================================
function renderFilterPopover() {
  const prioOptions = PRIORITIES.map(p => `
    <label class="filter-option">
      <input type="checkbox" data-filter-prio="${p}" ${filters.priorities.has(p) ? 'checked' : ''}>
      <span class="col-dot" style="background:${
        p==='Critical'?'#e2445c':p==='High'?'#fdab3d':p==='Medium'?'#579bfc':'#00c875'}"></span>
      ${escHtml(prioLabel(p))}
    </label>
  `).join('');
  const colOptions = columns.map(c => `
    <label class="filter-option">
      <input type="checkbox" data-filter-col="${escHtml(c.id)}" ${filters.cols.has(c.id) ? 'checked' : ''}>
      <span class="col-dot" style="background:${escHtml(c.color)}"></span>
      ${escHtml(c.name)}
    </label>
  `).join('');
  const dlOpt = (val, lbl) => `
    <label class="filter-option">
      <input type="radio" name="filter-dl" value="${val}" ${filters.deadline===val?'checked':''}>
      ${lbl}
    </label>
  `;
  const groupOptions = (groups.length ? groups.map(g => `
    <label class="filter-option">
      <input type="checkbox" data-filter-group="${escHtml(g.id)}" ${filters.groups.has(g.id) ? 'checked' : ''}>
      <span class="col-dot" style="background:${escHtml(g.color)}"></span>
      ${escHtml(g.name)}
    </label>
  `).join('') : '') + `
    <label class="filter-option">
      <input type="checkbox" data-filter-group="" ${filters.groups.has('') ? 'checked' : ''}>
      <span class="col-dot" style="background:#9aa0b0"></span>
      ${escHtml(tr('f.noGroup'))}
    </label>`;
  return `
    <h4>${escHtml(tr('f.priority'))}</h4>${prioOptions}
    <h4>${escHtml(tr('f.status'))}</h4>${colOptions}
    <h4>${escHtml(tr('f.group'))}</h4>${groupOptions}
    <h4>${escHtml(tr('f.deadline'))}</h4>
    ${dlOpt('all',escHtml(tr('f.any')))}
    ${dlOpt('overdue',escHtml(tr('f.overdue')))}
    ${dlOpt('this_week',escHtml(tr('f.next7')))}
    ${dlOpt('later',escHtml(tr('f.later')))}
    ${dlOpt('none',escHtml(tr('f.none')))}
    <div class="filter-actions">
      <button type="button" class="btn-text" id="filter-clear">${escHtml(tr('f.clear'))}</button>
      <button type="button" class="btn-primary" id="filter-close" style="padding:6px 14px;">${escHtml(tr('f.done'))}</button>
    </div>
  `;
}
function openFilterPopover() {
  const pop = document.getElementById('filter-popover');
  pop.innerHTML = renderFilterPopover();
  pop.hidden = false;
  pop.querySelectorAll('[data-filter-prio]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) filters.priorities.add(cb.dataset.filterPrio);
      else filters.priorities.delete(cb.dataset.filterPrio);
      renderBoard();
    });
  });
  pop.querySelectorAll('[data-filter-col]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) filters.cols.add(cb.dataset.filterCol);
      else filters.cols.delete(cb.dataset.filterCol);
      renderBoard();
    });
  });
  pop.querySelectorAll('[data-filter-group]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.filterGroup;
      if (cb.checked) filters.groups.add(id);
      else filters.groups.delete(id);
      renderBoard();
    });
  });
  pop.querySelectorAll('[name="filter-dl"]').forEach(r => {
    r.addEventListener('change', () => {
      filters.deadline = r.value;
      renderBoard();
    });
  });
  document.getElementById('filter-clear').addEventListener('click', () => {
    resetFilters();
    openFilterPopover();
    renderBoard();
  });
  document.getElementById('filter-close').addEventListener('click', closeFilterPopover);
}
function closeFilterPopover() {
  document.getElementById('filter-popover').hidden = true;
}
function refreshFilterBadge() {
  const n = activeFilterCount();
  const badge = document.getElementById('filter-badge');
  if (n > 0) { badge.hidden = false; badge.textContent = n; }
  else { badge.hidden = true; }
}

// ============================================================
//  Export
// ============================================================
function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function dateStamp() {
  const d = new Date();
  return d.getFullYear() + '-' +
         String(d.getMonth()+1).padStart(2,'0') + '-' +
         String(d.getDate()).padStart(2,'0');
}
function exportJSON() {
  const payload = {
    exportedAt: new Date().toISOString(),
    columns: columns.map(c => ({ id: c.id, name: c.name, color: c.color })),
    groups:  groups.map(g => ({ id: g.id, name: g.name, color: g.color })),
    tasks:   tasks.map(t => ({ ...t })),
  };
  download('task-board-' + dateStamp() + '.json', JSON.stringify(payload, null, 2), 'application/json');
}
function csvEscape(s) {
  if (s == null) return '';
  s = String(s);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function exportCSV() {
  const header = ['Title','Description','Priority','Deadline','Status','Subtasks','Created'];
  const rows = tasks.map(t => {
    const col = getCol(t.col);
    const { done, total } = subtaskCounts(t);
    const subStr = total
      ? `${done}/${total}: ` + (t.subtasks || []).map(s => (s.done ? '✓ ' : '○ ') + s.text).join(' | ')
      : '';
    return [
      t.title,
      t.desc || '',
      t.priority,
      t.deadline || '',
      col ? col.name : t.col,
      subStr,
      new Date(t.created).toISOString().slice(0,10),
    ].map(csvEscape).join(',');
  });
  const csv = '\uFEFF' + [header.join(','), ...rows].join('\n');
  download('task-board-' + dateStamp() + '.csv', csv, 'text/csv;charset=utf-8');
}

// ============================================================
//  Sidebar drawer (mobile)
// ============================================================
function isDrawerMode() { return window.matchMedia('(max-width: 820px)').matches; }
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-backdrop').classList.add('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('open');
}
function openSidebarIfMobile() { if (isDrawerMode()) openSidebar(); }

// ============================================================
//  Topbar / subbar wiring
// ============================================================
function setupTopbar() {
  document.getElementById('open-modal').addEventListener('click', () => openTaskModal(null));

  document.getElementById('hamburger').addEventListener('click', e => {
    e.stopPropagation();
    const sidebar = document.getElementById('sidebar');
    if (sidebar.classList.contains('open')) closeSidebar();
    else openSidebar();
  });
  document.getElementById('sidebar-backdrop').addEventListener('click', closeSidebar);

  const exportBtn  = document.getElementById('export-btn');
  const exportMenu = document.getElementById('export-menu');
  exportBtn.addEventListener('click', e => {
    e.stopPropagation();
    exportMenu.hidden = !exportMenu.hidden;
  });
  exportMenu.querySelectorAll('[data-export]').forEach(b => {
    b.addEventListener('click', () => {
      exportMenu.hidden = true;
      if (b.dataset.export === 'json') exportJSON();
      else exportCSV();
    });
  });

  document.getElementById('search').addEventListener('input', renderBoard);
  document.getElementById('sort').addEventListener('change', renderBoard);

  document.getElementById('view-switch').addEventListener('click', e => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    currentView = btn.dataset.view;
    saveView();
    document.querySelectorAll('#view-switch button').forEach(b =>
      b.classList.toggle('active', b.dataset.view === currentView));
    renderBoard();
  });

  const filterBtn = document.getElementById('filter-btn');
  filterBtn.addEventListener('click', e => {
    e.stopPropagation();
    const pop = document.getElementById('filter-popover');
    if (pop.hidden) openFilterPopover(); else closeFilterPopover();
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#filter-popover') && !e.target.closest('#filter-btn')) closeFilterPopover();
    if (!e.target.closest('#export-menu') && !e.target.closest('#export-btn')) exportMenu.hidden = true;
  });

  window.addEventListener('resize', () => {
    if (!isDrawerMode()) {
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebar-backdrop').classList.remove('open');
    }
  });
}

// ============================================================
//  Supabase — cloud database (auth + sync + realtime)
// ============================================================
function setSyncStatus(status) {
  syncStatus = status;
  const dot = document.getElementById('sync-dot');
  if (!dot) return;
  dot.className = 'sync-dot' + (status === 'idle' ? '' : ' ' + status);
  const labels = {
    idle:   tr('sync.idle'),
    saving: tr('sync.saving'),
    synced: tr('sync.synced'),
    error:  tr('sync.error'),
  };
  dot.title = labels[status] || '';
}

function initSupabase() {
  const cfg = window.SUPABASE_CONFIG || {};
  const key = cfg.anonKey || cfg.publishableKey;   // accepts legacy anon OR new sb_publishable_ key
  if (!cfg.url || !key || /YOUR-/.test(cfg.url) || /YOUR-/.test(key)) return false;
  if (!window.supabase || !window.supabase.createClient) return false;
  sb = window.supabase.createClient(cfg.url, key, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return true;
}

// ---- (de)serialize between app shape and DB rows ----
function colToRow(c, i)   { return { id: c.id, user_id: USER_ID, name: c.name || '', color: c.color || '#6161ff', position: i }; }
function groupToRow(g, i) { return { id: g.id, user_id: USER_ID, name: g.name || '', color: g.color || '#6161ff', position: i }; }
function taskToRow(t, i) {
  const row = {
    id: t.id, user_id: USER_ID,
    title: t.title || '', description: t.desc || '',
    priority: t.priority || 'Medium',
    deadline: t.deadline || null,
    col_id: t.col || null,
    group_id: t.group ? t.group : null,
    position: i,
    subtasks: Array.isArray(t.subtasks) ? t.subtasks : [],
    created_at: new Date(t.created || Date.now()).toISOString(),
  };
  if (!tasksOmitCompleted) row.completed_at = t.completed ? new Date(t.completed).toISOString() : null;
  return row;
}
function rowToCol(r)   { return { id: r.id, name: r.name || '', color: r.color || '#6161ff' }; }
function rowToGroup(r) { return { id: r.id, name: r.name || '', color: r.color || '#6161ff' }; }
function rowToTask(r) {
  return {
    id: r.id, title: r.title || '', desc: r.description || '',
    priority: r.priority || 'Medium',
    deadline: r.deadline || null,
    col: r.col_id || '',
    group: r.group_id || '',
    created: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    completed: r.completed_at ? new Date(r.completed_at).getTime() : null,
    subtasks: Array.isArray(r.subtasks) ? r.subtasks : [],
  };
}

// ---- Pull everything (cloud is the source of truth) ----
// ============================================================
//  Preferences sync -> cloud (so nothing lives only in the browser)
// ============================================================
let prefsTableMissing = false;
let applyingPrefs = false;
function collectPrefs() {
  return {
    theme: document.documentElement.getAttribute('data-theme') || 'light',
    lang: lang,
    view: currentView,
    groupBy: !!groupBy,
    collapsed: [...collapsedGroups],
    notesSort: notesSort,
    deckSort: deckSort,
    noteMode: noteMode,
    noteFocus: !!noteFocus,
    graphNodeSize: graphNodeSize,
    graphNodeColor: graphNodeColor,
    graphNodes: graphNodeOverrides,
    graphPos: graphPositions,
    anConfig: anConfig,
    hiddenCols: [...hiddenCols],
    sidebarHidden: !!sidebarHidden,
    avatar: avatarUrl || ''
  };
}
function syncViewButtons() {
  document.querySelectorAll('#view-switch button').forEach(b => b.classList.toggle('active', b.dataset.view === currentView));
}
function applyPrefs(p) {
  if (!p || typeof p !== 'object') return;
  applyingPrefs = true;
  try {
    if (typeof p.lang === 'string' && p.lang !== lang) setLang(p.lang);
    if (typeof p.groupBy === 'boolean') groupBy = p.groupBy;
    if (Array.isArray(p.collapsed)) collapsedGroups = new Set(p.collapsed);
    if (typeof p.notesSort === 'string') notesSort = p.notesSort;
    if (typeof p.deckSort === 'string') deckSort = p.deckSort;
    if (typeof p.noteMode === 'string') noteMode = p.noteMode;
    if (typeof p.noteFocus === 'boolean') noteFocus = p.noteFocus;
    if (typeof p.graphNodeSize === 'number') graphNodeSize = p.graphNodeSize;
    if (typeof p.graphNodeColor === 'string') graphNodeColor = p.graphNodeColor;
    if (p.graphNodes && typeof p.graphNodes === 'object') graphNodeOverrides = p.graphNodes;
    if (p.graphPos && typeof p.graphPos === 'object') graphPositions = p.graphPos;
    if (p.anConfig && typeof p.anConfig === 'object') anConfig = p.anConfig;
    if (Array.isArray(p.hiddenCols)) hiddenCols = new Set(p.hiddenCols);
    if (typeof p.sidebarHidden === 'boolean') { sidebarHidden = p.sidebarHidden; applySidebarState(); }
    if (typeof p.view === 'string') currentView = p.view;
    if (typeof p.avatar === 'string') {
      avatarUrl = p.avatar;
      try { if (USER_ID) { if (avatarUrl) localStorage.setItem('tb_' + USER_ID + '_avatar', avatarUrl); else localStorage.removeItem('tb_' + USER_ID + '_avatar'); } } catch (e) {}
      refreshAccountMenu();
    }
    if (typeof p.theme === 'string') applyTheme(p.theme);
    syncViewButtons();
    try {
      localStorage.setItem(STORE_LANG, lang);
      localStorage.setItem(STORE_VIEW, currentView);
      localStorage.setItem(STORE_GROUPBY, groupBy ? '1' : '0');
      localStorage.setItem(STORE_COLLAPSED, JSON.stringify([...collapsedGroups]));
      localStorage.setItem('tb_notes_sort', notesSort);
      localStorage.setItem('tb_deck_sort', deckSort);
      localStorage.setItem('tb_note_mode', noteMode);
      localStorage.setItem('tb_note_focus', noteFocus ? '1' : '0');
      localStorage.setItem('tb_graph_size', String(graphNodeSize));
      localStorage.setItem('tb_graph_color', graphNodeColor);
      localStorage.setItem('tb_graph_nodes', JSON.stringify(graphNodeOverrides));
      localStorage.setItem('tb_graph_pos', JSON.stringify(graphPositions));
      localStorage.setItem('tb_an_config', JSON.stringify(anConfig));
      localStorage.setItem('tb_hidden_cols', JSON.stringify([...hiddenCols]));
      localStorage.setItem('tb_sidebar_hidden', sidebarHidden ? '1' : '0');
    } catch (e) {}
  } finally { applyingPrefs = false; }
}
function markPrefsDirty() { if (applyingPrefs) return; scheduleCloudSave('prefs'); }
async function pushPrefs() {
  const { error } = await sb.from('preferences').upsert({ user_id: USER_ID, data: collectPrefs() });
  if (error) throw error;
}

async function pullAll() {
  if (!sb || !USER_ID) return;
  const [c, g, t] = await Promise.all([
    sb.from('columns').select('*').eq('user_id', USER_ID).order('position', { ascending: true }),
    sb.from('groups').select('*').eq('user_id', USER_ID).order('position', { ascending: true }),
    sb.from('tasks').select('*').eq('user_id', USER_ID).order('position', { ascending: true }),
  ]);
  if (c.error) throw c.error;
  if (g.error) throw g.error;
  if (t.error) throw t.error;
  columns = (c.data || []).map(rowToCol);
  groups  = (g.data || []).map(rowToGroup);
  tasks   = (t.data || []).map(rowToTask);
  cacheSet('columns', columns); cacheSet('groups', groups); cacheSet('tasks', tasks);
  // notes live in an optional table; a missing table must not break the rest
  try {
    const nres = await sb.from('notes').select('*').eq('user_id', USER_ID).order('position', { ascending: true });
    if (nres.error) throw nres.error;
    notes = (nres.data || []).map(rowToNote);
    notesTableMissing = false;
    cacheSet('notes', notes);
  } catch (e) {
    notesTableMissing = true;
    const cn = cacheGet('notes'); notes = Array.isArray(cn) ? cn : [];
    console.warn('[notes] table not ready yet:', e && e.message);
  }
  try {
    const dres = await sb.from('presentations').select('*').eq('user_id', USER_ID).order('position', { ascending: true });
    if (dres.error) throw dres.error;
    presentations = (dres.data || []).map(rowToDeck);
    decksTableMissing = false;
    cacheSet('presentations', presentations);
  } catch (e) {
    decksTableMissing = true;
    const cd = cacheGet('presentations'); presentations = Array.isArray(cd) ? cd : [];
    console.warn('[presentations] table not ready yet:', e && e.message);
  }
  try {
    const pres = await sb.from('preferences').select('data').eq('user_id', USER_ID);
    if (pres.error) throw pres.error;
    const prow = pres.data && pres.data[0];
    if (prow && prow.data) applyPrefs(prow.data);
    prefsTableMissing = false;
  } catch (e) {
    prefsTableMissing = true;
    console.warn('[prefs] table not ready yet:', e && e.message);
  }
}

// ---- Push (upsert current rows + delete the ones that disappeared) ----
async function pushTable(table, rows, currentIds) {
  if (rows.length) {
    const { error } = await sb.from(table).upsert(rows);
    if (error) throw error;
  }
  const { data: existing, error: selErr } = await sb.from(table).select('id').eq('user_id', USER_ID);
  if (selErr) throw selErr;
  const keep = new Set(currentIds);
  const toDelete = (existing || []).map(r => r.id).filter(id => !keep.has(id));
  if (toDelete.length) {
    const { error } = await sb.from(table).delete().in('id', toDelete);
    if (error) throw error;
  }
}

async function flushCloudSave() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!sb || !USER_ID) { pendingSave = false; return; }
  setSyncStatus('saving');
  try {
    if (dirty.columns) { await pushTable('columns', columns.map(colToRow),   columns.map(c => c.id)); dirty.columns = false; }
    if (dirty.groups)  { await pushTable('groups',  groups.map(groupToRow),  groups.map(g => g.id));  dirty.groups = false; }
    if (dirty.tasks) {
      try { await pushTable('tasks', tasks.map(taskToRow), tasks.map(t => t.id)); }
      catch (e) { if (/completed_at/i.test((e && e.message) || '') && !tasksOmitCompleted) { tasksOmitCompleted = true; await pushTable('tasks', tasks.map(taskToRow), tasks.map(t => t.id)); } else { throw e; } }
      dirty.tasks = false;
    }
    if (dirty.notes)   { try { await pushTable('notes', notes.map(noteToRow), notes.map(n => n.id)); notesTableMissing = false; } catch (e) { notesTableMissing = true; console.warn('[notes] push failed:', e && e.message); } dirty.notes = false; }
    if (dirty.presentations) {
      try { await pushTable('presentations', presentations.map(deckToRow), presentations.map(d => d.id)); decksTableMissing = false; }
      catch (e) {
        if (/tags/i.test((e && e.message) || '') && !decksOmitTags) { decksOmitTags = true; try { await pushTable('presentations', presentations.map(deckToRow), presentations.map(d => d.id)); decksTableMissing = false; } catch (e2) { decksTableMissing = true; } }
        else { decksTableMissing = true; console.warn('[presentations] push failed:', e && e.message); }
      }
      dirty.presentations = false;
    }
    if (dirty.prefs) {
      try { await pushPrefs(); prefsTableMissing = false; }
      catch (e) { prefsTableMissing = true; console.warn('[prefs] push failed:', e && e.message); }
      dirty.prefs = false;
    }
    lastPushAt = (window.performance ? performance.now() : Date.now());
    setSyncStatus('synced');
  } catch (e) {
    console.error('[sync] push failed', e);
    setSyncStatus('error');
  } finally {
    pendingSave = false;
  }
}

function scheduleCloudSave(kind) {
  if (kind) dirty[kind] = true;
  if (!sb || !USER_ID) return;       // not logged in -> cache only
  pendingSave = true;
  setSyncStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushCloudSave, 1200);
}

async function syncNow() {
  if (!sb || !USER_ID) return;
  dirty.tasks = dirty.columns = dirty.groups = dirty.notes = dirty.presentations = dirty.prefs = true;
  await flushCloudSave();
}

// ---- Realtime: react to changes from another device/tab ----
function subscribeRealtime() {
  if (!sb || !USER_ID) return;
  if (rtChannel) { sb.removeChannel(rtChannel); rtChannel = null; }
  const filter = 'user_id=eq.' + USER_ID;
  rtChannel = sb.channel('tb_' + USER_ID)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks',   filter }, onRemoteChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'columns', filter }, onRemoteChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'groups',  filter }, onRemoteChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notes',   filter }, onRemoteChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'presentations', filter }, onRemoteChange)
    .subscribe();
}
function onRemoteChange() {
  const now = (window.performance ? performance.now() : Date.now());
  if (pendingSave) return;                 // our own write is in flight
  if (now - lastPushAt < 2000) return;     // ignore the echo of our own write
  clearTimeout(pullTimer);
  pullTimer = setTimeout(async () => {
    try {
      await pullAll();
      addNewToFilters();
      refreshColumnSelects();
      renderBoard();
      setSyncStatus('synced');
    } catch (e) { console.error('[sync] pull failed', e); }
  }, 400);
}

// ---- Seed default columns for a brand-new (empty) account ----
async function seedIfEmpty() {
  if (columns.length) return;
  columns = DEFAULT_COLS.map(c => ({ ...c }));
  cacheSet('columns', columns);
  dirty.columns = true;
  await flushCloudSave();
}

// ============================================================
//  Import JSON
// ============================================================
function setupImport() {
  document.getElementById('import-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed.tasks)) { alert(tr('import.invalid')); return; }
      if (!confirm(tr('import.confirm').replace('{n}', parsed.tasks.length))) return;
      tasks   = parsed.tasks;   tasks.forEach(t => { if (!Array.isArray(t.subtasks)) t.subtasks = []; if (t.group === undefined) t.group = ''; });
      if (Array.isArray(parsed.columns) && parsed.columns.length) columns = parsed.columns;
      if (Array.isArray(parsed.groups)) groups = parsed.groups;
      resetFilters();
      saveTasks(); saveColumns(); saveGroups();
      refreshColumnSelects();
      renderBoard();
    } catch (err) { alert(tr('import.error') + err.message); }
  });
}

// ============================================================
//  Notes (Markdown) + generate tasks
// ============================================================
function noteToRow(n, i) { return { id: n.id, user_id: USER_ID, title: n.title || '', content: n.content || '', position: i, created_at: new Date(n.created || Date.now()).toISOString() }; }
function rowToNote(r) { return { id: r.id, title: r.title || '', content: r.content || '', created: r.created_at ? new Date(r.created_at).getTime() : Date.now() }; }

function stripInlineMd(s) {
  return String(s || '').replace(/\*\*|__|~~|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
}
function renderMarkdown(md) {
  if (!md || !md.trim()) return '<div class="notes-preview-empty">' + escHtml(tr('notes.contentPh')) + '</div>';
  md = preprocessWiki(md);
  let html = null;
  if (window.marked && window.marked.parse) {
    try { html = window.marked.parse(md, { breaks: true, gfm: true }); } catch (e) { html = null; }
  }
  if (html == null) html = '<pre style="white-space:pre-wrap;word-break:break-word">' + escHtml(md) + '</pre>';
  return sanitizeHtml(html);
}
function extractTaskCandidates(md) {
  const out = [];
  String(md || '').split('\n').forEach(line => {
    let m;
    if ((m = line.match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.*\S)\s*$/))) { out.push({ text: stripInlineMd(m[2]), done: m[1].toLowerCase() === 'x' }); return; }
    if ((m = line.match(/^\s*[-*+]\s+(.*\S)\s*$/)))               { out.push({ text: stripInlineMd(m[1]), done: false }); return; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*\S)\s*$/)))             { out.push({ text: stripInlineMd(m[1]), done: false }); return; }
  });
  return out;
}

function importMarkdownFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  let pending = files.length; const created = [];
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const title = file.name.replace(/\.(md|markdown|txt)$/i, '').trim();
      const n = { id: 'n_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), title: title || tr('notes.untitled'), content: text, created: Date.now() };
      notes.unshift(n); created.push(n.id);
      if (--pending === 0) { saveNotes(); if (created.length) { activeNoteId = created[0]; notesGraph = false; } renderBoard(); }
    };
    reader.onerror = () => { if (--pending === 0) { saveNotes(); renderBoard(); } };
    reader.readAsText(file);
  });
}
function renderNotes(board) {
  if (notesGraph) { renderNotesGraph(board); return; }
  if (activeNoteId && !notes.find(n => n.id === activeNoteId)) activeNoteId = null;
  if (!activeNoteId && notes.length) activeNoteId = notes[0].id;
  const active = notes.find(n => n.id === activeNoteId) || null;

  let displayNotes = notes.slice();
  const nq = notesSearch.trim().toLowerCase();
  if (nq) displayNotes = displayNotes.filter(n => (n.title || '').toLowerCase().includes(nq) || (n.content || '').toLowerCase().includes(nq));
  if (notesSort === 'title') displayNotes.sort((a, b) => (a.title || tr('notes.untitled')).localeCompare(b.title || tr('notes.untitled'), undefined, { sensitivity: 'base' }));
  else if (notesSort === 'newest') displayNotes.sort((a, b) => (b.created || 0) - (a.created || 0));
  else if (notesSort === 'oldest') displayNotes.sort((a, b) => (a.created || 0) - (b.created || 0));
  const canReorder = notesSort === 'manual';
  const listHtml = !notes.length
    ? '<div class="notes-empty">' + escHtml(tr('notes.empty')) + '</div>'
    : (displayNotes.length
      ? displayNotes.map(n => `<button class="note-item${n.id === activeNoteId ? ' active' : ''}" data-note="${escHtml(n.id)}"${canReorder ? ' draggable="true"' : ''}>${canReorder ? '<span class="note-drag" aria-hidden="true"><i data-lucide="grip-vertical"></i></span>' : ''}<span class="note-item-body"><span class="note-item-title">${escHtml(n.title || tr('notes.untitled'))}</span><span class="note-item-snippet">${escHtml(stripInlineMd(n.content).slice(0, 90))}</span></span></button>`).join('')
      : '<div class="notes-empty notes-noresult">' + escHtml(tr('pres.noResults')) + '</div>');

  const banner = notesTableMissing ? `<div class="notes-banner">${escHtml(tr('notes.tableMissing'))}</div>` : '';
  const modeBtn = (m, lbl) => `<button class="note-mode-btn${noteMode === m ? ' active' : ''}" data-nmode="${m}">${escHtml(lbl)}</button>`;

  let editorBody = '';
  if (active) {
    if (noteMode === 'rich') {
      editorBody = richEditorMarkup('note-rich');
    } else if (noteMode === 'md') {
      editorBody = `<textarea id="note-content" class="note-content" spellcheck="true" placeholder="${escHtml(tr('notes.contentPh'))}">${escHtml(active.content)}</textarea>`;
    } else {
      editorBody = `<textarea id="note-content" class="note-content" spellcheck="true" placeholder="${escHtml(tr('notes.contentPh'))}">${escHtml(active.content)}</textarea>
         <div class="note-preview md-body" id="note-preview">${renderMarkdown(active.content)}</div>`;
    }
  }

  const mainHtml = active
    ? `<div class="note-head">
         <input type="text" id="note-title" class="note-title-input" value="${escHtml(active.title)}" placeholder="${escHtml(tr('notes.titlePh'))}">
         <div class="note-head-actions">
           <div class="note-modes">${modeBtn('split', tr('notes.split'))}${modeBtn('md', tr('notes.md'))}${modeBtn('rich', tr('notes.rich'))}</div>
           <button class="icon-btn" id="note-focus" title="${escHtml(noteFocus ? tr('notes.exitFocus') : tr('notes.focus'))}">${noteFocus ? '<i data-lucide="minimize-2"></i>' : '<i data-lucide="maximize-2"></i>'}</button>
           <div class="dropdown note-menu-wrap"><button class="btn-ghost" type="button" data-note-menu="insert"><i data-lucide="plus-circle"></i> <span>${escHtml(tr('ins.btn'))}</span></button><div class="dropdown-menu" data-note-dropdown="insert" hidden><button class="dropdown-item" data-ins="date"><i data-lucide="calendar"></i>${escHtml(tr('ins.date'))}</button><button class="dropdown-item" data-ins="datetime"><i data-lucide="clock"></i>${escHtml(tr('ins.datetime'))}</button><button class="dropdown-item" data-ins="tag"><i data-lucide="hash"></i>${escHtml(tr('ins.tag'))}</button><button class="dropdown-item" data-ins="attr"><i data-lucide="text"></i>${escHtml(tr('ins.attr'))}</button><button class="dropdown-item" data-ins="link"><i data-lucide="link-2"></i>${escHtml(tr('ins.link'))}</button></div></div>
           <div class="dropdown note-menu-wrap"><button class="btn-ghost" type="button" data-note-menu="export"><i data-lucide="download"></i> <span>${escHtml(tr('exp.btn'))}</span></button><div class="dropdown-menu" data-note-dropdown="export" hidden><button class="dropdown-item" data-exp="copy"><i data-lucide="clipboard"></i>${escHtml(tr('exp.copy'))}</button><button class="dropdown-item" data-exp="html"><i data-lucide="file-code-2"></i>${escHtml(tr('exp.html'))}</button><button class="dropdown-item" data-exp="pdf"><i data-lucide="printer"></i>${escHtml(tr('exp.pdf'))}</button></div></div>
           <button class="btn-ghost" id="note-gen">${escHtml(tr('notes.gen'))}</button>
           <button class="icon-btn" id="note-del" title="${escHtml(tr('notes.delete'))}"><i data-lucide="trash-2"></i></button>
         </div>
       </div>
       <div class="note-body note-mode-${noteMode}">${editorBody}</div>`
    : `<div class="notes-select">${escHtml(tr('notes.select'))}</div>`;

  board.innerHTML = `${banner}<div class="notes-wrap${noteFocus ? ' focus' : ''}">
      <div class="notes-list">
        <div class="notes-list-head"><button class="btn-primary notes-new-btn" id="note-new">${escHtml(tr('notes.new'))}</button><label class="btn-ghost notes-graph-btn" id="notes-import-btn" title="${escHtml(tr('notes.import'))}"><i data-lucide="upload"></i><input type="file" id="notes-import-input" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple hidden></label><button class="btn-ghost notes-graph-btn" id="notes-graph-btn" title="${escHtml(tr('graph.title'))}"><i data-lucide="workflow"></i></button></div>
        <div class="notes-toolbar"><div class="notes-search-wrap"><i data-lucide="search"></i><input type="text" id="notes-search" class="notes-search" placeholder="${escHtml(tr('notes.search'))}" value="${escHtml(notesSearch)}"></div><select id="notes-sort" class="notes-sort">${['manual', 'title', 'newest', 'oldest'].map(o => `<option value="${o}"${notesSort === o ? ' selected' : ''}>${escHtml(tr('notes.sort.' + o))}</option>`).join('')}</select></div>
        <div class="notes-items">${listHtml}</div>
      </div>
      <div class="notes-main">${mainHtml}</div>
    </div>`;

  const newBtn = document.getElementById('note-new');
  if (newBtn) newBtn.addEventListener('click', () => {
    const n = { id: 'n_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), title: '', content: '', created: Date.now() };
    notes.unshift(n); activeNoteId = n.id; saveNotes(); renderBoard();
    const ti = document.getElementById('note-title'); if (ti) ti.focus();
  });
  board.querySelectorAll('[data-note]').forEach(el => el.addEventListener('click', () => { activeNoteId = el.dataset.note; renderBoard(); }));
  const noteSearchEl = document.getElementById('notes-search');
  if (noteSearchEl) noteSearchEl.addEventListener('input', () => {
    notesSearch = noteSearchEl.value;
    const ql = notesSearch.trim().toLowerCase();
    const itemsBox = board.querySelector('.notes-items');
    let anyVisible = false;
    board.querySelectorAll('.notes-items .note-item').forEach(it => {
      const n = notes.find(x => x.id === it.dataset.note);
      const match = !ql || (n && ((n.title || '').toLowerCase().includes(ql) || (n.content || '').toLowerCase().includes(ql)));
      it.classList.toggle('hidden-note', !match); if (match) anyVisible = true;
    });
    let nr = board.querySelector('.notes-noresult');
    if (!anyVisible && notes.length) { if (!nr && itemsBox) { nr = document.createElement('div'); nr.className = 'notes-empty notes-noresult'; nr.textContent = tr('pres.noResults'); itemsBox.appendChild(nr); } }
    else if (nr) nr.remove();
  });
  const noteSortEl = document.getElementById('notes-sort');
  if (noteSortEl) noteSortEl.addEventListener('change', () => { notesSort = noteSortEl.value; try { localStorage.setItem('tb_notes_sort', notesSort); } catch (e) {} markPrefsDirty(); renderBoard(); });
  if (notesSort === 'manual') {
    board.querySelectorAll('.notes-items .note-item').forEach(it => {
      it.addEventListener('dragstart', e => { notesDragId = it.dataset.note; it.classList.add('dragging'); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; });
      it.addEventListener('dragend', () => { it.classList.remove('dragging'); board.querySelectorAll('.note-item.drop-target').forEach(x => x.classList.remove('drop-target')); });
      it.addEventListener('dragover', e => { e.preventDefault(); it.classList.add('drop-target'); });
      it.addEventListener('dragleave', () => it.classList.remove('drop-target'));
      it.addEventListener('drop', e => { e.preventDefault(); const targetId = it.dataset.note; if (!notesDragId || notesDragId === targetId) { notesDragId = null; return; } const from = notes.findIndex(n => n.id === notesDragId), to = notes.findIndex(n => n.id === targetId); notesDragId = null; if (from < 0 || to < 0) return; const m = notes.splice(from, 1)[0]; notes.splice(to, 0, m); saveNotes(); renderBoard(); });
    });
  }
  board.querySelectorAll('[data-nmode]').forEach(b => b.addEventListener('click', () => { noteMode = b.dataset.nmode; saveNotePrefs(); renderBoard(); }));
  const focusBtn = document.getElementById('note-focus');
  if (focusBtn) focusBtn.addEventListener('click', () => { noteFocus = !noteFocus; saveNotePrefs(); renderBoard(); });

  const titleEl = document.getElementById('note-title');
  if (titleEl) titleEl.addEventListener('input', () => {
    const n = notes.find(x => x.id === activeNoteId); if (!n) return;
    n.title = titleEl.value; saveNotes();
    const lab = board.querySelector('.note-item.active .note-item-title'); if (lab) lab.textContent = n.title || tr('notes.untitled');
  });

  if (active && noteMode === 'rich') {
    const editor = document.getElementById('note-rich');
    const toolbar = document.getElementById('note-rich-toolbar');
    if (editor) {
      editor.classList.add('md-body');
      editor.setAttribute('data-placeholder', tr('notes.contentPh'));
      editor.innerHTML = (active.content && active.content.trim()) ? renderMarkdown(active.content) : '';
      setupRichEditor(editor, toolbar);
      editor.addEventListener('input', () => {
        const n = notes.find(x => x.id === activeNoteId); if (!n) return;
        const td = getTurndown();
        n.content = td ? td.turndown(sanitizeHtml(editor.innerHTML)) : (editor.innerText || '');
        saveNotes();
      });
      bindNoteLinks(editor);
      ['keyup', 'mouseup', 'blur'].forEach(ev => editor.addEventListener(ev, () => { const sel = window.getSelection(); if (sel.rangeCount) { const r = sel.getRangeAt(0); if (editor.contains(r.commonAncestorContainer)) noteCaret = r.cloneRange(); } }));
    }
  } else if (active) {
    const contentEl = document.getElementById('note-content');
    const previewEl = document.getElementById('note-preview');
    if (contentEl) contentEl.addEventListener('input', () => {
      const n = notes.find(x => x.id === activeNoteId); if (!n) return;
      n.content = contentEl.value;
      if (previewEl) previewEl.innerHTML = renderMarkdown(n.content);
      saveNotes();
    });
    if (previewEl) bindNoteLinks(previewEl);
  }

  board.querySelectorAll('[data-note-menu]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); const which = btn.dataset.noteMenu; const m = board.querySelector('[data-note-dropdown="' + which + '"]'); const wasHidden = m && m.hidden; board.querySelectorAll('[data-note-dropdown]').forEach(x => x.hidden = true); if (m) m.hidden = !wasHidden; }));
  board.querySelectorAll('[data-ins]').forEach(b => b.addEventListener('click', () => { board.querySelectorAll('[data-note-dropdown]').forEach(x => x.hidden = true); insertToken(b.dataset.ins); }));
  board.querySelectorAll('[data-exp]').forEach(b => b.addEventListener('click', () => { board.querySelectorAll('[data-note-dropdown]').forEach(x => x.hidden = true); exportNote(b.dataset.exp); }));
  const graphBtn = document.getElementById('notes-graph-btn'); if (graphBtn) graphBtn.addEventListener('click', () => { notesGraph = true; renderBoard(); });
  const importInput = document.getElementById('notes-import-input'); if (importInput) importInput.addEventListener('change', e => { importMarkdownFiles(e.target.files); e.target.value = ''; });
  if (!window.__noteMenuBound) { window.__noteMenuBound = true; document.addEventListener('click', e => { if (!e.target.closest('.note-menu-wrap')) document.querySelectorAll('[data-note-dropdown]').forEach(m => m.hidden = true); }); }
  const delBtn = document.getElementById('note-del');
  if (delBtn) delBtn.addEventListener('click', () => {
    if (!confirm(tr('notes.deleteConfirm'))) return;
    notes = notes.filter(x => x.id !== activeNoteId); activeNoteId = null; saveNotes(); renderBoard();
  });
  const genBtn = document.getElementById('note-gen');
  if (genBtn) genBtn.addEventListener('click', () => openGenerateTasksModal(activeNoteId));
}

function openGenerateTasksModal(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  const cands = extractTaskCandidates(note.content);
  const colOpts = columns.map(c => `<option value="${escHtml(c.id)}">${escHtml(c.name)}</option>`).join('');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const body = cands.length
    ? `<div class="gen-list">${cands.map((c, i) => `<label class="gen-item"><input type="checkbox" data-gi="${i}" checked><span class="${c.done ? 'gen-done' : ''}">${escHtml(c.text)}</span></label>`).join('')}</div>
       <div class="field"><label>${escHtml(tr('gen.column'))}</label><select id="gen-col">${colOpts}</select></div>`
    : `<p class="settings-tip">${escHtml(tr('gen.none'))}</p>`;
  backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h2>${escHtml(tr('gen.title'))}</h2>
      ${body}
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="gen-cancel">${escHtml(tr('gen.cancel'))}</button>
        ${cands.length ? `<button type="button" class="btn-primary" id="gen-create">${escHtml(tr('gen.create'))}</button>` : ''}
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  function close() { if (backdrop.parentNode) document.body.removeChild(backdrop); document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  document.getElementById('gen-cancel').addEventListener('click', close);
  const createBtn = document.getElementById('gen-create');
  if (createBtn) createBtn.addEventListener('click', () => {
    const colSel = document.getElementById('gen-col').value;
    const doneCol = columns.find(c => c.id === 'done');
    let n = 0;
    backdrop.querySelectorAll('[data-gi]').forEach(cb => {
      if (!cb.checked) return;
      const cand = cands[parseInt(cb.dataset.gi)];
      if (!cand || !cand.text) return;
      const targetCol = (cand.done && doneCol) ? doneCol.id : colSel;
      const gt = { id: uid(), title: cand.text, desc: '', priority: 'Medium', deadline: null, col: targetCol, group: '', created: Date.now() + n, subtasks: [] }; markCompletion(gt); tasks.push(gt);
      n++;
    });
    close();
    if (n) {
      saveTasks();
      currentView = 'kanban'; saveView();
      document.querySelectorAll('#view-switch button').forEach(b => b.classList.toggle('active', b.dataset.view === currentView));
      renderBoard();
    }
  });
}

// ============================================================
//  Tickets — admin (manage all team requests)
// ============================================================
const TK_STATUSES = ['Open', 'In progress', 'Waiting', 'Done', 'Rejected'];
const TK_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

function tkMd(md) {
  if (!md || !md.trim()) return '';
  let h = null;
  if (window.marked && window.marked.parse) { try { h = window.marked.parse(md, { breaks: true, gfm: true }); } catch (e) { h = null; } }
  if (h == null) h = '<p>' + escHtml(md).replace(/\n/g, '<br>') + '</p>';
  return sanitizeHtml(h);
}
function tkDay(iso) { try { return new Date(iso).toLocaleDateString(localeFor(), { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } }
function tkDateTime(iso) { try { return new Date(iso).toLocaleString(localeFor(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
function tkBadge(kind, val) {
  val = val || (kind === 'st' ? 'Open' : kind === 'pr' ? 'Medium' : 'Change');
  if (kind === 'st')  return '<span class="tk-badge st-' + val.replace(/\s+/g, '-') + '">' + escHtml(tr('tk.st.' + val)) + '</span>';
  if (kind === 'cat') return '<span class="tk-badge tk-cat">' + escHtml(tr('tk.cat.' + val)) + '</span>';
  if (kind === 'pr')  return '<span class="tk-badge pr-' + val + '">' + escHtml(tr('tk.pr.' + val)) + '</span>';
  return '';
}
function tkCommentsHtml() {
  if (!ticketComments.length) return '<div class="tk-nocomments">' + escHtml(tr('tk.noComments')) + '</div>';
  return ticketComments.map(c => {
    const mine = c.author_id === USER_ID;
    const who = mine ? tr('tk.youAdmin') : (c.author_email || '');
    return '<div class="tk-comment' + (mine ? ' mine' : '') + '"><div class="tk-comment-head"><span class="tk-comment-who">' +
      escHtml(who) + '</span><span class="tk-comment-date">' + escHtml(tkDateTime(c.created_at)) + '</span></div>' +
      '<div class="tk-comment-body md-body">' + tkMd(c.body) + '</div></div>';
  }).join('');
}

async function loadAllTickets() {
  if (!sb || USER_ROLE !== 'admin') return;
  const r = await sb.from('tickets').select('*').order('created_at', { ascending: false });
  if (r.error) { console.error('[tickets] load failed', r.error); return; }
  tickets = r.data || [];
}
async function loadTicketComments(id) {
  const r = await sb.from('ticket_comments').select('*').eq('ticket_id', id).order('created_at', { ascending: true });
  ticketComments = r.error ? [] : (r.data || []);
}
async function updateTicket(id, fields) {
  const r = await sb.from('tickets').update(fields).eq('id', id);
  if (r.error) { console.error('[tickets] update failed', r.error); setSyncStatus('error'); }
}
async function addTicketComment(id, body) {
  const r = await sb.from('ticket_comments').insert({ ticket_id: id, body: body, author_id: USER_ID, author_email: USER_EMAIL }).select().single();
  if (r.error) { alert(r.error.message); return null; }
  return r.data;
}
function subscribeTicketsRealtime() {
  if (!sb || USER_ROLE !== 'admin') return;
  if (ticketsRtChannel) { sb.removeChannel(ticketsRtChannel); ticketsRtChannel = null; }
  ticketsRtChannel = sb.channel('admin_tickets')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, async () => { await loadAllTickets(); if (currentView === 'tickets' && !document.querySelector('.modal-backdrop')) renderBoard(); })
    .subscribe();
}

function renderTickets(board) {
  const counts = {}; TK_STATUSES.forEach(st => counts[st] = 0);
  tickets.forEach(t => { if (counts[t.status] != null) counts[t.status]++; });
  const open = tickets.filter(t => t.status !== 'Done' && t.status !== 'Rejected').length;
  const pills = ['all'].concat(TK_STATUSES).map(st =>
    '<button class="tk-fpill' + (ticketFilter === st ? ' active' : '') + '" data-tkf="' + st + '">' +
    (st === 'all' ? escHtml(tr('tk.all')) + ' (' + tickets.length + ')' : escHtml(tr('tk.st.' + st)) + ' (' + counts[st] + ')') + '</button>'
  ).join('');
  const list = (ticketFilter === 'all') ? tickets : tickets.filter(t => t.status === ticketFilter);
  const rows = list.length ? list.map(t =>
    '<button class="tk-row" data-tkrow="' + escHtml(t.id) + '">' +
      '<span class="tk-row-main"><span class="tk-row-title">' + escHtml(t.title || '—') + '</span>' +
      '<span class="tk-row-sub">' + escHtml(t.requester_email || '') + (t.report ? ' · ' + escHtml(t.report) : '') + '</span></span>' +
      '<span class="tk-row-badges">' + tkBadge('cat', t.category) + tkBadge('pr', t.priority) + tkBadge('st', t.status) + '</span>' +
      '<span class="tk-row-date">' + escHtml(tkDay(t.created_at)) + '</span>' +
    '</button>'
  ).join('') : '<div class="tk-empty-admin">' + escHtml(tr('tk.empty')) + '</div>';
  board.innerHTML = '<div class="tk-admin"><div class="tk-admin-head"><h2>' + escHtml(tr('tk.title')) +
    '</h2><span class="tk-openpill">' + open + ' ' + escHtml(tr('tk.openCount')) + '</span></div>' +
    '<div class="tk-filters">' + pills + '</div><div class="tk-rows">' + rows + '</div></div>';
  board.querySelectorAll('[data-tkf]').forEach(b => b.addEventListener('click', () => { ticketFilter = b.dataset.tkf; renderBoard(); }));
  board.querySelectorAll('[data-tkrow]').forEach(b => b.addEventListener('click', () => openTicketModal(b.dataset.tkrow)));
}

async function openTicketModal(id) {
  const t = tickets.find(x => x.id === id); if (!t) return;
  await loadTicketComments(id);
  const stOpts = TK_STATUSES.map(st => '<option value="' + st + '"' + (t.status === st ? ' selected' : '') + '>' + escHtml(tr('tk.st.' + st)) + '</option>').join('');
  const prOpts = TK_PRIORITIES.map(p => '<option value="' + p + '"' + (t.priority === p ? ' selected' : '') + '>' + escHtml(tr('tk.pr.' + p)) + '</option>').join('');
  const convo = t.linked_task_id
    ? '<span class="tk-converted">' + escHtml(tr('tk.converted')) + '</span>'
    : '<button type="button" class="btn-ghost" id="tk-convert">' + escHtml(tr('tk.convert')) + '</button>';
  const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = '<div class="modal modal-lg" role="dialog" aria-modal="true">' +
    '<h2 style="margin-bottom:4px">' + escHtml(t.title || '—') + '</h2>' +
    '<div class="tk-detail-meta"><span>' + escHtml(t.requester_email || '') + '</span>' + (t.report ? '<span>· ' + escHtml(t.report) + '</span>' : '') + '<span>· ' + escHtml(tkDay(t.created_at)) + '</span>' + tkBadge('cat', t.category) + '</div>' +
    '<div class="md-body tk-desc">' + (tkMd(t.description) || '<em style="color:var(--text-light)">—</em>') + '</div>' +
    '<div class="settings-row" style="gap:10px;margin-top:6px">' +
      '<div class="field" style="flex:1;margin:0"><label>' + escHtml(tr('tk.status')) + '</label><select id="tk-status">' + stOpts + '</select></div>' +
      '<div class="field" style="flex:1;margin:0"><label>' + escHtml(tr('tk.priority')) + '</label><select id="tk-priority">' + prOpts + '</select></div>' +
    '</div>' +
    '<div class="tk-section-label">' + escHtml(tr('tk.comments')) + '</div>' +
    '<div class="tk-comments" id="tk-comments">' + tkCommentsHtml() + '</div>' +
    '<div class="tk-comment-form"><textarea id="tk-cinput" rows="2" placeholder="' + escHtml(tr('tk.reply')) + '"></textarea><button class="btn-primary" id="tk-csend">' + escHtml(tr('tk.send')) + '</button></div>' +
    '<div class="modal-actions">' + convo + '<button type="button" class="btn-secondary" id="tk-close">' + escHtml(tr('tk.close')) + '</button></div>' +
    '</div>';
  document.body.appendChild(backdrop);
  let changed = false;
  function close() { if (backdrop.parentNode) document.body.removeChild(backdrop); document.removeEventListener('keydown', onKey); if (changed && currentView === 'tickets') renderBoard(); }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  document.getElementById('tk-close').addEventListener('click', close);

  const stSel = document.getElementById('tk-status'), prSel = document.getElementById('tk-priority');
  stSel.addEventListener('change', async () => { t.status = stSel.value; changed = true; await updateTicket(t.id, { status: t.status }); });
  prSel.addEventListener('change', async () => { t.priority = prSel.value; changed = true; await updateTicket(t.id, { priority: t.priority }); });

  const send = document.getElementById('tk-csend'), inp = document.getElementById('tk-cinput');
  async function sendComment() {
    const body = inp.value.trim(); if (!body) return;
    send.disabled = true;
    const c = await addTicketComment(t.id, body);
    send.disabled = false;
    if (c) { inp.value = ''; await loadTicketComments(t.id); const box = document.getElementById('tk-comments'); if (box) box.innerHTML = tkCommentsHtml(); }
  }
  send.addEventListener('click', sendComment);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendComment(); } });

  const convBtn = document.getElementById('tk-convert');
  if (convBtn) convBtn.addEventListener('click', async () => {
    const col = columns.find(c => c.id === 'todo') || columns[0];
    if (!col) return;
    const newId = uid();
    tasks.push({ id: newId, title: t.title, desc: t.description || '', priority: TK_PRIORITIES.indexOf(t.priority) >= 0 ? t.priority : 'Medium', deadline: null, col: col.id, group: '', created: Date.now(), subtasks: [] });
    saveTasks();
    t.linked_task_id = newId; if (t.status === 'Open') t.status = 'In progress';
    changed = true;
    await updateTicket(t.id, { linked_task_id: newId, status: t.status });
    close();
    alert(tr('tk.convertedMsg'));
  });
}

// ============================================================
//  Analytics dashboard
// ============================================================
function anCard(value, label, cls) {
  return '<div class="an-card' + (cls ? ' ' + cls : '') + '"><div class="an-card-val">' + value + '</div><div class="an-card-label">' + escHtml(label) + '</div></div>';
}
function anBarRow(label, n, max, color) {
  const pct = max > 0 ? Math.round(n / max * 100) : 0;
  return '<div class="an-bar"><span class="an-bar-label" title="' + escHtml(label) + '">' + escHtml(label) + '</span>' +
    '<span class="an-bar-track"><span class="an-bar-fill" style="width:' + pct + '%;background:' + escHtml(color || 'var(--purple)') + '"></span></span>' +
    '<span class="an-bar-val">' + n + '</span></div>';
}
function renderAnalytics(board) {
  const isDone = t => t.col === 'done';
  const total = tasks.length;
  const done = tasks.filter(isDone).length;
  const open = total - done;
  const overdue = tasks.filter(t => !isDone(t) && t.deadline && daysUntil(t.deadline) < 0).length;
  const dueSoon = tasks.filter(t => !isDone(t) && t.deadline && daysUntil(t.deadline) >= 0 && daysUntil(t.deadline) <= 7).length;
  const rate = total ? Math.round(done / total * 100) : 0;
  let stDone = 0, stTotal = 0;
  tasks.forEach(t => { const c = subtaskCounts(t); stDone += c.done; stTotal += c.total; });
  const completedTs = tasks.filter(t => t.completed).map(t => t.completed);
  const doneWeek = completedTs.filter(ts => ts >= Date.now() - 7 * 864e5).length;
  const doneMonth = completedTs.filter(ts => ts >= Date.now() - 30 * 864e5).length;

  const cards = anCard(total, tr('an.kTotal')) + anCard(done, tr('an.kDone'), 'ok') + anCard(open, tr('an.kOpen')) +
    anCard(overdue, tr('an.kOverdue'), overdue ? 'bad' : '') + anCard(rate + '%', tr('an.kRate'), 'accent');

  const colMax = Math.max(1, ...columns.map(c => tasks.filter(t => t.col === c.id).length));
  const byStatus = columns.length ? columns.map(c => anBarRow(c.name, tasks.filter(t => t.col === c.id).length, colMax, c.color)).join('') : '<div class="an-empty">' + escHtml(tr('an.noData')) + '</div>';

  const prioColors = { Critical: 'var(--red)', High: 'var(--orange)', Medium: 'var(--blue)', Low: 'var(--green)' };
  const prMax = Math.max(1, ...PRIORITIES.map(p => tasks.filter(t => t.priority === p).length));
  const byPrio = PRIORITIES.map(p => anBarRow(prioLabel(p), tasks.filter(t => t.priority === p).length, prMax, prioColors[p])).join('');

  const grpList = groupOrder().map(g => ({ name: g.name, color: g.color, n: tasks.filter(t => (t.group || '') === g.id).length })).filter(x => x.n > 0);
  const grpMax = Math.max(1, ...grpList.map(x => x.n));
  const byGroup = grpList.length ? grpList.map(x => anBarRow(x.name, x.n, grpMax, x.color)).join('') : '<div class="an-empty">' + escHtml(tr('an.noData')) + '</div>';

  const weeks = 8, counts = new Array(weeks).fill(0);
  const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
  completedTs.forEach(ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); const w = Math.floor(((todayMid - d) / 864e5) / 7); if (w >= 0 && w < weeks) counts[weeks - 1 - w]++; });
  const cMax = Math.max(1, ...counts);
  const colChart = '<div class="an-cols">' + counts.map((n, i) => {
    const h = n ? Math.max(6, Math.round(n / cMax * 100)) : 2;
    const lbl = i === 0 ? '-8w' : (i === weeks - 1 ? 'now' : '');
    return '<div class="an-colwrap"><span class="an-colval">' + (n || '') + '</span><span class="an-colbar" style="height:' + h + '%"></span><span class="an-collbl">' + lbl + '</span></div>';
  }).join('') + '</div>';

  const stPct = stTotal ? Math.round(stDone / stTotal * 100) : 0;
  const subProgress = '<div class="an-progress-top"><span>' + escHtml(tr('an.subtaskProgress').replace('{d}', stDone).replace('{t}', stTotal)) + '</span><span>' + stPct + '%</span></div>' +
    '<span class="an-bar-track big"><span class="an-bar-fill" style="width:' + stPct + '%;background:var(--green)"></span></span>';

  const noteCount = notes.length;
  const noteWords = notes.reduce((sum, n) => sum + stripInlineMd(n.content || '').split(/\s+/).filter(Boolean).length, 0);
  const lastTs = notes.reduce((m, n) => Math.max(m, n.created || 0), 0);
  const lastNote = lastTs ? new Date(lastTs).toLocaleDateString(localeFor(), { day: 'numeric', month: 'short', year: 'numeric' }) : tr('an.never');

  let ticketsSection = '';
  if (USER_ROLE === 'admin' && tickets.length) {
    const tkOpen = tickets.filter(t => t.status !== 'Done' && t.status !== 'Rejected').length;
    const tkDone = tickets.filter(t => t.status === 'Done').length;
    const cats = ['Change', 'Addition', 'Improvement', 'Bug', 'Question'];
    const catMax = Math.max(1, ...cats.map(c => tickets.filter(t => t.category === c).length));
    const byCat = cats.map(c => { const n = tickets.filter(t => t.category === c).length; return n ? anBarRow(tr('tk.cat.' + c), n, catMax, 'var(--purple)') : ''; }).join('');
    ticketsSection = '<div class="an-section"><h3>' + escHtml(tr('an.tickets')) + '</h3><div class="an-cards">' +
      anCard(tickets.length, tr('an.kTotal')) + anCard(tkOpen, tr('an.tkOpen')) + anCard(tkDone, tr('an.tkDone'), 'ok') +
      '</div><div class="an-sub">' + escHtml(tr('an.byCategory')) + '</div>' + byCat + '</div>';
  }

  const anItems = [['cards', 'an.cfg.cards'], ['status', 'an.byStatus'], ['priority', 'an.byPriority'], ['group', 'an.byGroup'], ['completions', 'an.completions'], ['subtasks', 'an.subtasks'], ['notes', 'an.notes']];
  if (USER_ROLE === 'admin' && tickets.length) anItems.push(['tickets', 'an.tickets']);
  const anConfigMenu = '<div class="dropdown an-config-wrap"><button class="btn-ghost" id="an-config-btn"><i data-lucide="sliders-horizontal"></i> <span>' + escHtml(tr('an.configure')) + '</span></button><div class="dropdown-menu" id="an-config-menu"' + (anConfigOpen ? '' : ' hidden') + '>' + anItems.map(it => '<label class="an-config-item"><input type="checkbox" data-ancfg="' + it[0] + '"' + (anOn(it[0]) ? ' checked' : '') + '> ' + escHtml(tr(it[1])) + '</label>').join('') + '</div></div>';

  const miniBlock = '<div class="an-mini"><span><i data-lucide="check-circle-2"></i> <b>' + doneWeek + '</b> ' + escHtml(tr('an.doneWeek')) + '</span><span><i data-lucide="calendar-days"></i> <b>' + doneMonth + '</b> ' + escHtml(tr('an.doneMonth')) + '</span><span><i data-lucide="alarm-clock"></i> <b>' + dueSoon + '</b> ' + escHtml(tr('an.dueSoon')) + '</span></div>';
  const cardsBlock = anOn('cards') ? ('<div class="an-cards">' + cards + '</div>' + miniBlock) : '';
  const gridParts = [];
  if (anOn('status')) gridParts.push('<div class="an-section"><h3>' + escHtml(tr('an.byStatus')) + '</h3>' + byStatus + '</div>');
  if (anOn('priority')) gridParts.push('<div class="an-section"><h3>' + escHtml(tr('an.byPriority')) + '</h3>' + byPrio + '</div>');
  if (anOn('group')) gridParts.push('<div class="an-section"><h3>' + escHtml(tr('an.byGroup')) + '</h3>' + byGroup + '</div>');
  if (anOn('completions')) gridParts.push('<div class="an-section"><h3>' + escHtml(tr('an.completions')) + '</h3>' + (completedTs.length ? colChart : '<div class="an-empty">' + escHtml(tr('an.noData')) + ' ' + escHtml(tr('an.completionsHint')) + '</div>') + '</div>');
  const gridBlock = gridParts.length ? ('<div class="an-grid">' + gridParts.join('') + '</div>') : '';
  const subtasksBlock = anOn('subtasks') ? ('<div class="an-section"><h3>' + escHtml(tr('an.subtasks')) + '</h3>' + subProgress + '</div>') : '';
  const notesBlock = anOn('notes') ? ('<div class="an-section"><h3>' + escHtml(tr('an.notes')) + '</h3><div class="an-cards">' + anCard(noteCount, tr('an.noteCount')) + anCard(noteWords, tr('an.noteWords')) + '</div>' +
    '<div class="an-mini"><span><i data-lucide="file-text"></i> ' + escHtml(tr('an.lastEdited')) + ': <b>' + escHtml(lastNote) + '</b></span></div></div>') : '';
  const tkBlock = anOn('tickets') ? ticketsSection : '';

  board.innerHTML = '<div class="an-wrap">' +
    '<div class="an-header"><h2 class="an-h2">' + escHtml(tr('an.title')) + '</h2>' + anConfigMenu + '</div>' +
    cardsBlock + gridBlock + subtasksBlock + notesBlock + tkBlock +
  '</div>';

  const anCfgBtn = document.getElementById('an-config-btn');
  if (anCfgBtn) anCfgBtn.addEventListener('click', e => { e.stopPropagation(); anConfigOpen = !anConfigOpen; const m = document.getElementById('an-config-menu'); if (m) m.hidden = !anConfigOpen; });
  board.querySelectorAll('[data-ancfg]').forEach(cb => cb.addEventListener('change', () => { anConfig[cb.dataset.ancfg] = cb.checked; saveAnConfig(); anConfigOpen = true; renderBoard(); }));
  if (!window.__anCfgBound) { window.__anCfgBound = true; document.addEventListener('click', e => { if (!e.target.closest('.an-config-wrap')) { anConfigOpen = false; const m = document.getElementById('an-config-menu'); if (m) m.hidden = true; } }); }
  refreshIcons();
}

// ============================================================
//  Presentations (imported HTML slide decks)
// ============================================================
function deckToRow(d, i) { const row = { id: d.id, user_id: USER_ID, title: d.title || '', html: d.html || '', position: i, created_at: new Date(d.created || Date.now()).toISOString() }; if (!decksOmitTags) row.tags = Array.isArray(d.tags) ? d.tags : []; return row; }
function rowToDeck(r) { return { id: r.id, title: r.title || '', html: r.html || '', tags: Array.isArray(r.tags) ? r.tags : [], created: r.created_at ? new Date(r.created_at).getTime() : Date.now() }; }
function saveDecks() { cacheSet('presentations', presentations); scheduleCloudSave('presentations'); }
function deckTitleFromHtml(html, fallback) {
  const m = (html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let t = m ? stripHtml(m[1]).trim() : '';
  if (!t) { const h1 = (html || '').match(/<h1[^>]*>([\s\S]*?)<\/h1>/i); t = h1 ? stripHtml(h1[1]).trim() : ''; }
  return t || fallback || tr('pres.untitled');
}
function renderPresentations(board) {
  if (activeDeckId && !presentations.find(d => d.id === activeDeckId)) activeDeckId = null;

  function computeList() {
    const q = deckSearch.trim().toLowerCase();
    let list = presentations.slice();
    if (q) list = list.filter(d => (d.title || '').toLowerCase().includes(q) || (d.tags || []).some(t => String(t).toLowerCase().includes(q)));
    if (deckSort === 'old') list.sort((a, b) => (a.created || 0) - (b.created || 0));
    else if (deckSort === 'az') list.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    else list.sort((a, b) => (b.created || 0) - (a.created || 0));
    return list;
  }
  if (!activeDeckId) { const l0 = computeList(); if (l0.length) activeDeckId = l0[0].id; }
  const active = presentations.find(d => d.id === activeDeckId) || null;

  function tagChip(t) { return '<span class="deck-tag" data-tag="' + escHtml(t) + '">' + escHtml(t) + '</span>'; }
  function listItemsHtml() {
    if (!presentations.length) return '<div class="notes-empty">' + escHtml(tr('pres.empty')) + '</div>';
    const list = computeList();
    if (!list.length) return '<div class="notes-empty">' + escHtml(tr('pres.noResults')) + '</div>';
    return list.map(d => '<button class="note-item' + (d.id === activeDeckId ? ' active' : '') + '" data-deck="' + escHtml(d.id) + '">' +
      '<span class="note-item-title">' + escHtml(d.title || tr('pres.untitled')) + '</span>' +
      '<span class="note-item-snippet">' + escHtml(new Date(d.created || Date.now()).toLocaleDateString(localeFor(), { day: 'numeric', month: 'short', year: 'numeric' })) + '</span>' +
      ((d.tags && d.tags.length) ? '<span class="deck-tags">' + d.tags.map(tagChip).join('') + '</span>' : '') +
    '</button>').join('');
  }
  const banner = decksTableMissing ? '<div class="notes-banner">' + escHtml(tr('pres.tableMissing')) + '</div>' : '';
  const toolbar = presentations.length
    ? '<div class="deck-toolbar">' +
        '<div class="deck-search"><i data-lucide="search"></i><input type="text" id="deck-search" placeholder="' + escHtml(tr('pres.search')) + '" value="' + escHtml(deckSearch) + '"></div>' +
        '<select class="sort-select" id="deck-sort">' +
          '<option value="new"' + (deckSort === 'new' ? ' selected' : '') + '>' + escHtml(tr('pres.newest')) + '</option>' +
          '<option value="old"' + (deckSort === 'old' ? ' selected' : '') + '>' + escHtml(tr('pres.oldest')) + '</option>' +
          '<option value="az"' + (deckSort === 'az' ? ' selected' : '') + '>' + escHtml(tr('pres.az')) + '</option>' +
        '</select>' +
      '</div>'
    : '';
  function tagsEditorHtml() {
    if (!active) return '';
    return '<div class="deck-tags-edit" id="deck-tags-edit"><i data-lucide="tag"></i>' +
      (active.tags || []).map(t => '<span class="deck-tag editable" data-removetag="' + escHtml(t) + '">' + escHtml(t) + ' <i data-lucide="x"></i></span>').join('') +
      '<input type="text" id="deck-tag-input" placeholder="' + escHtml(tr('pres.tagsPh')) + '"></div>';
  }
  const mainHtml = active
    ? '<div class="note-head"><input type="text" id="deck-title" class="note-title-input" value="' + escHtml(active.title) + '" placeholder="' + escHtml(tr('pres.titlePh')) + '">' +
        '<div class="note-head-actions">' +
          '<button class="btn-ghost" id="deck-present"><i data-lucide="maximize"></i> <span>' + escHtml(tr('pres.present')) + '</span></button>' +
          '<button class="icon-btn" id="deck-del" title="' + escHtml(tr('pres.delete')) + '"><i data-lucide="trash-2"></i></button>' +
        '</div></div>' +
        tagsEditorHtml() +
        '<div class="deck-frame-wrap"><iframe id="deck-frame" class="deck-frame" sandbox="allow-scripts allow-popups allow-modals allow-forms" referrerpolicy="no-referrer"></iframe></div>'
    : '<div class="notes-select">' + escHtml(tr('pres.select')) + '</div>';

  board.innerHTML = banner + '<div class="notes-wrap">' +
      '<div class="notes-list">' +
        '<label class="btn-primary notes-new-btn import-file-btn" style="text-align:center"><i data-lucide="upload"></i> ' + escHtml(tr('pres.import')) + '<input type="file" id="deck-import" accept=".html,.htm,text/html" hidden></label>' +
        toolbar +
        '<div class="notes-items">' + listItemsHtml() + '</div>' +
      '</div>' +
      '<div class="notes-main">' + mainHtml + '</div>' +
    '</div>';

  if (active) { const fr = document.getElementById('deck-frame'); if (fr) fr.srcdoc = active.html; }

  function bindListItems() {
    board.querySelectorAll('[data-deck]').forEach(el => el.addEventListener('click', () => { activeDeckId = el.dataset.deck; renderBoard(); }));
    board.querySelectorAll('.note-item [data-tag]').forEach(el => el.addEventListener('click', ev => { ev.stopPropagation(); deckSearch = el.dataset.tag; updateList(); const se = document.getElementById('deck-search'); if (se) se.value = deckSearch; }));
  }
  function updateList() { const items = board.querySelector('.notes-items'); if (items) { items.innerHTML = listItemsHtml(); bindListItems(); refreshIcons(); } }
  bindListItems();

  const imp = document.getElementById('deck-import');
  if (imp) imp.addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    let html = '';
    try { html = await f.text(); } catch (err) { alert('Could not read file.'); return; }
    const d = { id: 'd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), title: deckTitleFromHtml(html, f.name.replace(/\.[^.]+$/, '')), html: html, tags: [], created: Date.now() };
    presentations.unshift(d); activeDeckId = d.id; deckSearch = ''; saveDecks(); renderBoard();
  });
  const searchEl = document.getElementById('deck-search');
  if (searchEl) searchEl.addEventListener('input', () => { deckSearch = searchEl.value; updateList(); });
  const sortEl = document.getElementById('deck-sort');
  if (sortEl) sortEl.addEventListener('change', () => { deckSort = sortEl.value; try { localStorage.setItem('tb_deck_sort', deckSort); } catch (e) {} markPrefsDirty(); updateList(); });

  const titleEl = document.getElementById('deck-title');
  if (titleEl) titleEl.addEventListener('input', () => {
    const d = presentations.find(x => x.id === activeDeckId); if (!d) return;
    d.title = titleEl.value; saveDecks();
    const lab = board.querySelector('.note-item.active .note-item-title'); if (lab) lab.textContent = d.title || tr('pres.untitled');
  });
  function refreshTagsEditor() { const box = document.getElementById('deck-tags-edit'); if (box) { box.outerHTML = tagsEditorHtml(); bindTags(); refreshIcons(); } updateList(); }
  function bindTags() {
    const tagInput = document.getElementById('deck-tag-input');
    if (tagInput) tagInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const d = presentations.find(x => x.id === activeDeckId); if (!d) return;
        if (!Array.isArray(d.tags)) d.tags = [];
        const v = tagInput.value.replace(/,/g, '').trim();
        if (v && !d.tags.includes(v)) { d.tags.push(v); saveDecks(); refreshTagsEditor(); const ti = document.getElementById('deck-tag-input'); if (ti) ti.focus(); }
        else tagInput.value = '';
      }
    });
    board.querySelectorAll('[data-removetag]').forEach(el => el.addEventListener('click', () => {
      const d = presentations.find(x => x.id === activeDeckId); if (!d || !Array.isArray(d.tags)) return;
      d.tags = d.tags.filter(t => t !== el.dataset.removetag); saveDecks(); refreshTagsEditor();
    }));
  }
  bindTags();

  const delBtn = document.getElementById('deck-del');
  if (delBtn) delBtn.addEventListener('click', () => {
    if (!confirm(tr('pres.deleteConfirm'))) return;
    presentations = presentations.filter(x => x.id !== activeDeckId); activeDeckId = null; saveDecks(); renderBoard();
  });
  const presentBtn = document.getElementById('deck-present');
  if (presentBtn) presentBtn.addEventListener('click', () => {
    const fr = document.getElementById('deck-frame');
    if (fr && fr.requestFullscreen) fr.requestFullscreen().catch(() => {});
    else if (fr && fr.webkitRequestFullscreen) fr.webkitRequestFullscreen();
  });
  refreshIcons();
}

// ============================================================
//  Notes — Markdown table editing (rich mode)
// ============================================================
function tableCurrentCell(editor) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  let node = sel.getRangeAt(0).startContainer;
  while (node && node !== editor) { if (node.nodeType === 1 && (node.tagName === 'TD' || node.tagName === 'TH')) return node; node = node.parentNode; }
  return null;
}
function tableColIndex(cell) { let i = 0, n = cell; while ((n = n.previousElementSibling)) i++; return i; }
function tableOf(cell) { let n = cell; while (n && n.tagName !== 'TABLE') n = n.parentNode; return n; }
function tableNewCell(tag) { const c = document.createElement(tag); c.innerHTML = '<br>'; return c; }
function tableInsert() {
  const html = '<table><thead><tr><th>Col 1</th><th>Col 2</th><th>Col 3</th></tr></thead><tbody>' +
    '<tr><td><br></td><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td><td><br></td></tr></tbody></table><p><br></p>';
  document.execCommand('insertHTML', false, html);
}
function tableOp(editor, op) {
  if (op === 'insert') { tableInsert(); editor.dispatchEvent(new Event('input', { bubbles: true })); return; }
  const cell = tableCurrentCell(editor); if (!cell) return;
  const table = tableOf(cell); if (!table) return;
  const row = cell.parentNode, idx = tableColIndex(cell), allRows = [...table.querySelectorAll('tr')];
  if (op === 'addRow') {
    const cols = (table.tHead && table.tHead.rows[0]) ? table.tHead.rows[0].cells.length : row.cells.length;
    const tr = document.createElement('tr');
    for (let k = 0; k < cols; k++) tr.appendChild(tableNewCell('td'));
    if (cell.tagName === 'TH' && table.tBodies[0]) table.tBodies[0].insertBefore(tr, table.tBodies[0].firstChild);
    else row.parentNode.insertBefore(tr, row.nextSibling);
  } else if (op === 'addCol') {
    allRows.forEach(r => { const ref = r.cells[idx]; const tag = (r.parentNode && r.parentNode.tagName === 'THEAD') ? 'th' : 'td'; r.insertBefore(tableNewCell(tag), ref ? ref.nextSibling : null); });
  } else if (op === 'delRow') {
    if (cell.tagName === 'TH') return;
    if (table.tBodies[0] && table.tBodies[0].rows.length <= 1) return;
    row.parentNode.removeChild(row);
  } else if (op === 'delCol') {
    if (allRows[0] && allRows[0].cells.length <= 1) return;
    allRows.forEach(r => { if (r.cells[idx]) r.removeChild(r.cells[idx]); });
  } else if (op === 'alignLeft' || op === 'alignCenter' || op === 'alignRight') {
    const dir = op === 'alignLeft' ? 'left' : (op === 'alignCenter' ? 'center' : 'right');
    allRows.forEach(r => { if (r.cells[idx]) r.cells[idx].style.textAlign = dir; });
  }
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

// ============================================================
//  Notes — wiki links, graph, insert tokens, export
// ============================================================
function preprocessWiki(md) {
  return String(md).replace(/\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g, function (m, t, alias) {
    const title = t.trim(); const label = (alias || t).trim();
    return '<a class="note-link" data-note-link="' + escHtml(title) + '">' + escHtml(label) + '</a>';
  });
}
function openNoteByTitle(title) {
  const t = String(title || '').trim().toLowerCase();
  let n = notes.find(x => (x.title || '').trim().toLowerCase() === t);
  if (!n) { n = { id: 'n_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), title: String(title).trim(), content: '', created: Date.now() }; notes.unshift(n); saveNotes(); }
  activeNoteId = n.id; notesGraph = false; currentView = 'notes';
  renderBoard();
}
function bindNoteLinks(root) {
  if (!root) return;
  root.addEventListener('click', function (e) { const a = e.target.closest('[data-note-link]'); if (a) { e.preventDefault(); openNoteByTitle(a.getAttribute('data-note-link')); } });
}
function noteInsertText(text) {
  if (noteMode === 'rich') {
    const editor = document.getElementById('note-rich'); if (!editor) return;
    editor.focus();
    const sel = window.getSelection();
    if (noteCaret && editor.contains(noteCaret.commonAncestorContainer)) { sel.removeAllRanges(); sel.addRange(noteCaret); }
    document.execCommand('insertText', false, text);
    if (sel.rangeCount) noteCaret = sel.getRangeAt(0).cloneRange();
  } else {
    const el = document.getElementById('note-content'); if (!el) return;
    const sS = el.selectionStart != null ? el.selectionStart : el.value.length;
    const sE = el.selectionEnd != null ? el.selectionEnd : el.value.length;
    el.setRangeText(text, sS, sE, 'end'); el.focus();
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
function noteInsertWiki(title) {
  if (noteMode === 'rich') {
    const editor = document.getElementById('note-rich'); if (!editor) return;
    editor.focus();
    const sel = window.getSelection();
    if (noteCaret && editor.contains(noteCaret.commonAncestorContainer)) { sel.removeAllRanges(); sel.addRange(noteCaret); }
    document.execCommand('insertHTML', false, '<a class="note-link" data-note-link="' + escHtml(title) + '">' + escHtml(title) + '</a>&nbsp;');
    if (sel.rangeCount) noteCaret = sel.getRangeAt(0).cloneRange();
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    noteInsertText('[[' + title + ']]');
  }
}
function insertToken(kind) {
  const d = new Date();
  if (kind === 'date') noteInsertText(d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()));
  else if (kind === 'datetime') noteInsertText(d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()));
  else if (kind === 'tag') { const t = prompt(tr('ins.tagPrompt')); if (t && t.trim()) noteInsertText('#' + t.trim().replace(/\s+/g, '-')); }
  else if (kind === 'attr') { const k = prompt(tr('ins.attrPrompt')); if (k && k.trim()) noteInsertText(k.trim() + ':: '); }
  else if (kind === 'link') openNoteLinkPicker();
}
function openNoteLinkPicker() {
  const others = notes.filter(n => n.id !== activeNoteId);
  const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><h2>' + escHtml(tr('ins.linkTitle')) + '</h2>' +
    '<input type="text" id="nlp-search" class="search-input" style="width:100%;max-width:none;margin-bottom:10px" placeholder="' + escHtml(tr('ins.linkPh')) + '">' +
    '<div class="nlp-list" id="nlp-list"></div>' +
    '<div class="modal-actions"><button type="button" class="btn-secondary" id="nlp-cancel">' + escHtml(tr('m.cancel')) + '</button></div></div>';
  document.body.appendChild(backdrop);
  function close() { if (backdrop.parentNode) document.body.removeChild(backdrop); document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  document.getElementById('nlp-cancel').addEventListener('click', close);
  function renderList(q) {
    const ql = (q || '').toLowerCase();
    const list = others.filter(n => (n.title || tr('notes.untitled')).toLowerCase().includes(ql));
    document.getElementById('nlp-list').innerHTML = list.length
      ? list.map(n => '<button class="nlp-item" data-nlp="' + escHtml(n.title || '') + '">' + escHtml(n.title || tr('notes.untitled')) + '</button>').join('')
      : '<div class="notes-empty">' + escHtml(tr('pres.noResults')) + '</div>';
    document.querySelectorAll('[data-nlp]').forEach(b => b.addEventListener('click', () => { const ttl = b.dataset.nlp; close(); noteInsertWiki(ttl); }));
  }
  document.getElementById('nlp-search').addEventListener('input', e => renderList(e.target.value));
  renderList(''); document.getElementById('nlp-search').focus();
}
function noteStandaloneHtml(note) {
  const body = renderMarkdown(note.content);
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + escHtml(note.title || 'note') + '</title>' +
    '<style>body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:760px;margin:40px auto;padding:0 22px;color:#222;line-height:1.65}' +
    'h1,h2,h3,h4{line-height:1.25}table{border-collapse:collapse;margin:.6em 0}th,td{border:1px solid #ccc;padding:6px 10px}th{background:#f4f4f6}' +
    'code{background:#f3f3f5;padding:1px 5px;border-radius:4px}pre{background:#f3f3f5;padding:12px;border-radius:8px;overflow:auto}' +
    'blockquote{border-left:3px solid #ddd;margin:.6em 0;padding:.2em 0 .2em 12px;color:#666}a{color:#6161ff}.note-link{color:#6161ff}img{max-width:100%}</style></head><body>' +
    '<h1>' + escHtml(note.title || 'Untitled') + '</h1>' + body + '</body></html>';
}
function toastNote(msg) {
  const el = document.createElement('div'); el.className = 'tb-toast'; el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 220); }, 1700);
}
function exportNote(kind) {
  const note = notes.find(n => n.id === activeNoteId); if (!note) return;
  if (kind === 'html') {
    const name = (note.title || 'note').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'note';
    download(name + '.html', noteStandaloneHtml(note), 'text/html;charset=utf-8');
  } else if (kind === 'pdf') {
    const w = window.open('', '_blank');
    if (!w) { alert(tr('exp.popup')); return; }
    w.document.write(noteStandaloneHtml(note)); w.document.close(); w.focus();
    setTimeout(() => { try { w.print(); } catch (e) {} }, 400);
  } else if (kind === 'copy') {
    const md = note.content || '';
    const html = renderMarkdown(note.content);
    if (navigator.clipboard && window.ClipboardItem) {
      try {
        navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([md], { type: 'text/plain' }) })])
          .then(() => toastNote(tr('exp.copied'))).catch(() => navigator.clipboard.writeText(md).then(() => toastNote(tr('exp.copied'))));
      } catch (e) { navigator.clipboard.writeText(md).then(() => toastNote(tr('exp.copied'))); }
    } else if (navigator.clipboard) { navigator.clipboard.writeText(md).then(() => toastNote(tr('exp.copied'))); }
    else { alert(md); }
  }
}
// --- graph node helpers (physics + per-node color/size/shape) ---
function saveGraphNodes() { try { localStorage.setItem('tb_graph_nodes', JSON.stringify(graphNodeOverrides)); } catch (e) {} markPrefsDirty(); }
function saveGraphPositions(nodes) { try { const o = {}; nodes.forEach(n => { o[n.id] = { x: Math.round(n.x), y: Math.round(n.y) }; }); graphPositions = o; localStorage.setItem('tb_graph_pos', JSON.stringify(o)); } catch (e) {} markPrefsDirty(); }
function cancelGraphSim() { if (graphRaf) { cancelAnimationFrame(graphRaf); graphRaf = 0; } }
function gOverride(id) { return graphNodeOverrides[id] || (graphNodeOverrides[id] = {}); }
function gColor(id) { const o = graphNodeOverrides[id]; return (o && o.color) || graphNodeColor; }
function gSize(id) { const o = graphNodeOverrides[id]; return (o && o.size) || graphNodeSize; }
function gShape(id) { const o = graphNodeOverrides[id]; return (o && o.shape) || 'circle'; }
function gPolyPoints(sides, r, rot) { const p = []; for (let i = 0; i < sides; i++) { const a = rot + i / sides * Math.PI * 2; p.push((Math.cos(a) * r).toFixed(1) + ',' + (Math.sin(a) * r).toFixed(1)); } return p.join(' '); }
function gStarPoints(r) { const p = []; for (let i = 0; i < 10; i++) { const rr = (i % 2) ? r * 0.45 : r; const a = -Math.PI / 2 + i / 10 * Math.PI * 2; p.push((Math.cos(a) * rr).toFixed(1) + ',' + (Math.sin(a) * rr).toFixed(1)); } return p.join(' '); }
function gShapeMarkup(shape, r, color) {
  const f = ' fill="' + color + '"', cls = ' class="node-shape"';
  if (shape === 'square') { const s2 = r * 1.8; return '<rect' + cls + ' x="' + (-s2 / 2).toFixed(1) + '" y="' + (-s2 / 2).toFixed(1) + '" width="' + s2.toFixed(1) + '" height="' + s2.toFixed(1) + '" rx="' + (s2 * 0.16).toFixed(1) + '"' + f + '/>'; }
  if (shape === 'triangle') return '<polygon' + cls + ' points="' + gPolyPoints(3, r * 1.35, -Math.PI / 2) + '"' + f + '/>';
  if (shape === 'diamond') return '<polygon' + cls + ' points="' + gPolyPoints(4, r * 1.35, -Math.PI / 2) + '"' + f + '/>';
  if (shape === 'hexagon') return '<polygon' + cls + ' points="' + gPolyPoints(6, r * 1.18, Math.PI / 6) + '"' + f + '/>';
  if (shape === 'star') return '<polygon' + cls + ' points="' + gStarPoints(r * 1.3) + '"' + f + '/>';
  return '<circle' + cls + ' r="' + r.toFixed(1) + '"' + f + '/>';
}
function gNodeInner(node) { const r = node.baseR * gSize(node.id); return gShapeMarkup(gShape(node.id), r, gColor(node.id)) + '<text y="' + (r + 13).toFixed(1) + '">' + escHtml(node.title.slice(0, 24)) + '</text>'; }

function renderNotesGraph(board) {
  cancelGraphSim();
  const nodes = notes.map(n => ({ id: n.id, title: n.title || tr('notes.untitled'), deg: 0, x: 0, y: 0, vx: 0, vy: 0, fx: 0, fy: 0, pinned: false, baseR: 8 }));
  const idIndex = {}; nodes.forEach((n, i) => idIndex[n.id] = i);
  const byTitle = {}; notes.forEach(n => { byTitle[(n.title || '').trim().toLowerCase()] = n.id; });
  const edges = [];
  notes.forEach(n => {
    const refs = (n.content || '').match(/\[\[([^\]|\n]+?)(?:\|[^\]\n]+?)?\]\]/g) || [];
    refs.forEach(r => { const t = r.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim().toLowerCase(); const tid = byTitle[t]; if (tid && tid !== n.id) edges.push([n.id, tid]); });
  });
  edges.forEach(e => { const a = nodes[idIndex[e[0]]], b = nodes[idIndex[e[1]]]; if (a) a.deg++; if (b) b.deg++; });
  nodes.forEach(n => { n.baseR = 8 + Math.min(14, n.deg * 2); });
  const W = 820, H = 560;
  nodes.forEach((n, i) => {
    const sp = graphPositions[n.id];
    if (sp && isFinite(sp.x) && isFinite(sp.y)) { n.x = sp.x; n.y = sp.y; }
    else { const ang = (i / Math.max(1, nodes.length)) * Math.PI * 2; n.x = W / 2 + Math.cos(ang) * 170 + (i % 2 ? 18 : -18); n.y = H / 2 + Math.sin(ang) * 170; }
  });
  graphZoom = 1; graphPanX = 0; graphPanY = 0; graphSelectedId = null;
  const controls = '<div class="graph-controls">' +
    '<span class="graph-ctl-group">' +
      '<button class="icon-btn" data-gzoom="out" title="' + escHtml(tr('graph.zoomOut')) + '"><i data-lucide="minus"></i></button>' +
      '<button class="icon-btn" data-gzoom="in" title="' + escHtml(tr('graph.zoomIn')) + '"><i data-lucide="plus"></i></button>' +
      '<button class="icon-btn" data-gzoom="reset" title="' + escHtml(tr('graph.reset')) + '"><i data-lucide="maximize"></i></button>' +
    '</span>' +
    '<span class="graph-ctl-group graph-size" title="' + escHtml(tr('graph.nodeSize')) + '"><i data-lucide="circle"></i><input type="range" id="graph-size" min="0.5" max="2.5" step="0.1" value="' + graphNodeSize + '"></span>' +
    '<span class="graph-ctl-group graph-colors">' + GRAPH_COLORS.map(c => '<button class="graph-color-sw' + (c === graphNodeColor ? ' active' : '') + '" data-gcolor="' + c + '" style="background:' + c + '" title="' + escHtml(tr('graph.nodeColor')) + '"></button>').join('') + '</span>' +
    '</div>';
  const linesSvg = edges.map(() => '<line class="graph-edge"/>').join('');
  const nodesSvg = nodes.map(n => '<g class="graph-node" data-graph-note="' + escHtml(n.id) + '">' + gNodeInner(n) + '</g>').join('');
  board.innerHTML = '<div class="graph-wrap"><div class="graph-head"><button class="btn-ghost" id="graph-back"><i data-lucide="arrow-left"></i> <span>' + escHtml(tr('graph.back')) + '</span></button><span class="graph-title">' + escHtml(tr('graph.title')) + ' · ' + nodes.length + '</span>' + (nodes.length ? controls : '') + '</div>' +
    '<div class="graph-node-panel" id="graph-node-panel" hidden></div>' +
    (nodes.length ? '<svg viewBox="0 0 ' + W + ' ' + H + '" class="graph-svg" preserveAspectRatio="xMidYMid meet"><g id="graph-vp"><g class="graph-edges">' + linesSvg + '</g><g class="graph-nodes">' + nodesSvg + '</g></g></svg>' : '<div class="notes-empty">' + escHtml(tr('notes.empty')) + '</div>') + '</div>';
  const backBtn = document.getElementById('graph-back'); if (backBtn) backBtn.addEventListener('click', () => { cancelGraphSim(); saveGraphPositions(nodes); notesGraph = false; renderBoard(); });
  const svg = board.querySelector('.graph-svg'), vp = board.querySelector('#graph-vp');
  if (!svg) { refreshIcons(); return; }
  const lineEls = [...svg.querySelectorAll('.graph-edge')];
  const nodeEls = {}; svg.querySelectorAll('.graph-node').forEach(g => { nodeEls[g.getAttribute('data-graph-note')] = g; });

  function applyVp() { vp.setAttribute('transform', 'translate(' + graphPanX.toFixed(1) + ' ' + graphPanY.toFixed(1) + ') scale(' + graphZoom.toFixed(3) + ')'); }
  function zoomAt(vbX, vbY, factor) { const nz = Math.max(0.3, Math.min(4, graphZoom * factor)); const wx = (vbX - graphPanX) / graphZoom, wy = (vbY - graphPanY) / graphZoom; graphPanX = vbX - wx * nz; graphPanY = vbY - wy * nz; graphZoom = nz; applyVp(); }
  function clientToWorld(cx, cy) { const rect = svg.getBoundingClientRect(); const vbX = (cx - rect.left) / rect.width * W, vbY = (cy - rect.top) / rect.height * H; return { x: (vbX - graphPanX) / graphZoom, y: (vbY - graphPanY) / graphZoom }; }
  function paintPositions() {
    nodes.forEach(n => { const g = nodeEls[n.id]; if (g) g.setAttribute('transform', 'translate(' + n.x.toFixed(1) + ',' + n.y.toFixed(1) + ')'); });
    edges.forEach((e, i) => { const a = nodes[idIndex[e[0]]], b = nodes[idIndex[e[1]]], ln = lineEls[i]; if (ln && a && b) { ln.setAttribute('x1', a.x.toFixed(1)); ln.setAttribute('y1', a.y.toFixed(1)); ln.setAttribute('x2', b.x.toFixed(1)); ln.setAttribute('y2', b.y.toFixed(1)); } });
  }
  applyVp(); paintPositions();

  let dragId = null, mode = null, movedFlag = false, sx = 0, sy = 0, panLX = 0, panLY = 0;
  let alpha = 0.9;
  function step() {
    const n = nodes.length;
    for (let i = 0; i < n; i++) { nodes[i].fx = 0; nodes[i].fy = 0; }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      let dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, d2 = dx * dx + dy * dy; if (d2 < 25) d2 = 25;
      const d = Math.sqrt(d2), f = 9000 / d2, ux = dx / d, uy = dy / d;
      nodes[i].fx += ux * f; nodes[i].fy += uy * f; nodes[j].fx -= ux * f; nodes[j].fy -= uy * f;
    }
    edges.forEach(e => { const a = nodes[idIndex[e[0]]], b = nodes[idIndex[e[1]]]; let dx = b.x - a.x, dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) || 0.01, f = (d - 100) * 0.05, ux = dx / d, uy = dy / d; a.fx += ux * f; a.fy += uy * f; b.fx -= ux * f; b.fy -= uy * f; });
    nodes.forEach(nn => { nn.fx += (W / 2 - nn.x) * 0.02; nn.fy += (H / 2 - nn.y) * 0.02; });
    nodes.forEach(nn => { if (nn.pinned) { nn.vx = 0; nn.vy = 0; return; } nn.vx = (nn.vx + nn.fx) * 0.8; nn.vy = (nn.vy + nn.fy) * 0.8; nn.vx = Math.max(-45, Math.min(45, nn.vx)); nn.vy = Math.max(-45, Math.min(45, nn.vy)); nn.x += nn.vx * alpha; nn.y += nn.vy * alpha; });
  }
  function tick() {
    if (!svg.isConnected) { graphRaf = 0; saveGraphPositions(nodes); return; }
    step(); paintPositions();
    if (!dragId) alpha *= 0.985;
    if (alpha > 0.02 || dragId) { graphRaf = requestAnimationFrame(tick); }
    else { graphRaf = 0; saveGraphPositions(nodes); }
  }
  function ensureLoop() { if (!graphRaf) graphRaf = requestAnimationFrame(tick); }

  function deselectNode() { graphSelectedId = null; Object.keys(nodeEls).forEach(k => nodeEls[k].classList.remove('selected')); const p = document.getElementById('graph-node-panel'); if (p) { p.hidden = true; p.innerHTML = ''; } }
  function selectNode(id) { graphSelectedId = id; Object.keys(nodeEls).forEach(k => nodeEls[k].classList.toggle('selected', k === id)); renderNodePanel(nodes[idIndex[id]]); }
  function renderNodePanel(node) {
    const panel = document.getElementById('graph-node-panel'); if (!panel || !node) return;
    const shapes = ['circle', 'square', 'triangle', 'diamond', 'hexagon', 'star'];
    panel.innerHTML =
      '<span class="gnp-title" title="' + escHtml(node.title) + '">' + escHtml(node.title) + '</span>' +
      '<span class="gnp-group">' + GRAPH_COLORS.map(c => '<button class="graph-color-sw' + (gColor(node.id) === c ? ' active' : '') + '" data-np-color="' + c + '" style="background:' + c + '"></button>').join('') + '</span>' +
      '<span class="gnp-group"><button class="icon-btn" data-np-size="-1" title="' + escHtml(tr('graph.smaller')) + '"><i data-lucide="minus"></i></button><button class="icon-btn" data-np-size="1" title="' + escHtml(tr('graph.bigger')) + '"><i data-lucide="plus"></i></button></span>' +
      '<span class="gnp-group gnp-shapes">' + shapes.map(sh => '<button class="gnp-shape' + (gShape(node.id) === sh ? ' active' : '') + '" data-np-shape="' + sh + '" title="' + sh + '"><svg viewBox="-11 -11 22 22" width="17" height="17">' + gShapeMarkup(sh, 8, 'currentColor') + '</svg></button>').join('') + '</span>' +
      '<span class="graph-ctl-sep"></span>' +
      '<button class="btn-ghost" data-np-open><i data-lucide="external-link"></i> <span>' + escHtml(tr('graph.openNote')) + '</span></button>' +
      '<button class="btn-ghost" data-np-reset>' + escHtml(tr('graph.resetNode')) + '</button>' +
      '<button class="icon-btn" data-np-close><i data-lucide="x"></i></button>';
    panel.hidden = false;
    const repaint = () => { const g = nodeEls[node.id]; if (g) g.innerHTML = gNodeInner(node); };
    panel.querySelectorAll('[data-np-color]').forEach(b => b.addEventListener('click', () => { gOverride(node.id).color = b.dataset.npColor; saveGraphNodes(); repaint(); panel.querySelectorAll('[data-np-color]').forEach(x => x.classList.toggle('active', x === b)); }));
    panel.querySelectorAll('[data-np-size]').forEach(b => b.addEventListener('click', () => { const next = Math.max(0.5, Math.min(3, gSize(node.id) + parseInt(b.dataset.npSize, 10) * 0.25)); gOverride(node.id).size = next; saveGraphNodes(); repaint(); }));
    panel.querySelectorAll('[data-np-shape]').forEach(b => b.addEventListener('click', () => { gOverride(node.id).shape = b.dataset.npShape; saveGraphNodes(); repaint(); panel.querySelectorAll('[data-np-shape]').forEach(x => x.classList.toggle('active', x === b)); }));
    const op = panel.querySelector('[data-np-open]'); if (op) op.addEventListener('click', () => { cancelGraphSim(); saveGraphPositions(nodes); activeNoteId = node.id; notesGraph = false; renderBoard(); });
    const rs = panel.querySelector('[data-np-reset]'); if (rs) rs.addEventListener('click', () => { delete graphNodeOverrides[node.id]; saveGraphNodes(); repaint(); renderNodePanel(node); });
    const cl = panel.querySelector('[data-np-close]'); if (cl) cl.addEventListener('click', deselectNode);
    refreshIcons();
  }
  ensureLoop();

  svg.addEventListener('wheel', e => { e.preventDefault(); const rect = svg.getBoundingClientRect(); zoomAt((e.clientX - rect.left) / rect.width * W, (e.clientY - rect.top) / rect.height * H, e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
  svg.addEventListener('pointerdown', e => {
    try { svg.setPointerCapture(e.pointerId); } catch (er) {}
    sx = e.clientX; sy = e.clientY; movedFlag = false;
    const ng = e.target.closest('.graph-node');
    if (ng) { mode = 'node'; dragId = ng.getAttribute('data-graph-note'); }
    else { mode = 'pan'; panLX = e.clientX; panLY = e.clientY; svg.classList.add('grabbing'); }
  });
  svg.addEventListener('pointermove', e => {
    if (mode === 'pan') { const rect = svg.getBoundingClientRect(); graphPanX += (e.clientX - panLX) / rect.width * W; graphPanY += (e.clientY - panLY) / rect.height * H; panLX = e.clientX; panLY = e.clientY; applyVp(); return; }
    if (mode === 'node' && dragId) {
      if (!movedFlag && (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy)) < 4) return;
      movedFlag = true;
      const nd = nodes[idIndex[dragId]]; if (!nd) return;
      nd.pinned = true; const w = clientToWorld(e.clientX, e.clientY); nd.x = w.x; nd.y = w.y; nd.vx = 0; nd.vy = 0;
      alpha = Math.max(alpha, 0.5); ensureLoop();
    }
  });
  function endPointer() {
    if (mode === 'node' && dragId) {
      const nd = nodes[idIndex[dragId]];
      if (!movedFlag) { selectNode(dragId); }
      else { if (nd) nd.pinned = false; alpha = Math.max(alpha, 0.3); ensureLoop(); saveGraphPositions(nodes); }
    } else if (mode === 'pan') { svg.classList.remove('grabbing'); }
    mode = null; dragId = null;
  }
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);
  svg.addEventListener('dblclick', e => { const ng = e.target.closest('.graph-node'); if (ng) { cancelGraphSim(); saveGraphPositions(nodes); activeNoteId = ng.getAttribute('data-graph-note'); notesGraph = false; renderBoard(); } });

  const zb = sel => board.querySelector('[data-gzoom="' + sel + '"]');
  if (zb('in')) zb('in').addEventListener('click', () => zoomAt(W / 2, H / 2, 1.2));
  if (zb('out')) zb('out').addEventListener('click', () => zoomAt(W / 2, H / 2, 1 / 1.2));
  if (zb('reset')) zb('reset').addEventListener('click', () => { graphZoom = 1; graphPanX = 0; graphPanY = 0; applyVp(); });
  const sizeEl = document.getElementById('graph-size');
  if (sizeEl) sizeEl.addEventListener('input', () => { graphNodeSize = parseFloat(sizeEl.value) || 1; saveGraphPrefs(); nodes.forEach(nd => { if (!(graphNodeOverrides[nd.id] && graphNodeOverrides[nd.id].size)) { const g = nodeEls[nd.id]; if (g) g.innerHTML = gNodeInner(nd); } }); });
  board.querySelectorAll('[data-gcolor]').forEach(b => b.addEventListener('click', () => { graphNodeColor = b.dataset.gcolor; saveGraphPrefs(); board.querySelectorAll('[data-gcolor]').forEach(x => x.classList.toggle('active', x === b)); nodes.forEach(nd => { if (!(graphNodeOverrides[nd.id] && graphNodeOverrides[nd.id].color)) { const g = nodeEls[nd.id]; if (g) g.innerHTML = gNodeInner(nd); } }); }));
  refreshIcons();
}

// ============================================================
//  Account menu (topbar)
// ============================================================
function setupAccountMenu() {
  const btn  = document.getElementById('account-btn');
  const menu = document.getElementById('account-menu');
  if (!btn || !menu) return;
  btn.addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', e => {
    if (!e.target.closest('#account-menu') && !e.target.closest('#account-btn')) menu.hidden = true;
  });
  document.getElementById('acct-sync').addEventListener('click', async () => { menu.hidden = true; await syncNow(); });
  document.getElementById('acct-signout').addEventListener('click', async () => {
    menu.hidden = true;
    if (!confirm(tr('confirm.signout'))) return;
    await signOut();
  });
  const photoBtn = document.getElementById('acct-photo');
  const photoInput = document.getElementById('avatar-input');
  if (photoBtn && photoInput) {
    photoBtn.addEventListener('click', () => { menu.hidden = true; photoInput.click(); });
    photoInput.addEventListener('change', e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      readAvatarFile(f, url => {
        avatarUrl = url;
        try { localStorage.setItem('tb_' + USER_ID + '_avatar', url); } catch (err) { alert('Image too large.'); return; }
        refreshAccountMenu();
        markPrefsDirty();
      });
    });
  }
  const rmBtn = document.getElementById('acct-photo-remove');
  if (rmBtn) rmBtn.addEventListener('click', () => { menu.hidden = true; avatarUrl = ''; try { localStorage.removeItem('tb_' + USER_ID + '_avatar'); } catch (e) {} refreshAccountMenu(); markPrefsDirty(); });
}
function refreshAccountMenu() {
  const em = document.getElementById('acct-email');
  if (em) em.textContent = USER_EMAIL || '';
  const av = document.getElementById('account-btn');
  if (av) {
    if (avatarUrl) { av.innerHTML = '<img class="avatar-img" alt="" src="' + avatarUrl + '">'; av.classList.add('has-avatar'); }
    else { av.textContent = (USER_EMAIL ? USER_EMAIL[0] : '?').toUpperCase(); av.classList.remove('has-avatar'); }
  }
}
function loadAvatar() { avatarUrl = (USER_ID && localStorage.getItem('tb_' + USER_ID + '_avatar')) || ''; }
function readAvatarFile(file, cb) {
  const rd = new FileReader();
  rd.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 256; const scale = Math.min(1, max / Math.max(img.width, img.height));
      const cw = Math.max(1, Math.round(img.width * scale)), ch = Math.max(1, Math.round(img.height * scale));
      const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
      cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
      try { cb(cv.toDataURL('image/jpeg', 0.85)); } catch (e) { cb(rd.result); }
    };
    img.onerror = () => cb(rd.result);
    img.src = rd.result;
  };
  rd.readAsDataURL(file);
}

// ============================================================
//  Theme
// ============================================================
const STORE_THEME = 'tb_theme';
const THEMES = [
  { id: 'light',    dark: false, bg: '#f6f7fb', accent: '#6161ff' },
  { id: 'dim',      dark: false, bg: '#dcdfe6', accent: '#5d5dea' },
  { id: 'dark',     dark: true,  bg: '#15171f', accent: '#7b7bff' },
  { id: 'midnight', dark: true,  bg: '#0f1226', accent: '#8b9cff' },
  { id: 'forest',   dark: true,  bg: '#0e1a15', accent: '#3fbf86' },
  { id: 'ocean',    dark: false, bg: '#eef6fb', accent: '#0ea5b7' },
  { id: 'rose',     dark: false, bg: '#fbf1f3', accent: '#e0608a' },
];
function applyTheme(theme) {
  const t = THEMES.find(x => x.id === theme) || THEMES[0];
  document.documentElement.setAttribute('data-theme', t.id);
  document.documentElement.setAttribute('data-mode', t.dark ? 'dark' : 'light');
  try { localStorage.setItem(STORE_THEME, t.id); } catch (e) {}
  markPrefsDirty();
  updateThemeActive();
}
function loadTheme() {
  let theme = localStorage.getItem(STORE_THEME);
  if (!theme || !THEMES.find(t => t.id === theme)) theme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  applyTheme(theme);
}
function updateThemeActive() {
  const cur = document.documentElement.getAttribute('data-theme');
  document.querySelectorAll('[data-theme-check]').forEach(el => { el.style.visibility = (el.getAttribute('data-theme-check') === cur) ? 'visible' : 'hidden'; });
}
function buildThemeMenu() {
  const menu = document.getElementById('theme-menu');
  if (!menu) return;
  menu.innerHTML = THEMES.map(t =>
    '<button class="dropdown-item theme-opt" data-theme-opt="' + t.id + '">' +
      '<span class="theme-swatch" style="background:' + t.bg + ';border-color:' + t.accent + '"><span style="background:' + t.accent + '"></span></span>' +
      '<span>' + escHtml(tr('theme.' + t.id)) + '</span>' +
      '<span class="theme-check" data-theme-check="' + t.id + '"><i data-lucide="check"></i></span>' +
    '</button>'
  ).join('');
  refreshIcons();
  updateThemeActive();
}
function setupThemeMenu() {
  const btn = document.getElementById('theme-btn');
  const menu = document.getElementById('theme-menu');
  if (!btn || !menu) return;
  buildThemeMenu();
  btn.addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', e => { if (!e.target.closest('#theme-menu') && !e.target.closest('#theme-btn')) menu.hidden = true; });
  menu.addEventListener('click', e => { const o = e.target.closest('[data-theme-opt]'); if (o) { applyTheme(o.getAttribute('data-theme-opt')); menu.hidden = true; } });
}

// ============================================================
//  Auth UI (email + password)
// ============================================================
// Self-service "Create account" in the UI. Keep this false for a private board.
// IMPORTANT: the real lock is in Supabase (Authentication → turn OFF "Allow new
// users to sign up"). Hiding the button here is cosmetic on its own.
const ALLOW_SIGNUP = false;
let authMode = 'signin';
function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (!el) return;
  el.textContent = msg || '';
  el.hidden = !msg;
}
function setAuthMode(mode) {
  authMode = mode;
  const title  = document.getElementById('auth-title');
  const sub    = document.getElementById('auth-formsub');
  const submit = document.getElementById('auth-submit');
  const tog    = document.getElementById('auth-toggle');
  if (title)  title.textContent  = mode === 'signup' ? tr('auth.createTitle') : tr('auth.welcome');
  if (sub)    sub.textContent    = mode === 'signup' ? tr('auth.createSub') : tr('auth.welcomeSub');
  if (submit) submit.textContent = mode === 'signup' ? tr('auth.create') : tr('auth.signin');
  if (tog)    tog.textContent    = mode === 'signup' ? tr('auth.toSignin') : tr('auth.toCreate');
  showAuthError('');
}
function showAuthScreen(showForm) {
  document.getElementById('auth-screen').hidden = false;
  document.getElementById('app-root').hidden = true;
  document.getElementById('auth-loading').hidden = !!showForm;
  document.getElementById('auth-form').hidden = !showForm;
}
function hideAuthScreen() {
  document.getElementById('auth-screen').hidden = true;
  document.getElementById('app-root').hidden = false;
}
function translateAuthError(msg) {
  if (!msg) return tr('auth.errGeneric');
  if (/Invalid login credentials/i.test(msg)) return tr('auth.errInvalid');
  if (/already registered/i.test(msg)) return tr('auth.errExists');
  if (/Password should be at least/i.test(msg)) return tr('auth.errWeak');
  if (/Email not confirmed/i.test(msg)) return tr('auth.errUnconfirmed');
  if (/Signups not allowed|signup is disabled|not allowed/i.test(msg)) return tr('auth.errSignupOff');
  if (/rate limit|too many/i.test(msg)) return tr('auth.errRate');
  return msg;
}
function setupAuthUI() {
  const switchLine = document.getElementById('auth-switch-line');
  const restricted = document.getElementById('auth-restricted');
  if (ALLOW_SIGNUP) {
    if (switchLine) switchLine.hidden = false;
    if (restricted) restricted.hidden = true;
    const tog = document.getElementById('auth-toggle');
    if (tog) tog.addEventListener('click', () => setAuthMode(authMode === 'signup' ? 'signin' : 'signup'));
  } else {
    if (switchLine) switchLine.hidden = true;
    if (restricted) restricted.hidden = false;
    authMode = 'signin';
  }
  document.getElementById('auth-form').addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    if (!email || !password) return;
    const submit = document.getElementById('auth-submit');
    const label = submit.textContent;
    submit.disabled = true; submit.textContent = '...'; showAuthError('');
    try {
      if (ALLOW_SIGNUP && authMode === 'signup') {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          showAuthError(tr('auth.created'));
          setAuthMode('signin');
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      showAuthError(translateAuthError(err && err.message));
    } finally {
      submit.disabled = false;
      submit.textContent = label;
    }
  });
}

// ============================================================
//  Login / logout lifecycle
// ============================================================
async function onLogin(session) {
  USER_ID = session.user.id;
  USER_EMAIL = session.user.email || '';
  try { if (sb.realtime && session.access_token) sb.realtime.setAuth(session.access_token); } catch (e) {}
  USER_ROLE = 'requester';
  try { const pr = await sb.from('profiles').select('role').eq('id', USER_ID).single(); if (!pr.error && pr.data && pr.data.role) USER_ROLE = pr.data.role; } catch (e) {}
  const _tkBtn = document.querySelector('#view-switch [data-view="tickets"]'); if (_tkBtn) _tkBtn.hidden = (USER_ROLE !== 'admin');
  hideAuthScreen();
  loadAvatar();
  refreshAccountMenu();
  // 1) instant paint from local cache
  loadFromCache();
  resetFilters(); noteSeen();
  refreshColumnSelects();
  renderBoard();
  // 2) fresh pull from the cloud
  setSyncStatus('saving');
  try {
    await pullAll();
    await seedIfEmpty();
    resetFilters(); noteSeen();
    refreshColumnSelects();
    renderBoard();
    setSyncStatus('synced');
  } catch (e) {
    console.error('[sync] initial pull failed', e);
    setSyncStatus('error');
  }
  // 3) live updates
  subscribeRealtime();
  if (USER_ROLE === 'admin') {
    try { await loadAllTickets(); } catch (e) {}
    subscribeTicketsRealtime();
    if (currentView === 'tickets') renderBoard();
  }
}
function onLogout() {
  if (rtChannel && sb) { sb.removeChannel(rtChannel); rtChannel = null; }
  cacheClearUser();
  if (ticketsRtChannel && sb) { sb.removeChannel(ticketsRtChannel); ticketsRtChannel = null; }
  USER_ID = null; USER_EMAIL = ''; USER_ROLE = 'requester'; avatarUrl = '';
  tasks = []; columns = []; groups = []; tickets = []; ticketComments = [];
  const _tkBtn2 = document.querySelector('#view-switch [data-view="tickets"]'); if (_tkBtn2) _tkBtn2.hidden = true;
  seenCols = new Set(); seenGroups = new Set();
  setAuthMode('signin');
  const em = document.getElementById('auth-email'); if (em) em.value = '';
  const pw = document.getElementById('auth-password'); if (pw) pw.value = '';
  showAuthScreen(true);
}
async function signOut() {
  try { await sb.auth.signOut(); } catch (e) {}
  // onAuthStateChange fires SIGNED_OUT -> onLogout
}

// ============================================================
//  Keyboard shortcuts
// ============================================================
function applySidebarState() { document.body.classList.toggle('sidebar-hidden', sidebarHidden); }
function openColumnsPopover() {
  const pop = document.getElementById('columns-popover');
  if (!pop) return;
  pop.innerHTML = '<h4>' + escHtml(tr('cols.title')) + '</h4>' + columns.map(c =>
    '<label class="filter-option"><input type="checkbox" data-colvis="' + escHtml(c.id) + '"' + (hiddenCols.has(c.id) ? '' : ' checked') + '><span class="col-dot" style="background:' + escHtml(c.color) + '"></span>' + escHtml(c.name) + '</label>'
  ).join('');
  pop.hidden = false;
  pop.querySelectorAll('[data-colvis]').forEach(cb => cb.addEventListener('change', () => {
    if (cb.checked) hiddenCols.delete(cb.dataset.colvis); else hiddenCols.add(cb.dataset.colvis);
    try { localStorage.setItem('tb_hidden_cols', JSON.stringify([...hiddenCols])); } catch (e) {}
    markPrefsDirty();
    renderBoard();
  }));
}
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    const root = document.getElementById('app-root');
    if (!root || root.hidden) return;
    if (document.querySelector('.modal-backdrop')) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openTaskModal(null); }
    else if (e.key === '/') { e.preventDefault(); const s = document.getElementById('search'); if (s) s.focus(); }
  });
}

// ============================================================
//  Boot
// ============================================================
let booted = false;
function setupStaticUI() {
  if (booted) return; booted = true;
  loadLang();
  loadView();
  loadGroupBy();
  loadCollapsed();
  loadTheme();
  document.querySelectorAll('#view-switch button').forEach(b => b.classList.toggle('active', b.dataset.view === currentView));
  setupSidebar();
  setupTopbar();
  attachBoardDragHandlers();
  setupImport();
  setupAccountMenu();
  setupThemeMenu();
  document.getElementById('add-group-side').addEventListener('click', () => openGroupModal(null));
  document.getElementById('groupby-btn').addEventListener('click', () => { groupBy = !groupBy; saveGroupBy(); renderBoard(); });
  setupKeyboardShortcuts();
  document.addEventListener('click', e => { const b = e.target.closest('[data-setlang]'); if (b) { e.preventDefault(); setLang(b.getAttribute('data-setlang')); } });
  applySidebarState();
  const sideToggle = document.getElementById('sidebar-toggle');
  if (sideToggle) sideToggle.addEventListener('click', () => { sidebarHidden = !sidebarHidden; try { localStorage.setItem('tb_sidebar_hidden', sidebarHidden ? '1' : '0'); } catch (e) {} markPrefsDirty(); applySidebarState(); });
  const colsBtn = document.getElementById('columns-btn');
  const colsPop = document.getElementById('columns-popover');
  if (colsBtn && colsPop) {
    colsBtn.addEventListener('click', e => { e.stopPropagation(); if (colsPop.hidden) openColumnsPopover(); else colsPop.hidden = true; });
    document.addEventListener('click', e => { if (!e.target.closest('#columns-popover') && !e.target.closest('#columns-btn')) colsPop.hidden = true; });
  }
  applyStaticI18n();
}

async function boot() {
  setupStaticUI();
  if (!initSupabase()) {
    document.getElementById('auth-loading').hidden = true;
    document.getElementById('auth-form').hidden = true;
    document.getElementById('auth-config-error').hidden = false;
    document.getElementById('auth-screen').hidden = false;
    return;
  }
  setupAuthUI();
  setAuthMode('signin');
  showAuthScreen(false);              // "loading" while we check the session
  try {
    const { data } = await sb.auth.getSession();
    if (data && data.session) await onLogin(data.session);
    else showAuthScreen(true);
  } catch (e) {
    showAuthScreen(true);
  }
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session && !USER_ID) onLogin(session);
    else if (event === 'SIGNED_OUT') onLogout();
  });
}

boot();
