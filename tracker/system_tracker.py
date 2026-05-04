"""
SSO · System Tracker  (system_tracker.py)
==========================================
Tracks active app, window title, website from browser titles,
keystroke rate (WPM), mouse clicks, idle state.

Exposes:
  GET  /status   → returns latest metrics as JSON (browser polls this)
  POST /session  → receives completed session from browser for CSV merge
  GET  /health   → ping

Run:  python3 tracker/system_tracker.py
Stop: Ctrl+C

Requirements:
  pip install pynput

macOS extra: System Settings → Privacy → Accessibility + Input Monitoring → allow Terminal
Linux extra: sudo apt install xdotool
"""

import csv, json, os, platform, re, threading, time
from collections import deque
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────
PORT             = 7891
CSV_PATH         = Path("data/session_log.csv")
LOG_INTERVAL_SEC = 5
IDLE_THRESHOLD   = 30   # seconds
KEYSTROKE_WINDOW = 60   # rolling window for WPM

SYSTEM = platform.system()

# ── Optional pynput ───────────────────────────────────────────────────────
try:
    from pynput import keyboard, mouse as pmouse
    PYNPUT = True
except ImportError:
    PYNPUT = False
    print("[warn] pynput not installed — install with: pip install pynput")

try:
    import subprocess
except: pass

# ── State ─────────────────────────────────────────────────────────────────
class State:
    def __init__(self):
        self.lock            = threading.Lock()
        self.key_times       = deque()
        self.keys_interval   = 0
        self.total_keys      = 0
        self.mouse_clicks    = 0
        self.mouse_clicks_iv = 0
        self.mouse_moves     = 0
        self.total_clicks    = 0
        self.last_input      = time.time()
        self.active_app      = ""
        self.active_title    = ""
        self.website         = ""
        self._pending_session = {}

S = State()

# ── Window detection ──────────────────────────────────────────────────────
BROWSER_NAMES = {"chrome","firefox","safari","edge","brave","opera","arc","vivaldi"}
URL_RE = re.compile(r"([\w-]+\.(com|org|net|io|co|edu|gov|dev|app)[^\s]*)")

def get_window_macos():
    script = '''
    tell application "System Events"
        set fa to name of first application process whose frontmost is true
        try
            set ft to name of front window of (first application process whose frontmost is true)
        on error
            set ft to ""
        end try
        return fa & "|" & ft
    end tell'''
    try:
        r = subprocess.run(["osascript","-e",script], capture_output=True, text=True, timeout=2)
        parts = r.stdout.strip().split("|",1)
        return parts[0].strip(), (parts[1].strip() if len(parts)>1 else "")
    except: return "",""

def get_window_windows():
    try:
        import ctypes, ctypes.wintypes
        hwnd = ctypes.windll.user32.GetForegroundWindow()
        n = ctypes.windll.user32.GetWindowTextLengthW(hwnd)+1
        buf = ctypes.create_unicode_buffer(n)
        ctypes.windll.user32.GetWindowTextW(hwnd, buf, n)
        pid = ctypes.wintypes.DWORD()
        ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        h = ctypes.windll.kernel32.OpenProcess(0x0410, False, pid.value)
        buf2 = ctypes.create_unicode_buffer(512)
        ctypes.windll.psapi.GetModuleFileNameExW(h, None, buf2, 512)
        ctypes.windll.kernel32.CloseHandle(h)
        return Path(buf2.value).stem if buf2.value else "", buf.value
    except: return "",""

def get_window_linux():
    try:
        wid   = subprocess.check_output(["xdotool","getactivewindow"],text=True).strip()
        title = subprocess.check_output(["xdotool","getwindowname",wid],text=True).strip()
        pid   = subprocess.check_output(["xdotool","getwindowpid",wid],text=True).strip()
        app   = subprocess.check_output(["ps","-p",pid,"-o","comm="],text=True).strip()
        return app, title
    except: return "",""

def get_active_window():
    if SYSTEM=="Darwin":  return get_window_macos()
    if SYSTEM=="Windows": return get_window_windows()
    if SYSTEM=="Linux":   return get_window_linux()
    return "",""

def extract_website(app, title):
    if not app: return ""
    if app.lower().split(".")[0] not in BROWSER_NAMES: return ""
    m = URL_RE.search(title)
    if m: return m.group(0)
    for sep in [" - "," | "," – "]:
        if sep in title:
            c = title.split(sep)[-1].strip()
            if "." in c and len(c)<60: return c
    return ""

# ── Input listeners ───────────────────────────────────────────────────────
def on_key(key):
    now = time.time()
    with S.lock:
        S.key_times.append(now)
        S.total_keys += 1
        S.keys_interval += 1
        S.last_input = now

def on_click(x, y, button, pressed):
    if pressed:
        with S.lock:
            S.mouse_clicks += 1
            S.mouse_clicks_iv += 1
            S.total_clicks += 1
            S.last_input = time.time()

def on_move(x, y):
    with S.lock:
        S.mouse_moves += 1
        S.last_input = time.time()

def start_listeners():
    if not PYNPUT: return
    kb = keyboard.Listener(on_press=on_key)
    ms = pmouse.Listener(on_click=on_click, on_move=on_move)
    kb.daemon = ms.daemon = True
    kb.start(); ms.start()

