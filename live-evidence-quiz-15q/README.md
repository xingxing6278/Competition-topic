# Live Evidence Quiz

Mobile-first live quiz system for a 15-question competition.

## What It Does

- English-only participant, leaderboard, and admin interfaces.
- Participants enter a display name before answering.
- Participants can change answers before submitting.
- Each display name can submit once.
- The same browser device can submit again with a different display name.
- Questions are scored automatically.
- The leaderboard shows all participants and updates in real time.
- Ranking order is total score descending, then earlier submission time ascending.
- Admins can delete one submission or clear the whole leaderboard.

## Run Locally

```bash
node server.js
```

Open:

- Quiz: `http://localhost:3000`
- Leaderboard: `http://localhost:3000/leaderboard`
- Admin: `http://localhost:3000/admin`

Default admin PIN for viewing submitted answers:

```text
2468
```

To change it:

```bash
$env:ADMIN_PIN="your-pin"; node server.js
```

## Event-Day Notes

For phones to access the quiz, the server must be reachable from those phones. You can either deploy it to a public Node.js host, or run it on a laptop connected to the same Wi-Fi and share the laptop's local network URL.

Submitted answers are stored in:

```text
data/submissions.json
```

Keep that file if you want to preserve results. Delete it before a new competition if you want a clean leaderboard.
