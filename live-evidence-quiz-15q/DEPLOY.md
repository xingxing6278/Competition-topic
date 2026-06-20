# Cloud Deployment

This app is a Node.js web service. It can run on any cloud platform that supports Node.js or Docker.

## Fast Temporary Public URL

A temporary public tunnel is currently running from this computer:

```text
https://floppy-icons-joke.loca.lt
```

Keep this computer awake and keep the local quiz server running. If the computer sleeps or the tunnel process stops, the link will stop working.

## Permanent Cloud Deployment

Use a Node/Docker host such as Render, Railway, Fly.io, or a VPS.

Recommended settings:

- Start command: `node server.js`
- Port: use the platform-provided `PORT` environment variable
- Admin PIN environment variable: `ADMIN_PIN`
- Persistent storage: mount the app's `data/` folder if you need results to survive restarts

## Important Data Note

Submissions are stored in:

```text
data/submissions.json
```

If your cloud platform restarts the app without persistent storage, results may reset. For a one-day activity this may be acceptable, but for a formal event use a persistent disk or keep a local export of the results.
