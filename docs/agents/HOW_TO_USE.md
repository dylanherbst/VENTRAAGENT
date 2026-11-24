# How to use my AI team

You talk to one assistant, the Chief of Staff. It picks the right specialist for you. You never need to name agents.

## Start it

In Terminal:

```bash
ventra-claude
```

Leave that window open. Claude works there, and the same session answers your Telegram messages while your Mac is awake and that window is open. To use only Claude Desktop, just open the VENTRA-FEATURES project.

## What you can say (Claude Desktop or Telegram)

| You want | Say something like |
| --- | --- |
| A progress report | "Give me the daily overview" or "status" |
| A new feature | "I want customers to import contacts from a spreadsheet" |
| A UI change | "Make the Home page match this reference" (attach the image) |
| A fix | "The Create page crashes when I press Save" |
| An integration | "What do I need to connect Supabase?" |
| Research only | "Research how other tools do course quizzes, give me a short spec" |
| An independent check | "Have QA check what you just built" |
| Switch to Codex | "Prepare a handoff to Codex" |
| Stop | "Stop and save where you are" |

## What happens

1. It reports back what it understood in plain English.
2. For new features it writes a short spec with acceptance criteria first.
3. One specialist edits at a time. QA checks the work independently.
4. It stops and sends: **FEATURE READY FOR TESTING**, with a test page link and how to try it.
5. Nothing is released, pushed, deployed or bought without your yes.

## What needs your approval

Merging to `main`, production deploys and migrations, changes to live customer data, payments or passwords, publishing or customer messages, spending money, and deleting projects. Agents prepare a release review and wait. You approve **only in the Agent Dashboard app** (macOS asks for Touch ID or your password); a Telegram message can notify you but can never approve.

## Approvals (production releases)

Open **Approvals** in the Agent Dashboard app. A request shows the exact command, the branch and commit it is bound to, tests, risks, rollback and cost. Choose **Approve** (macOS asks for Touch ID or your password), **Request changes**, or **Reject**. You are only ever asked about production, money, credentials, customer-facing actions and destructive changes. Everything else the agents just do.

## Switching to Codex (when Claude hits its limit)

1. Tell Claude: "Prepare a handoff to Codex." It saves the task and Git state.
2. Close the Claude window (type `/exit`).
3. In Terminal run:

```bash
ventra-codex
```

4. When Codex finishes, run `ventra-claude` again. Check who is working any time with:

```bash
ventra-handoff status
```

If it says a lock is stuck, run `ventra-handoff recover`.

## If Telegram stops answering

1. Is the `ventra-claude` window still open and your Mac awake? If not, restart it.
2. Make sure only ONE `ventra-claude` window is open.
3. Ask me to "check Telegram".

## Where things are

`docs/agents/STATUS.md` (what works), `TASKS.md` (task list), `WORKFLOWS.md` (how work flows), `HANDOFF.md` (current task for Codex).
