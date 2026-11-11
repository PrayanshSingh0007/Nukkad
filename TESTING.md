# Nukkad — TESTING checklist

Run on each device: **low-end Android · mid-range Android (the target) · iPhone (best effort) · laptop**.
Write results and the overlay's **Copy report** (5 taps on the logo) into BUGS.md.

## Automated (every phase)
- [ ] `npm test` is green
- [ ] `npm run stress` prints PASS (8 bots, lag 50–400 ms, loss 0–10 %, 9th turned away)
- [ ] `npm run typecheck` and `npm run build` succeed

## Join / leave
- [ ] Home → type a name → Start a Nukkad → you appear at a street corner
- [ ] Invite friends → share sheet (phone) or "Link copied!" (laptop)
- [ ] Second device opens the link → "You're invited!" → Join → both see each other move smoothly with name tags
- [ ] 8 devices/tabs in one room; a 9th sees "This Nukkad is full"
- [ ] Close a tab → the others see that player vanish at once
- [ ] A wrong or expired link shows a friendly message and "Start your own Nukkad"

## Bad network
- [ ] Turn Wi-Fi off for 5 s → you keep walking; others see you faded "reconnecting…"; back online → you reconnect by yourself into the same slot
- [ ] Wi-Fi off for 70 s → your slot is freed; on return you rejoin as a new slot
- [ ] Phone on mobile data with weak signal → others still move smoothly (maybe a little later)

## Phone life
- [ ] Put the tab in the background for 1 minute, come back → the game continues
- [ ] Rotate the phone → the picture fills the screen, controls still work
- [ ] Lock and unlock the phone

## Performance
- [ ] Walk for 2 minutes → note fps, draw calls, quality (overlay)
- [ ] 30-minute session → JS memory in the overlay does not keep climbing
- [ ] Switch places (change ?lat=&lng=, start a new room) → the new place loads

## Later phases
- [ ] Mic denied → friendly message, listening still works (Phase 6)
- [ ] Photo saved with "Nukkad" + "© OpenStreetMap contributors" (Phase 6)
