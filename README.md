# IVR Caller Frequency Service

This service checks how many times the same phone number calls during the daily
business window. It uses only the `caller_frequency_tracking` MySQL table.

## Pivot API URL

Configure the PBX/Kazoo Pivot to call this URL:

```text
https://spc.reports.voicemeetme.net:9569/check_frequency
```

The Pivot must send the caller number using either `phone_number` or `From`.
Both query-string and form/JSON body parameters are accepted.

Recommended query-string format:

```text
https://spc.reports.voicemeetme.net:9569/check_frequency?phone_number={{CALLER_NUMBER}}
```

Replace `{{CALLER_NUMBER}}` with the caller-number variable provided by the PBX.
If Kazoo automatically sends `From`, configure only the base endpoint:

```text
https://spc.reports.voicemeetme.net:9569/check_frequency
```

The old endpoint below remains available as a compatibility alias, but new
Pivot configurations should use `/check_frequency`:

```text
https://spc.reports.voicemeetme.net:9569/check_language
```

## Call behavior

Every call from the same number counts toward that day's attempt total,
regardless of what time it comes in. Time-of-day routing (business hours vs.
after hours) is handled inside the `IVR_ROUTING` callflow (extension `4025`)
itself, not by this service — this service only decides whether to let the
call reach that callflow at all.

| Attempt for the same number and date | Result |
| --- | --- |
| 1 | Send the call to `ALLOWED_CALLFLOW_ID` |
| 2 | Send the call to `ALLOWED_CALLFLOW_ID` |
| 3 | Send the call to `ALLOWED_CALLFLOW_ID` |
| 4 | Add the number to the rejected-call campaign, then hang up |
| 5 and later | Hang up without adding another campaign lead |

Example, all times `Asia/Kolkata` on 2026-09-15:

- 10:00 — attempt 1 — routed normally.
- 17:00 — attempt 2 — routed normally.
- 19:00 — attempt 3 — still routed to `ALLOWED_CALLFLOW_ID`, which internally
  sends it down its after-hours path.
- 21:00 — attempt 4 — added to the campaign, then hung up.

Counts reset automatically because each phone number has a separate record for
each `call_date`. In addition, every row for a given `call_date` is deleted
from `caller_frequency_tracking` at `CLEANUP_TIME` (default `23:59`,
`Asia/Kolkata`), so nothing lingers in the table past the day it was created.
When the same number calls again the next day (e.g. 2026-09-16 00:00
onward), it is attempt 1 again and goes through the normal IVR instead of
being disconnected.

For an allowed call, the Pivot receives:

```json
{
  "module": "callflow",
  "data": {
    "id": "ca353d42f00b71a640ed052dc5a28c47"
  }
}
```

For a rejected call, the Pivot receives:

```json
{
  "module": "hangup"
}
```

## Optional lead fields

The Pivot may also send these fields:

```text
first_name
last_name
priority
prospect_id
```

Example:

```text
https://spc.reports.voicemeetme.net:9569/check_frequency?phone_number=971500000001&first_name=John&last_name=Doe&priority=1&prospect_id=ABC123
```

On attempt 4, the service sends this request to the campaign API:

```http
POST https://ucpin.voicemeetme.com:9443/api/v2/config/campaigns/525c2eb5fd77ff20f3ffa7115d5f3bac/lead
X-API-Key: configured in .env
X-Account-ID: configured in .env
Content-Type: application/json
```

```json
{
  "number": "971500000001",
  "first_name": "John",
  "last_name": "Doe",
  "priority": 1,
  "ticket_id": "ABC123"
}
```

## Environment configuration

Create or update `.env`:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=YOUR_MYSQL_PASSWORD
DB_NAME=ivr_pivot_myflot

PORT=9569
HOST=0.0.0.0
NODE_ENV=production
production_url=https://spc.reports.voicemeetme.net:9569

CAMPAIGN_MAX_ATTEMPTS=3
CAMPAIGN_DIVERSION_TZ=Asia/Kolkata
CLEANUP_TIME=23:59
CAMPAIGN_ID=525c2eb5fd77ff20f3ffa7115d5f3bac
CAMPAIGN_API_URL=https://ucpin.voicemeetme.com:9443/api/v2/config/campaigns/525c2eb5fd77ff20f3ffa7115d5f3bac/lead
CAMPAIGN_API_KEY=YOUR_CAMPAIGN_API_KEY
CAMPAIGN_ACCOUNT_ID=YOUR_CAMPAIGN_ACCOUNT_ID
CAMPAIGN_LEAD_PRIORITY=1
ALLOWED_CALLFLOW_ID=ca353d42f00b71a640ed052dc5a28c47
```

`ALLOWED_CALLFLOW_ID` contains the UUID of `IVR_ROUTING` (extension `4025`).
That callflow performs the Time of Day routing to `office9630` or `afterhours`
internally, so this service always points attempts 1–3 at the same callflow
ID no matter what time the call comes in — the callflow itself picks the
business-hours or after-hours destination. `CLEANUP_TIME` controls when each
day's rows are purged from `caller_frequency_tracking` (see Call behavior
above).

## Database setup

Start MySQL and apply the schema:

```bash
brew services start mysql
mysql -u root -p < database/schema.sql
```

Verify the table:

```bash
mysql -u root -p -e "USE ivr_pivot_myflot; SHOW TABLES;"
```

Expected application table:

```text
caller_frequency_tracking
```

## Install and run

```bash
npm install
npm start
```

The server listens on port `9569`. When the SSL files in `ssl/` are available,
it starts with HTTPS; otherwise it falls back to HTTP.

## Tests

Run the safe automated tests:

```bash
npm test
```

The tests mock the external campaign request. They do not add a real lead and
do not change the MySQL database.

## Production checklist

1. Confirm DNS for `spc.reports.voicemeetme.net` points to this server.
2. Allow inbound TCP port `9569` in the firewall/security group.
3. Confirm the SSL certificate matches `spc.reports.voicemeetme.net`.
4. Confirm MySQL is running and `.env` contains valid database credentials.
5. Set the PBX Pivot URL to `https://spc.reports.voicemeetme.net:9569/check_frequency`.
6. Confirm `ALLOWED_CALLFLOW_ID` is the correct normal callflow UUID.
7. Run `npm test` before starting the production process.

Do not commit `.env` or expose the campaign API key in source control.
# ivr_myflot