def calc_wpm():
    now = time.time()
    cutoff = now - KEYSTROKE_WINDOW
    with S.lock:
        while S.key_times and S.key_times[0] < cutoff:
            S.key_times.popleft()
        n = len(S.key_times)
    elapsed = min(KEYSTROKE_WINDOW, now)
    return round((n / elapsed * 60) / 5, 1) if elapsed > 0 else 0.0

def snapshot():
    """Return current state dict, reset interval counters."""
    now = time.time()
    with S.lock:
        idle = round(now - S.last_input, 1)
        ki = S.keys_interval; S.keys_interval = 0
        ci = S.mouse_clicks_iv; S.mouse_clicks_iv = 0
        mv = S.mouse_moves; S.mouse_moves = 0
    return {
        "activeApp":   S.active_app,
        "windowTitle": S.active_title[:120],
        "website":     S.website,
        "wpm":         calc_wpm(),
        "keysInterval": ki,
        "totalKeys":   S.total_keys,
        "mouseClicks": ci,
        "totalClicks": S.total_clicks,
        "mouseMoves":  mv,
        "idleSeconds": idle,
        "isIdle":      idle >= IDLE_THRESHOLD,
        "platform":    SYSTEM,
        "timestamp":   datetime.now().isoformat(timespec="seconds"),
    }

# ── Window polling thread ─────────────────────────────────────────────────
def window_poll():
    while True:
        app, title = get_active_window()
        site = extract_website(app, title)
        with S.lock:
            S.active_app   = app
            S.active_title = title
            S.website      = site
        time.sleep(1)

# ── CSV logging ───────────────────────────────────────────────────────────
CSV_FIELDS = [
    "timestamp","active_app","window_title","website",
    "wpm","keys_interval","total_keys",
    "mouse_clicks_interval","total_clicks","mouse_moves",
    "idle_seconds","is_idle","platform","session_data"
]

def ensure_csv():
    CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not CSV_PATH.exists():
        with open(CSV_PATH,"w",newline="",encoding="utf-8") as f:
            csv.DictWriter(f, CSV_FIELDS).writeheader()
        print(f"[csv] Created {CSV_PATH}")

def write_csv_row(data):
    row = {
        "timestamp":             data["timestamp"],
        "active_app":            data["activeApp"],
        "window_title":          data["windowTitle"],
        "website":               data["website"],
        "wpm":                   data["wpm"],
        "keys_interval":         data["keysInterval"],
        "total_keys":            data["totalKeys"],
        "mouse_clicks_interval": data["mouseClicks"],
        "total_clicks":          data["totalClicks"],
        "mouse_moves":           data["mouseMoves"],
        "idle_seconds":          data["idleSeconds"],
        "is_idle":               data["isIdle"],
        "platform":              data["platform"],
        "session_data":          json.dumps(S._pending_session) if S._pending_session else "",
    }
    with open(CSV_PATH,"a",newline="",encoding="utf-8") as f:
        csv.DictWriter(f, CSV_FIELDS).writerow(row)
    S._pending_session = {}
    return row

# ── HTTP Server ───────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Access-Control-Allow-Methods","GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers","Content-Type")

    def do_OPTIONS(self):
        self.send_response(200); self._cors(); self.end_headers()

    def do_GET(self):
        if self.path in ("/status", "/health"):
            data = json.dumps(snapshot()).encode()
            self.send_response(200)
            self.send_header("Content-Type","application/json")
            self._cors(); self.end_headers()
            self.wfile.write(data)
        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        if self.path == "/session":
            n = int(self.headers.get("Content-Length",0))
            body = self.rfile.read(n)
            try:
                with S.lock:
                    S._pending_session = json.loads(body)
                self.send_response(200); self._cors(); self.end_headers()
                self.wfile.write(b'{"ok":true}')
            except Exception as e:
                self.send_response(400); self.end_headers(); self.wfile.write(str(e).encode())
        else:
            self.send_response(404); self.end_headers()

    def log_message(self, *_): pass

# ── Main ──────────────────────────────────────────────────────────────────
def main():
    print("═"*52)
    print("  SSO · System Tracker")
    print(f"  Platform : {SYSTEM}")
    print(f"  Port     : {PORT}")
    print(f"  CSV      : {CSV_PATH.resolve()}")
    print(f"  pynput   : {'✓' if PYNPUT else '✗ (install: pip install pynput)'}")
    print("═"*52)

    ensure_csv()
    S._pending_session = {}

    # Background threads
    wt = threading.Thread(target=window_poll, daemon=True); wt.start()
    start_listeners()

    # HTTP server
    srv = HTTPServer(("127.0.0.1", PORT), Handler)
    st = threading.Thread(target=srv.serve_forever, daemon=True); st.start()
    print(f"[server] Listening on http://127.0.0.1:{PORT}")
    print("[tracker] Running — Ctrl+C to stop\n")

    try:
        while True:
            time.sleep(LOG_INTERVAL_SEC)
            data = snapshot()
            row  = write_csv_row(data)
            idle_str = f"IDLE {data['idleSeconds']}s" if data["isIdle"] else "active"
            print(
                f"[{data['timestamp']}] "
                f"{data['activeApp'][:18]:<18} | "
                f"site={data['website'][:22]:<22} | "
                f"wpm={data['wpm']:<5} | "
                f"keys={data['keysInterval']:<4} | "
                f"{idle_str}"
            )
    except KeyboardInterrupt:
        print(f"\n[tracker] Stopped · CSV: {CSV_PATH.resolve()}")

if __name__ == "__main__":
    main()
