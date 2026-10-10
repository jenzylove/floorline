# Run the hedge bot on Windows

Perpl blocks its trading API from cloud IPs (HTTP 451), so the bot runs on a normal PC.
PowerShell, copy and paste in order.

```powershell
# 1. Tools (close and reopen PowerShell afterwards)
winget install OpenJS.NodeJS.LTS
winget install Git.Git

# 2. Code (a browser window asks you to sign in to GitHub: the repo is private)
git clone https://github.com/jenzylove/floorline.git
cd floorline\keeper
npm ci

# 3. Settings
Copy-Item .env.example .env
notepad .env
```

In `.env`, fill in these lines and save (the vault address is already there):

```
PERPL_API_KEY=<your key>
PERPL_API_KEY_SECRET=<your key secret>
TRADING_ENABLED=1
```

```powershell
# 4. Run
npm start
```

Check the first lines of output:
- `"event":"mode","trading":true` means the key is loaded.
- `"event":"tr.wallet","account":<number>` is your Perpl account id. Send that number back.
- `"event":"decision"` with `"kind":"hold"` is normal until a series is open.

Stop with Ctrl+C. Leave it running through the cycle, until the short is closed after settlement.
Logs are in `keeper\logs\`.
