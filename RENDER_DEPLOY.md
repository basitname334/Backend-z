# Deploy AI Interviewer Backend to Render

This guide covers setting up **PostgreSQL**, the **Docker-based backend**, and running everything on [Render](https://render.com).

---

## Quick steps: database first, then deploy

Follow these in order.

### Step 1: Create the database on Render

1. Go to [Render Dashboard](https://dashboard.render.com) and sign in.
2. Click **New +** → **Postgres**.
3. Configure:
   - **Name**: `ai-interviewer-db` (or any name you like).
   - **Database**: `ai_interviewer` (or leave default).
   - **User**: leave default or set one.
   - **Region**: e.g. **Oregon** (remember it for the next step).
   - **Plan**: Free (or choose a paid plan).
4. Click **Create Database**.
5. Wait until status is **Available** (green).
6. Open the database → **Info** tab.
7. Copy the **Internal Database URL** (starts with `postgres://`).  
   Save it somewhere — you’ll paste it as `DATABASE_URL` in the next step.

### Step 2: Deploy the backend (Web Service)

1. In the Render dashboard, click **New +** → **Web Service**.
2. **Connect your repo**: connect GitHub/GitLab and select the repo that contains this backend.
3. Configure the service:
   - **Name**: `ai-interviewer-backend`
   - **Region**: **same as the database** (e.g. Oregon).
   - **Branch**: `main` (or your default branch).
   - **Root Directory**: leave blank if the repo root is this backend folder; if the backend is in a subfolder (e.g. `backend`), set **Root Directory** to `backend`.
   - **Runtime**: select **Docker**.
   - **Dockerfile Path**: `./Dockerfile` (or `./backend/Dockerfile` if Root Directory is `backend`).
4. Click **Advanced** and set **Health Check Path** to `/health` (optional).
5. Under **Environment**, click **Add Environment Variable** and add these:

   | Key | Value |
   |-----|--------|
   | `NODE_ENV` | `production` |
   | `PORT` | `4000` |
   | `DATABASE_URL` | *(paste the Internal Database URL from Step 1)* |
   | `JWT_SECRET` | *(generate one, e.g. run `openssl rand -base64 32` locally)* |
   | `REDIS_URL` | `memory` |
   | `FRONTEND_URL` | Your frontend URL, e.g. `https://your-frontend.onrender.com` |
   | `ADMIN_EMAIL` | Your admin login email |
   | `ADMIN_PASSWORD` | Your admin password |

   Optional: `OPENROUTER_API_KEY` — your [OpenRouter](https://openrouter.ai) key if you use it instead of Ollama.

6. Click **Create Web Service**.
7. Render will build the Docker image (first time can take several minutes) and then deploy. When the deploy succeeds, your API URL will be like **https://ai-interviewer-backend.onrender.com** (replace with your service name).

### Step 3: Verify

- Open `https://<your-service-name>.onrender.com/health` in a browser (replace `<your-service-name>` with your actual service name). You should see `{"status":"ok",...}`.
- In your frontend, set the API base URL and `FRONTEND_URL` env to this backend URL so CORS and links work.

---

## 1. Prerequisites

- A [Render](https://render.com) account
- This repo connected to GitHub/GitLab (for automatic deploys)
- (Optional) [OpenRouter](https://openrouter.ai) API key for AI interviews

---

## 2. Option A: One-click with Blueprint (recommended)

If your repo root **is** this backend folder (or you put `render.yaml` in the repo root):

1. Go to [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**.
2. Connect the repository that contains this backend and select it.
3. Render will read `render.yaml` and create:
   - **PostgreSQL** database: `ai-interviewer-db`
   - **Web Service** (Docker): builds from `Dockerfile`, runs the Node app
4. For keys marked `sync: false`, Render will prompt you to set:
   - **FRONTEND_URL** – e.g. `https://your-frontend.onrender.com`
   - **OPENROUTER_API_KEY** – from [OpenRouter](https://openrouter.ai) (optional)
   - **ADMIN_EMAIL** / **ADMIN_PASSWORD** – admin login for the app
5. Click **Apply** and wait for the first deploy.

If your **repo root is the parent** of this backend (e.g. monorepo), set the service **Root Directory** to the folder that contains `Dockerfile` and `render.yaml` (e.g. `backend`).

---

## 3. Option B: Manual setup (database first, then Docker service)

### Step 1: Create PostgreSQL database

1. **New** → **Postgres**.
2. Choose **region** (e.g. Oregon); use the same region for the web service later.
3. Set **Name** (e.g. `ai-interviewer-db`), **Database**, **User** if you want, and **Plan** (Free tier is fine to start).
4. Click **Create Database**.
5. Wait until it’s **Available**, then open the **Info** tab and copy:
   - **Internal Database URL** (preferred for a service on Render)
   - Or **External Database URL** if the app runs elsewhere

Save this as `DATABASE_URL` for the next step.

### Step 2: Create Web Service (Docker)

1. **New** → **Web Service**.
2. Connect the repo that contains this backend and select it.
3. Configure:
   - **Name**: e.g. `ai-interviewer-backend`
   - **Region**: same as the database
   - **Branch**: e.g. `main`
   - **Root Directory**: if the backend is in a subfolder (e.g. `backend`), set it here
   - **Runtime**: **Docker**
   - **Dockerfile Path**: `./Dockerfile` (or `./backend/Dockerfile` if root is parent)
4. **Environment variables** (Add in Dashboard):

   | Key             | Value / source |
   |-----------------|-----------------|
   | `NODE_ENV`      | `production`    |
   | `PORT`          | `4000` (Render can override; app uses `process.env.PORT`) |
   | `DATABASE_URL`  | Paste the **Internal Database URL** from Step 1 |
   | `JWT_SECRET`    | Long random string (e.g. generate with `openssl rand -base64 32`) |
   | `REDIS_URL`     | `memory` (no Redis on Render; in-memory store is used) |
   | `FRONTEND_URL`  | Your frontend URL, e.g. `https://your-app.onrender.com` |
   | `OPENROUTER_API_KEY` | Your OpenRouter key (optional) |
   | `ADMIN_EMAIL`   | Admin login email |
   | `ADMIN_PASSWORD`| Admin login password |

5. **Advanced** (optional):
   - **Health Check Path**: `/health`
6. Click **Create Web Service**.

Render will build the image from the Dockerfile and deploy. On each deploy, the container runs `prisma db push` then `node dist/index.js`, so the DB schema stays in sync and the app runs continuously.

---

## 4. What the Dockerfile does

- **Whisper stage**: Builds **whisper.cpp** (CLI for speech-to-text) and downloads the `base.en` model. The binary and model are copied into the final image so `/api/v1/transcribe` and voice features work without extra setup.
- **Node build stage**: `npm ci` → `prisma generate` → `npm run build` (TypeScript → `dist/`).
- **Run stage**: Installs **Ollama** (for local LLM). At **startup**:
  1. `ollama serve` – starts the LLM server in the background.
  2. `ollama pull llama3` – runs in the background on first boot (optional; you can use `OPENROUTER_API_KEY` instead and skip Ollama).
  3. `prisma db push` – applies your Prisma schema to the Render Postgres DB.
  4. `node dist/index.js` – starts the API and Socket.io server.

So you get:
- **Whisper** for transcription (whisper.cpp + `base.en` model).
- **Ollama** for local LLM (or use OpenRouter via `OPENROUTER_API_KEY`).
- Database and schema applied on each deploy.
- App running 24/7 (or according to your Render plan).

**Note:** Ollama and the `llama3` model use significant RAM. On Render’s free tier you may need to use **OPENROUTER_API_KEY** instead and leave Ollama unused, or upgrade to a plan with more memory.

---

## 5. Running “everything frequently”

- **Backend**: As a **Web Service** it runs all the time (or scales with your plan). No extra cron is needed for “running the server.”
- **Database**: Render keeps Postgres running and backs it up per plan.
- **Migrations**: Every deploy runs `prisma db push`, so schema changes go out with each deploy.

If you need **scheduled jobs** (e.g. cleanup, reports), you can add a **Cron Job** service in Render and point it at an HTTP endpoint or a separate worker; that’s separate from this Docker backend.

---

## 6. Optional: Redis on Render

The app works with `REDIS_URL=memory` (in-process store). For multiple instances or production Redis:

1. Create a **Redis** instance on Render (or use an add-on).
2. Set **REDIS_URL** to that instance’s URL in the Web Service env vars.

---

## 7. Useful links

- [Render PostgreSQL](https://render.com/docs/databases)
- [Render Docker](https://render.com/docs/docker)
- [Render Blueprint (render.yaml)](https://render.com/docs/blueprint-spec)

After the first successful deploy, your API will be at `https://<your-service-name>.onrender.com` (e.g. `https://ai-interviewer-backend.onrender.com`). Use **FRONTEND_URL** in env so the backend allows that origin for CORS and any join links.
