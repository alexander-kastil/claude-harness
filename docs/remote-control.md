# Remote Control

Remote Control lets you continue a Claude Code session from claude.ai/code or the Claude app on your phone, while the session still runs on your PC. The **Remote** button resumes an existing session with Remote Control switched on, in a terminal.

## Where to open it

Open a session's page from the sessions list of a repo. The **Remote** button is in the **Claude** group at the right end of the page's header, next to **Continue** and **Analyze**.

## What you see

- The **Remote** button in the Claude group. Its hover says that the session resumes in a terminal with Remote Control on.
- A **Remote** tag on session rows whose transcript shows that the session ran with Remote Control. The tag's hover says the session could be continued from claude.ai/code or the Claude app.

## What the button does

It opens a terminal in the session's folder and runs Claude Code with the session's id and the Remote Control flag:

```text
claude --resume <session id> --remote-control
```

The terminal is named `Remote: <session title>`. The session is the same one, so what you say from the phone is added to this session, not to a copy.

## What is asked before it runs

A confirm card opens first, titled **Continue this session remotely**. It says:

- A terminal opens in the session's folder and resumes this very session with `--remote-control`.
- The session can then be continued from claude.ai/code and the Claude app.
- If the session is still running somewhere else, two Claudes would write to one session and mix their turns. End the other one first. Otherwise, what you say is added to this session.
- Claude reads the session again before it answers, and that counts against your plan.

Choose **Remote** on the card to open the terminal. Closing the card starts nothing.
