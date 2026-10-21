#!/usr/bin/env python3
"""Runs a command in a terminal of its own and answers its questions.

The first time EAS builds the iPhone app it asks whether to create the app's
Apple certificate and profile (and its project on expo.dev). There is nobody
to answer on GitHub's machine, so this says "yes" to those (and "no" to push
notifications, which the app doesn't use) and takes the first choice of a list.
"""
import os
import pty
import re
import select
import sys
import time

ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][A-Z0-9]")
# A question of the `prompts` library: "? Generate a new Apple Distribution Certificate? › (Y/n)".
QUESTION = re.compile(r"\? (?P<q>[^\r\n›]{2,300}?) › (?P<rest>[^\r\n]*)")
SAY_NO = re.compile(r"push notification", re.I)


def answer_for(question: str, rest: str) -> str:
    if "(Y/n)" in rest or "(y/N)" in rest:
        return "n\r" if SAY_NO.search(question) else "y\r"
    # A list, or a value with a default: the first choice / the default.
    return "\r"


def main() -> int:
    cmd = sys.argv[1:]
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp(cmd[0], cmd)
    seen = ""
    last_output = time.time()
    waiting_for_output = False
    asked: dict[str, int] = {}
    while True:
        ready, _, _ = select.select([fd], [], [], 0.5)
        if ready:
            try:
                data = os.read(fd, 65536)
            except OSError:
                break
            if not data:
                break
            sys.stdout.buffer.write(data)
            sys.stdout.flush()
            seen = (seen + ANSI.sub("", data.decode("utf-8", "replace")))[-4000:]
            last_output = time.time()
            waiting_for_output = False
            continue
        # Quiet for a moment, and the last thing printed is a question: answer it.
        if waiting_for_output or time.time() - last_output < 1.5:
            continue
        found = None
        for found in QUESTION.finditer(seen[-1500:]):
            pass
        if not found:
            continue
        question, rest = found.group("q").strip(), found.group("rest")
        asked[question] = asked.get(question, 0) + 1
        if asked[question] > 3:
            print(f"\n[answer-prompts] «{question}» keeps being asked — stopping.", flush=True)
            os.kill(pid, 15)
            break
        reply = answer_for(question, rest)
        print(f"\n[answer-prompts] {question} → {reply.strip() or 'Enter'}", flush=True)
        os.write(fd, reply.encode())
        waiting_for_output = True
    _, status = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(status)


if __name__ == "__main__":
    sys.exit(main())
