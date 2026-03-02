import re

with open('dump-rillcuy.cs', 'r') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "class ChooseHeroMgr" in line:
        for j in range(i, min(len(lines), i+1500)):
            if "on_Notify_StartBan" in lines[j] or "on_Notify_StartSelect" in lines[j] or "RefreshBattlePlayerInfo" in lines[j]:
                print(f"{j+1}: {lines[j].strip()}")
            elif "}" in lines[j]:
                break
