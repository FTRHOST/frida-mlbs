import re

with open('dump-rillcuy.cs', 'r') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "class SystemData {" in line:
        for j in range(i, min(len(lines), i+1500)):
            if "m_quickMatchRoomPayerList" in lines[j] or "_players" in lines[j]:
                print(f"Line {j+1}: {lines[j].strip()}")
            elif "}" in lines[j]:
                break
