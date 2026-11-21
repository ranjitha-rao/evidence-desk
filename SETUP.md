# Deploy Evidence Desk

Rovo is not on free developer sites, so develop and demo on a **Forge demo site**. It comes with enterprise editions of Jira, Confluence, JSM and Rovo, and lasts 90 days. Judges test on the same kind of site. ([docs](https://developer.atlassian.com/platform/forge/provision-a-demo-development-site/))

```sh
npm install -g @forge/cli@latest
forge site provision          # one demo site per developer; if none are available, retry later
forge deploy -e development
forge install --demo-site -e development
```

The steps below are for the free site, https://evidence-desk.atlassian.net, which has no Rovo. Run them on your machine, in order, and paste the output of any step that fails.

## 1. Use Node 24

Forge CLI supports Node 22 and 24 only. With nvm:

```sh
nvm install 24
nvm use 24
node -v        # v24.x
```

No nvm? `brew install node@24` on macOS, or the Node 24 LTS installer from nodejs.org.

## 2. Get the code

```sh
git clone https://github.com/ranjitha-rao/evidence-desk
cd evidence-desk
git checkout claude/project-thread-phjn4w
npm ci
npm test       # expect all tests to pass
```

## 3. Register the app

```sh
forge register
```

Name it `Evidence Desk`. This replaces the placeholder `app.id` in `manifest.yml`. The id is not a secret, so commit and push that one-line change, or paste the new id in the thread and I'll commit it.

## 4. Lint, deploy, install

```sh
forge lint
forge deploy -e development
forge install --site evidence-desk.atlassian.net --product jira -e development
forge install --site evidence-desk.atlassian.net --product confluence -e development
```

Accept the scopes when asked. Installing into both Jira and Confluence lets the app read Confluence pages and create the draft page.

## 5. Check Runs on Atlassian

```sh
forge eligibility -e development
```

## 6. Confirm Rovo is on

Open https://evidence-desk.atlassian.net, open Rovo chat, and look for the **Evidence Desk** agent. If Rovo is missing, turn it on in admin.atlassian.com under the AI / Rovo settings for the site.

## 7. Watch the logs while you try it

```sh
forge logs -e development --since 15m
```

In Rovo chat, ask Evidence Desk: "List your controls." That calls only `list-controls`, which needs no data. It's the first thing to prove.

## Never commit

Your API token, `.env` files, or anything under `.forge/`. The `.gitignore` already excludes these.
