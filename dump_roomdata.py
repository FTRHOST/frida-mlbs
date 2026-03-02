import sys

with open('dump-rillcuy.cs', 'r') as f:
    in_class = False
    for line in f:
        if "class RoomDataManager {" in line:
            in_class = True
            print(line.strip())
        elif in_class:
            if "}" in line:
                in_class = False
                print("}")
                break
            print(line.strip())
