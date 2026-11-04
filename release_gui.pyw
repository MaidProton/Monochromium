from __future__ import annotations

import json
import os
import queue
import re
import shutil
import subprocess
import threading
import webbrowser
from pathlib import Path
from tkinter import END, DISABLED, NORMAL, BooleanVar, StringVar, Tk, messagebox
from tkinter import ttk
from tkinter.scrolledtext import ScrolledText


ROOT = Path(__file__).resolve().parent
RELEASE_SCRIPT = ROOT / "release-update.ps1"
OUTPUT_DIR = ROOT / "out" / "make" / "squirrel.windows" / "x64"
VERSION_PATTERN = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
PROGRESS_PATTERN = re.compile(r"^RELEASE_PROGRESS\|(\d+)\|([^|]+)\|(.*)$")
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def run_quiet(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=NO_WINDOW,
    )


def project_version() -> str:
    try:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        return str(package.get("version", "unknown"))
    except (OSError, ValueError):
        return "unknown"


def next_patch(version: str) -> str:
    match = VERSION_PATTERN.fullmatch(version)
    if not match:
        return "unknown"
    major, minor, patch = (int(value) for value in match.groups())
    return f"{major}.{minor}.{patch + 1}"


def working_tree_changes() -> list[str]:
    git = shutil.which("git.exe") or shutil.which("git")
    if not git:
        return ["Git was not found on PATH"]
    result = run_quiet([git, "status", "--porcelain", "--untracked-files=all"])
    if result.returncode != 0:
        return ["Could not inspect the Git working tree"]
    return [line for line in result.stdout.splitlines() if line.strip()]


