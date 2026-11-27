# कार्यसेतु (KaryaSetu) — Demo guide: one job, from request to bill

This is a click-by-click script for showing the whole life of a job to a client. It uses a **demo kit** (a demo branch, client, machine, hub and engineer) so no real customer data is touched, and it can be removed in one command afterwards.

Time needed: about 15 minutes. You need: a laptop (web), the engineer's phone (app), and the machine QR page open on the laptop screen.

## 0. Set up (once, 5 minutes before)

1. Start the system (API, web, database) — on the server, or locally with the usual three terminals.
2. Create the demo kit:
   ```powershell
   cd backend
   node scripts/demo-kit.mjs
   ```
   It prints the **engineer login (DEMOENG + a password)**. The same is saved in `backend/demo-kit-credentials.csv` (never committed).
3. It also switches **Demo mode ON** (web → *Price List & Travel Rules*). In demo mode the engineer still has to scan the *right machine's* QR, but "being at the site" and the extra-kilometre check are skipped, so the demo works from a meeting room. **Switch it off for real work** — `node scripts/demo-kit.mjs --remove` does that for you.
4. Web → *Clients & Sites* → **Demo Textiles Pvt Ltd** → machine **DEMO-SN-0001** → *QR* page. Keep this page open on the laptop: the engineer will scan it with the phone.
5. Phone: open the app, sign in as **DEMOENG**, pick the language (English / हिन्दी / ગુજરાતી / मराठी — everything switches).
6. Web: sign in as Admin. Open *Dashboard*, so the audience sees the starting numbers.

## 1. The story

"Demo Textiles' compressor has tripped. Their plant manager phones the office."

| # | Who | Where | What to do | What to point out |
|---|-----|-------|-----------|-------------------|
| 1 | Office | *Service Requests* → **New request** | Client *Demo Textiles*, machine *DEMO-SN-0001*, issue "Compressor tripping on high temperature", priority *High*, channel *Phone* | The request gets a ticket number. The same request can also come from the machine's QR sticker or the public request page — show `/request` on the phone. |
| 2 | Office | request → **Create job** | Job type *Breakdown repair*. In **Assign engineer**, the first names are the engineers **of the same branch (zone)**, marked as such. Pick *Demo Engineer*. **Choose the visit date** (today or later — past dates are refused). | Zone-first list; engineer who is checked in / free that day is shown; date is fixed at assignment. |
| 3 | Engineer | App → **Home** | **Check in** (location sharing starts). Show "Check in again" after a check-out: the day can be started any number of times; worked time adds up. | Nothing can be accepted or started without checking in. |
| 4 | Engineer | App → **Jobs** | The new job appears with *Action needed*. Open it → **Accept**. | Office sees "accepted" on the job at once. |
| 5 | Engineer | Job → **Start travelling** | The app records the route (GPS) and the expected kilometres. | Web → *Live Map* shows the engineer moving; *Zone Map* shows the site and the request. |
| 6 | Engineer | Job → **Scan machine QR** | First try scanning nothing / a wrong QR → refused ("This QR belongs to a different machine"). Then scan the QR on the laptop screen → accepted. | Right machine proven. Travel km are worked out; the work clock starts. |
| 7 | Engineer | Job → **Request spare part** | Ask for *Air filter (demo)* × 2, note "filter choked". Work is put **on hold**, the work clock stops. | Office gets the request. |
| 8 | Office | *Spare Requests* | Open the request → see which hub has stock → **Allocate** from *Demo Hub* with a note "Collect from the demo hub counter". | The engineer's phone shows "Spares ready — collect at Demo Hub". The stock level drops. |
| 9 | Engineer | App | Collect the spare, **Start** again (travel to site), scan the QR again. | Work resumes; hold time is not counted as work. |
| 10 | Engineer | Job → **Complete** | "Spare parts given to you": say **all used**, or show *some are left* — then enter how many were used; the leftover must be returned to the hub. Add notes, take a photo, take the **customer's signature**, **Complete**. | Leftover spares create a "return to hub" task for the office. |
| 11 | Office | *Inventory & Warehouses* → **Returns** | If you left spares unused: **Receive** them back at the hub. | Stock goes back up. |
| 12 | Office | *Invoices* | An **automatic draft bill** exists for the job: visit charge from the price list (+ spare parts used). Open → check lines → **Issue**. Show the PDF / print and the *Receivables* page. | Billing follows the price list; AMC/CMC visits with a fixed cost bill automatically. |
| 13 | Office | *Jobs* → the job | Show the timeline: assigned, accepted, travelled km, work time, spare hold, completed, signature, photos. | One page tells the whole story. |
| 14 | Office | *Dashboard*, *Reports*, *Attendance*, *Travel Claims* | Show the numbers have moved; attendance shows each check-in stretch and the worked time. | |

### Optional extras (2 minutes each)
- **AMC / CMC Schedule**: shows the visits due this month and the next; assign an engineer + date to many at once.
- **Spare reasons / travel claims**: with Demo mode off, scan from far away → refused; travel more than allowed → the engineer must give a reason (typed or spoken, in their language) and a senior approves it in *Travel Claims*.
- **Access Control**: show how each branch's people see only their branch.
- **Offline**: switch the phone to aeroplane mode, Accept / Complete a job — it waits on the phone and syncs when the network is back.

## 2. After the demo

```powershell
cd backend
node scripts/demo-kit.mjs --remove
```
This deletes the demo client, machine, jobs, bills, hub, engineer and **switches Demo mode off**.

If the demo is run on the live server, run the same commands inside the backend container:
```bash
docker compose exec backend node scripts/demo-kit.mjs          # create (prints the engineer password)
docker compose exec backend node scripts/demo-kit.mjs --remove # remove
```

## 3. If something does not work
- *Engineer cannot accept/start*: he has not **checked in** on the Home tab.
- *"This QR belongs to a different machine"*: scan the QR of **DEMO-SN-0001**, not another machine.
- *"You are about X km from the service station"*: Demo mode is off — switch it on (*Price List & Travel Rules*).
- *The job is not in the engineer's list*: the engineer must be in the job's branch; the demo engineer is in "Demo Branch".
- *Login says "Too many wrong passwords"*: wait 15 minutes, or an admin resets the password in *Users*.
