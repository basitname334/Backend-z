# Mail integration – what you need and why the wrong sender appears

## What you have to integrate (backend)

Mail is controlled **only** by your backend `.env`. No other config file overrides it.

| Env variable   | Your value                     | Purpose |
|----------------|--------------------------------|--------|
| `MAIL_SERVICE` | `gmail`                        | Use Gmail SMTP |
| `MAIL_USER`    | `mabdulbasitdogar@gmail.com`   | Gmail account that sends |
| `MAIL_PASS`    | (app password)                 | Gmail app password for that account |
| `MAIL_FROM`    | `mabdulbasitdogar@gmail.com`   | **Sender address** shown to the recipient |
| `MAIL_REPLY_TO`| `mabdulbasitdogar@gmail.com`   | Where “Reply” goes |

Used when the app sends:

- Candidate password reset (forgot password)
- Recruiter password reset (forgot password)
- Interview schedule emails (join link to candidate)

Config is read from `backend/src/config/index.ts` (which reads `process.env`). The app does **not** use any other env file unless you load it yourself.

---

## Where the mail is received

- **Recipient:** The user who requested the reset (the email they typed on “Forgot password?”) or the candidate you’re scheduling.
- **Inbox:** That recipient’s inbox (e.g. their Gmail). You received the reset email in your own Gmail because you triggered “Forgot password?” with your address.

---

## Why the email still shows the old sender (`zainkhalid0347@gmail.com`)

Your `.env` is correct and uses **mabdulbasitdogar@gmail.com**, but the reset you received was **from zainkhalid0347@gmail.com**. That means the **running backend** is still using the **old** mail config.

- Config (including `MAIL_FROM`) is read **once when the backend starts**.
- If you changed `.env` from `zainkhalid0347@gmail.com` to `mabdulbasitdogar@gmail.com` **without restarting** the backend, the process still has the old values in memory.
- So the app keeps sending with the old sender until you restart.

**Fix:**

1. Stop the backend (Ctrl+C in the terminal where it runs).
2. Start it again from the `backend` folder, e.g. `npm run dev` or `npm start`.

After restart, all new emails (password reset, interview schedule) will use **MAIL_FROM** = `mabdulbasitdogar@gmail.com` and recipients will see that address as the sender.

---

## If you run the backend in more than one place

- Each process has its **own** `.env` (the one in that folder when it starts).
- If one server still has `MAIL_USER`/`MAIL_FROM` = `zainkhalid0347@gmail.com` in its `.env`, that server will keep sending from that address until you update **that** `.env` and restart **that** process.

So: update `.env` on the machine that actually sends the email, then restart that backend.

---

## Force use only mabdulbasitdogar@gmail.com (no zainkhalid0347)

1. **Single `.env`**  
   In `backend/.env` set and save:
   - `MAIL_USER=mabdulbasitdogar@gmail.com`
   - `MAIL_FROM=mabdulbasitdogar@gmail.com`
   - `MAIL_REPLY_TO=mabdulbasitdogar@gmail.com`
   - `MAIL_PASS=` your Gmail app password for mabdulbasitdogar

2. **Stop every backend**  
   Close all terminals where the backend is running (Ctrl+C). If unsure, kill all Node processes:
   - Windows: `taskkill /F /IM node.exe`
   - Mac/Linux: `pkill -f node`  
   So no old process with zainkhalid0347 is still running.

3. **Start once from backend**  
   Open one terminal, go to the backend folder, start the server:
   ```bash
   cd "D:\New folder\backend"
   npm run dev
   ```
   or `npm start` after `npm run build`.

4. **Check the startup log**  
   You should see:
   ```text
   [Mail] Sender configured: mabdulbasitdogar@gmail.com (restart backend after changing .env)
   ```
   If you see `zainkhalid0347@gmail.com` here, the process still has the old env; repeat step 2 and 3.

5. **When a reset email is sent** the log will show:
   ```text
   [Mail] Password reset email sent to xxx from mabdulbasitdogar@gmail.com
   ```
   If it says `from zainkhalid0347@gmail.com`, the wrong process is handling the request; make sure only one backend is running and it was started after updating `.env`.