class ReleaseApp:
    def __init__(self, root: Tk) -> None:
        self.root = root
        self.root.title("Monochromium Release Tool")
        self.root.geometry("820x680")
        self.root.minsize(740, 560)

        self.events: queue.Queue[tuple[str, object]] = queue.Queue()
        self.running = False
        self.last_release_url = ""
        self.current_version = project_version()
        self.next_version = next_patch(self.current_version)

        self.current_version_var = StringVar()
        self.next_version_var = StringVar()
        self.tree_var = StringVar()
        self.status_var = StringVar(value="Ready when you are")
        self.tests_var = BooleanVar(value=True)
        self.allow_dirty_var = BooleanVar(value=False)

        self.build_button: ttk.Button
        self.release_button: ttk.Button
        self.open_output_button: ttk.Button
        self.open_release_button: ttk.Button
        self.checks_checkbutton: ttk.Checkbutton
        self.allow_dirty_checkbutton: ttk.Checkbutton
        self.tree_label: ttk.Label
        self.status_label: ttk.Label
        self.progress: ttk.Progressbar
        self.log: ScrolledText

        self.build_ui()
        self.refresh_state()
        self.root.after(100, self.process_events)

    def build_ui(self) -> None:
        style = ttk.Style(self.root)
        style.configure("Title.TLabel", font=("Segoe UI", 18, "bold"))
        style.configure("Section.TLabel", font=("Segoe UI", 9, "bold"))
        style.configure("Value.TLabel", font=("Segoe UI", 11, "bold"))
        style.configure("Muted.TLabel", foreground="#666666")
        style.configure("Status.TLabel", font=("Segoe UI", 9, "bold"))
        style.configure("Success.TLabel", foreground="#237a3b", font=("Segoe UI", 9, "bold"))
        style.configure("Warning.TLabel", foreground="#9a6700", font=("Segoe UI", 9, "bold"))
        style.configure("Error.TLabel", foreground="#b3261e", font=("Segoe UI", 9, "bold"))
        style.configure("Primary.TButton", font=("Segoe UI", 10, "bold"), padding=(16, 9))
        style.configure("Secondary.TButton", font=("Segoe UI", 10), padding=(16, 9))

        outer = ttk.Frame(self.root, padding=18)
        outer.pack(fill="both", expand=True)

        ttk.Label(outer, text="Monochromium release tool", style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            outer,
            text="Build an installer or publish the next patch update. This tool only handles release artifacts; it never commits or pushes source files.",
            style="Muted.TLabel",
            wraplength=760,
        ).pack(anchor="w", pady=(4, 12))
        ttk.Separator(outer).pack(fill="x", pady=(0, 14))

        info = ttk.LabelFrame(outer, text="Release summary", padding=12)
        info.pack(fill="x")
        info.columnconfigure(1, weight=1)
        info.columnconfigure(3, weight=1)
        ttk.Label(info, text="Current version", style="Muted.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(info, textvariable=self.current_version_var, style="Value.TLabel").grid(row=1, column=0, sticky="w", pady=(2, 0))
        ttk.Label(info, text="Next patch", style="Muted.TLabel").grid(row=0, column=2, sticky="w", padx=(24, 0))
        ttk.Label(info, textvariable=self.next_version_var, style="Value.TLabel").grid(row=1, column=2, sticky="w", padx=(24, 0), pady=(2, 0))
        ttk.Label(info, text="Working tree", style="Muted.TLabel").grid(row=0, column=4, sticky="w", padx=(24, 0))
        self.tree_label = ttk.Label(info, textvariable=self.tree_var, style="Status.TLabel")
        self.tree_label.grid(row=1, column=4, sticky="w", padx=(24, 0), pady=(2, 0))

        actions = ttk.LabelFrame(outer, text="Choose an action", padding=12)
        actions.pack(fill="x", pady=(14, 10))
        actions.columnconfigure(0, weight=1)
        actions.columnconfigure(1, weight=1)

        publish_panel = ttk.Frame(actions, padding=(0, 0, 10, 0))
        publish_panel.grid(row=0, column=0, sticky="nsew")
        ttk.Label(publish_panel, text="Publish update", style="Section.TLabel").pack(anchor="w")
        ttk.Label(
            publish_panel,
            text="Build the installer and upload the updater assets to GitHub.",
            style="Muted.TLabel",
            wraplength=330,
        ).pack(anchor="w", pady=(3, 9))
        self.release_button = ttk.Button(
            publish_panel,
            text="Build & publish update",
            style="Primary.TButton",
            command=self.publish_release,
        )
        self.release_button.pack(anchor="w")

        build_panel = ttk.Frame(actions, padding=(10, 0, 0, 0))
        build_panel.grid(row=0, column=1, sticky="nsew")
        ttk.Label(build_panel, text="Build locally", style="Section.TLabel").pack(anchor="w")
        ttk.Label(
            build_panel,
            text="Create the installer in the output folder without uploading anything.",
            style="Muted.TLabel",
            wraplength=330,
        ).pack(anchor="w", pady=(3, 9))
        self.build_button = ttk.Button(
            build_panel,
            text="Build installer",
            style="Secondary.TButton",
            command=self.build_installer,
        )
        self.build_button.pack(anchor="w")

        options = ttk.LabelFrame(outer, text="Checks & safety", padding=12)
        options.pack(fill="x")
        options.columnconfigure(1, weight=1)
        self.checks_checkbutton = ttk.Checkbutton(options, text="Run preflight checks", variable=self.tests_var)
        self.checks_checkbutton.grid(row=0, column=0, sticky="w")
        ttk.Label(options, text="App checks and the utility-process smoke test", style="Muted.TLabel").grid(row=0, column=1, sticky="w", padx=(18, 0))
        self.allow_dirty_checkbutton = ttk.Checkbutton(options, text="Allow uncommitted changes", variable=self.allow_dirty_var)
        self.allow_dirty_checkbutton.grid(row=1, column=0, sticky="w", pady=(8, 0))
        ttk.Label(options, text="Use only when the working-tree changes are intentional", style="Muted.TLabel").grid(row=1, column=1, sticky="w", padx=(18, 0), pady=(8, 0))

        status = ttk.Frame(outer)
        status.pack(fill="x", pady=(14, 10))
        status_left = ttk.Frame(status)
        status_left.pack(side="left")
        ttk.Label(status_left, text="STATUS", style="Section.TLabel").pack(side="left", padx=(0, 8))
        self.status_label = ttk.Label(status_left, textvariable=self.status_var, style="Status.TLabel")
        self.status_label.pack(side="left")
        self.progress = ttk.Progressbar(status, mode="determinate", maximum=100)
        self.progress.pack(side="right", fill="x", expand=True, padx=(18, 0))

        log_frame = ttk.LabelFrame(outer, text="Run output", padding=6)
        log_frame.pack(fill="both", expand=True)
        self.log = ScrolledText(log_frame, height=12, state=DISABLED, wrap="word", font=("Consolas", 9))
        self.log.pack(fill="both", expand=True)

        utilities = ttk.Frame(outer)
        utilities.pack(fill="x", pady=(10, 0))
        self.open_output_button = ttk.Button(utilities, text="Open output folder", command=self.open_output)
        self.open_output_button.pack(side="left")
        self.open_release_button = ttk.Button(utilities, text="Open published release", command=self.open_release, state=DISABLED)
        self.open_release_button.pack(side="right")

    def refresh_state(self) -> None:
        self.current_version = project_version()
        self.next_version = next_patch(self.current_version)
        changes = working_tree_changes()
        self.current_version_var.set(self.current_version)
        self.next_version_var.set(self.next_version)
        if len(changes) == 1 and changes[0].startswith("Git was not found"):
            self.tree_var.set("Git unavailable")
            self.tree_label.configure(style="Warning.TLabel")
        elif changes:
            self.tree_var.set(f"{len(changes)} uncommitted change(s)")
            self.tree_label.configure(style="Warning.TLabel")
        else:
            self.tree_var.set("Clean")
            self.tree_label.configure(style="Success.TLabel")

    def append_log(self, text: str) -> None:
        self.log.configure(state=NORMAL)
        self.log.insert(END, text.rstrip() + "\n")
        self.log.see(END)
        self.log.configure(state=DISABLED)

    def set_running(self, running: bool) -> None:
        self.running = running
        state = DISABLED if running else NORMAL
        self.release_button.configure(state=state)
        self.build_button.configure(state=state)
        self.open_output_button.configure(state=state)
        self.checks_checkbutton.configure(state=state)
        self.allow_dirty_checkbutton.configure(state=state)
        if not running:
            self.refresh_state()

    def start_job(self, job_name: str, commands: list[tuple[str, list[str]]], release_url: str = "") -> None:
        if self.running:
            return
        self.last_release_url = release_url
        self.open_release_button.configure(state=DISABLED)
        self.log.configure(state=NORMAL)
        self.log.delete("1.0", END)
        self.log.configure(state=DISABLED)
        self.status_var.set(job_name)
        self.status_label.configure(style="Status.TLabel")
        self.progress.configure(mode="indeterminate")
        self.progress.start(12)
        self.set_running(True)
        threading.Thread(target=self.run_job, args=(commands,), daemon=True).start()

    def run_job(self, commands: list[tuple[str, list[str]]]) -> None:
        try:
            for stage, command in commands:
                self.events.put(("stage", (stage, f"Running: {' '.join(command)}")))
                process = subprocess.Popen(
                    command,
                    cwd=ROOT,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    bufsize=1,
                    creationflags=NO_WINDOW,
                )
                assert process.stdout is not None
                for line in process.stdout:
                    self.events.put(("line", line.rstrip()))
                exit_code = process.wait()
                if exit_code != 0:
                    self.events.put(("done", exit_code))
                    return
            self.events.put(("done", 0))
        except OSError as error:
            self.events.put(("line", f"Could not start the release command: {error}"))
            self.events.put(("done", 1))

    def process_events(self) -> None:
        try:
            while True:
                kind, payload = self.events.get_nowait()
                if kind == "stage":
                    stage, message = payload  # type: ignore[misc]
                    self.status_var.set(str(stage))
                    self.status_label.configure(style="Status.TLabel")
                    self.append_log(str(message))
                elif kind == "line":
                    self.handle_output(str(payload))
                elif kind == "done":
                    self.finish_job(int(payload))
        except queue.Empty:
            pass
        self.root.after(100, self.process_events)

    def handle_output(self, line: str) -> None:
        match = PROGRESS_PATTERN.match(line)
        if match:
            percent, stage, message = match.groups()
            self.progress.stop()
            self.progress.configure(mode="determinate", value=int(percent))
            self.status_var.set(f"{stage}: {message}")
            self.status_label.configure(style="Status.TLabel")
            self.append_log(f"{stage}: {message}")
            if int(percent) < 100:
                self.progress.configure(mode="indeterminate")
                self.progress.start(12)
            return
        if line:
            self.append_log(line)

    def finish_job(self, exit_code: int) -> None:
        self.progress.stop()
        self.progress.configure(mode="determinate", value=100 if exit_code == 0 else 0)
        self.set_running(False)
        if exit_code == 0:
            self.status_var.set("Completed successfully")
            self.status_label.configure(style="Success.TLabel")
            if self.last_release_url:
                self.open_release_button.configure(state=NORMAL)
            self.append_log("Completed successfully.")
        else:
            self.status_var.set("Failed — review the activity log")
            self.status_label.configure(style="Error.TLabel")
            messagebox.showerror("Monochromium", "The operation failed. Review the activity log for details.")

    def confirm_dirty(self, action: str) -> bool:
        changes = working_tree_changes()
        if not changes or self.allow_dirty_var.get():
            return True
        messagebox.showwarning(
            "Uncommitted changes",
            f"This project has {len(changes)} uncommitted change(s).\n\n"
            f"Enable 'Allow uncommitted changes' only if they are intentionally included in the {action}.",
        )
        return False

    def publish_release(self) -> None:
        if not self.confirm_dirty("release"):
            return
        if self.next_version == "unknown":
            messagebox.showerror("Invalid version", "package.json does not contain a simple x.y.z version.")
            return
        if not messagebox.askyesno(
            "Publish update",
            f"Build and publish Monochromium {self.next_version}?\n\n"
            "This uploads updater artifacts to GitHub. It does not commit or push source files.",
        ):
            return
        powershell = shutil.which("pwsh.exe") or shutil.which("powershell.exe") or "powershell.exe"
        command = [
            powershell,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(RELEASE_SCRIPT),
            "-Ui",
        ]
        if self.tests_var.get() is False:
            command.append("-SkipTests")
        if self.allow_dirty_var.get():
            command.append("-AllowDirty")
        self.start_job(
            f"Publishing {self.next_version}",
            [("Release", command)],
            f"https://github.com/MaidProton/Monochromium/releases/tag/v{self.next_version}",
        )

    def build_installer(self) -> None:
        if not self.confirm_dirty("local build"):
            return
        npm = shutil.which("npm.cmd") or shutil.which("npm") or "npm.cmd"
        commands: list[tuple[str, list[str]]] = []
        if self.tests_var.get():
            commands.append(("Checks", [npm, "run", "release:checks:app"]))
        commands.append(("Build", [npm, "run", "desktop:make:fast"]))
        if self.tests_var.get():
            commands.append(("Smoke test", [npm, "run", "test:server"]))
        self.start_job("Building local installer", commands)

    def open_output(self) -> None:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        os.startfile(OUTPUT_DIR)  # type: ignore[attr-defined]

    def open_release(self) -> None:
        if self.last_release_url:
            webbrowser.open(self.last_release_url)


def main() -> None:
    root = Tk()
    try:
        ttk.Style(root).theme_use("vista")
    except Exception:
        pass
    ReleaseApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
