# Daily Checklist

A diary and checklist app for two people. Each person sets a fixed checklist with "do" and "avoid" items. It appears on every day of a calendar, where they tick items off and write a short note. Each person can view the other's days but not edit them.

Runs on Cloudflare Workers (free plan), with a D1 database for storage.

## Local development
    npm install
    npm run db:init:local     # create tables in the local D1 database
    npm run dev               # → http://localhost:8787

Local logins come from `.dev.vars` (gitignored):

    USER1_PASSWORD=sample1
    USER2_PASSWORD=sample2

## Deploy
    npx wrangler login
    npx wrangler d1 create checklistdiary      # paste the database_id into wrangler.jsonc
    npm run db:init:remote
    npx wrangler secret put USER1_PASSWORD
    npx wrangler secret put USER2_PASSWORD
    npm run deploy

## Configuration
| Variable | Default | |
|---|---|---|
| `USER1_ID` / `USER2_ID` | `sample1` / `sample2` | login usernames |
| `USER1_NAME` / `USER2_NAME` | `Sample 1` / `Sample 2` | display names |
| `USER1_PASSWORD` / `USER2_PASSWORD` | none | **required**: a user with no password can't log in |
| `SESSION_SECRET` | none | optional extra secret for login cookies |

Set them with `npx wrangler secret put NAME`. Changing a password logs everyone out.
