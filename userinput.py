# userinput.py
import os
import subprocess
import time

RESPONSE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "response.txt")

# Remove old response file if it exists
if os.path.exists(RESPONSE_FILE):
    os.remove(RESPONSE_FILE)

# Open a new PowerShell window that prompts the user and saves to response.txt
ps_command = (
    f"$r = Read-Host 'GlitchDraft Feedback - Type your feedback then press Enter'; "
    f"$r | Out-File -FilePath '{RESPONSE_FILE}' -Encoding UTF8"
)

subprocess.Popen(
    ["powershell", "-Command", ps_command], creationflags=subprocess.CREATE_NEW_CONSOLE
)

# Poll for the response file
print("Waiting for feedback input in the PowerShell window...")
timeout = 300  # 5 minutes
elapsed = 0
while elapsed < timeout:
    time.sleep(1)
    elapsed += 1
    if os.path.exists(RESPONSE_FILE):
        time.sleep(0.5)  # small delay to ensure write is complete
        with open(RESPONSE_FILE, "r", encoding="utf-8-sig") as f:
            user_input = f.read().strip()
        if user_input:
            print(user_input)
            break
