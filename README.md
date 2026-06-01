# Task Board

Quadro de tarefas (Kanban / Tabela / Cards / Calendário) que roda 100% no navegador,
hospedado no **GitHub Pages** e com os dados guardados no seu **Supabase** (grátis).

- 🗂️ Cinco visões: **Kanban**, **Tabela**, **Cards**, **Calendário** e **Notas** (Markdown)
- 🌐 **Inglês por padrão**, com troca para **PT-BR** em um clique (login e menu de conta)
- 📝 **Notas em Markdown** com preview ao vivo e **geração de tarefas** a partir da nota
- 🔐 Login por **e-mail + senha** — os dados ficam protegidos por usuário (RLS)
- ☁️ **Sync na nuvem** com cache local (abre rápido e aguenta ficar offline por um tempo)
- ⚡ **Tempo real**: mudou num dispositivo, aparece nos outros abertos
- 🎨 Tema claro/escuro, prioridades, prazos, subtarefas, grupos, colunas personalizáveis
- ⤓ Export/Import JSON e CSV

---

## Como funciona (arquitetura)

```
GitHub Pages (HTML/CSS/JS estático, público)
        │
        │  supabase-js (anon key)  +  login do usuário
        ▼
Supabase  ──  Postgres (tabelas tasks / columns / groups)
              + Auth (e-mail/senha)
              + Row Level Security (cada usuário só vê os próprios dados)
              + Realtime (sync entre dispositivos)
```

Nenhum dado fica no código-fonte. O repositório só tem o **app**; suas tarefas
moram no **seu** banco Supabase, atrás de login.

---

## Setup — Supabase (≈ 5 min)

### 1. Crie o projeto
1. Entre em <https://supabase.com> → **New project**.
2. Dê um nome, defina uma senha de banco (guarde-a) e escolha a região mais próxima.
3. Espere o provisionamento (~1 min).

### 2. Crie as tabelas
1. No projeto, vá em **SQL Editor → New query**.
2. Cole todo o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**.
   - Cria as tabelas `columns`, `groups`, `tasks`, ativa **RLS** e o **Realtime**.
3. **Para a aba de Notas:** abra outra query, cole [`supabase/notes.sql`](supabase/notes.sql) e **Run**.
   - Cria a tabela `notes`. Sem isso, as notas funcionam **só localmente** (o app mostra um aviso).

### 3. Desligue a confirmação de e-mail (recomendado p/ uso pessoal)
Assim você cria a conta e já entra, sem precisar clicar num link de e-mail.
1. **Authentication → Sign In / Providers → Email**.
2. Desmarque **"Confirm email"** e salve.

> Se preferir manter ligado: ao criar a conta você receberá um e-mail; clique no
> link antes de entrar.

### 4. Pegue as chaves e coloque no `config.js`
1. **Project Settings → API**.
2. Copie **Project URL** e a chave **anon / public**.
3. Edite o arquivo [`config.js`](config.js):

```js
window.SUPABASE_CONFIG = {
  url:     "https://SEU-PROJETO.supabase.co",
  anonKey: "eyJhbGciOi...sua-anon-key...",
};
```

> **A anon key é pública e pode ser commitada.** Ela só permite o que as políticas
> de RLS deixam — e elas exigem um usuário logado. Veja o FAQ abaixo.

---

## Rodando localmente

Como o app usa `fetch` para o Supabase, abra via um servidor local (não pelo `file://`):

```bash
cd taskboard
python3 -m http.server 8000
# abra http://localhost:8000
```

(ou `npx serve` se preferir Node.)

No primeiro acesso, clique em **"Criar conta"**, informe e-mail + senha (mín. 6
caracteres) e pronto — o quadro abre com as 3 colunas padrão (To Do / Pending / Done).

---

## Migrando seus dados antigos

Seu arquivo antigo (`task-board_4.html`) guarda os dados no navegador. Para trazer:

1. Abra o **arquivo antigo**, clique em **Export → Export as JSON** e salve o `.json`.
2. No app novo (já logado), clique em **Export ▾ → Import JSON** e selecione o arquivo.
3. Confirme. As tarefas vão para o Supabase automaticamente.

> O arquivo exportado pode conter dados sensíveis do trabalho — **não** o commite.
> O `.gitignore` já bloqueia `my-work-data.json` e `*.local.json`.

---

## Deploy no GitHub Pages

```bash
cd taskboard
git init
git add .
git commit -m "Task board com Supabase"
git branch -M main
# crie um repositório no GitHub e troque a URL abaixo:
git remote add origin https://github.com/SEU-USUARIO/SEU-REPO.git
git push -u origin main
```

Depois, no GitHub:
1. **Settings → Pages**.
2. **Source: Deploy from a branch** → Branch **main** / **/(root)** → **Save**.
3. Em ~1 min o site fica em `https://SEU-USUARIO.github.io/SEU-REPO/`.

> Pages gratuito serve repositório **público**. Tudo bem: os dados não estão no
> código, só o app. (Quer privado? Aí precisa do GitHub Pro.)

---

## Segurança / FAQ

**É seguro deixar o repositório público com a anon key?**
Sim. A anon key foi feita para rodar no navegador. Com **RLS** ligado (o `schema.sql`
liga), sem um login válido ela não lê nem escreve nada. Cada usuário só acessa as
próprias linhas (`auth.uid() = user_id`).

**Outra pessoa pode abrir a URL do meu site?**
Pode abrir, mas só vê a tela de login. Sem a sua conta, não há dados.

**O projeto Supabase grátis "dorme"?**
Projetos grátis pausam após ~7 dias **sem nenhum uso**. Uso diário não pausa. Se
pausar, é só abrir o dashboard que ele volta.

**Esqueci a senha.**
No dashboard do Supabase: **Authentication → Users** → você pode enviar reset/recuperação.

---

## Recursos & atalhos

| Atalho | Ação                |
|--------|---------------------|
| `N`    | Nova tarefa         |
| `/`    | Focar na busca      |
| `Esc`  | Fechar modal        |

- **Calendário**: clique num dia vazio para criar uma tarefa já com aquele prazo;
  clique numa tarefa para editar. Atrasadas aparecem destacadas.
- **Sincronizar agora / Sair**: no avatar do canto superior direito.
- A bolinha ao lado do avatar mostra o status do sync (verde = ok, laranja =
  salvando, vermelho = erro).

---

## Estrutura do projeto

```
index.html          App (marcação)
styles.css          Estilos
app.js              Lógica (UI + Supabase + realtime + calendário)
config.js           SUA URL + publishable key do Supabase   ← edite aqui
config.example.js   Modelo do config.js
favicon.svg         Ícone da aba do navegador
supabase/schema.sql SQL: tabelas (columns/groups/tasks) + RLS + realtime
supabase/notes.sql  SQL: tabela de notas (rode depois do schema.sql)
```

## Idioma

O app abre em **inglês**. Para mudar para português, use o toggle **EN / PT-BR**
na tela de login ou no menu de conta (avatar → Idioma). A preferência fica salva.
