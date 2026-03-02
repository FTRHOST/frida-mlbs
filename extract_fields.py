import sys

with open('dump-rillcuy.cs', 'r') as f:
    lines = f.readlines()

def find_class_fields(class_name):
    print(f"--- {class_name} ---")
    in_class = False
    for line in lines:
        if f"class {class_name} {{" in line:
            in_class = True
        elif in_class:
            if "}" in line:
                break
            if "[Field]" in line and "m_players" in line.lower() or "_players" in line.lower():
                print(line.strip())

find_class_fields("RoomDataManager")
