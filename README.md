# Daily Checklist

A diary and checklist app for two people. Each person sets a fixed checklist with "do" and "avoid" items. It appears on every day of a calendar, where they tick items off and write a short note. Each person can view the other's days but not edit them.

## Run
    node server.js        # → http://localhost:3000

No `npm install` needed (no dependencies, Node 18+).

## Logins
Defined in the `USERS` block at the top of `server.js`:
- `sample1` / `sample1`
- `sample2` / `sample2`

Change the usernames and display names there. Override the passwords with the `USER1_PASSWORD` / `USER2_PASSWORD` environment variables, so real passwords never go into the repo.

## Data
Everything is saved to `data.json` next to `server.js` (or in `DATA_DIR`). It's gitignored, so back it up yourself.
