/**
 * MLBB Draft Pick RoomData Polling
 * Menggunakan RoomDataManager._instance._players (Direct Memory Read)
 */

function startRoomDataPolling(libName) {
    const targetLib = Process.getModuleByName(libName);
    function n(name, ret, args) {
        const addr = targetLib.findExportByName(name);
        return addr ? new NativeFunction(addr, ret, args) : null;
    }

    const il2cpp = {
        domain_get: n("il2cpp_domain_get", 'pointer', []),
        domain_get_assemblies: n("il2cpp_domain_get_assemblies", 'pointer', ['pointer', 'pointer']),
        assembly_get_image: n("il2cpp_assembly_get_image", 'pointer', ['pointer']),
        image_get_name: n("il2cpp_image_get_name", 'pointer', ['pointer']),
        image_get_class_count: n("il2cpp_image_get_class_count", 'uint64', ['pointer']),
        image_get_class: n("il2cpp_image_get_class", 'pointer', ['pointer', 'uint64']),
        class_get_name: n("il2cpp_class_get_name", 'pointer', ['pointer']),
        class_get_method_from_name: n("il2cpp_class_get_method_from_name", 'pointer', ['pointer', 'pointer', 'int']),
        class_get_field_from_name: n("il2cpp_class_get_field_from_name", 'pointer', ['pointer', 'pointer']),
        field_static_get_value: n("il2cpp_field_static_get_value", 'void', ['pointer', 'pointer'])
    };

    let image = null;
    let kRoomDataManager = null;

    const assemblies = il2cpp.domain_get_assemblies(il2cpp.domain_get(), Memory.alloc(8));

    for (let i = 0; i < 100; i++) {
        const assembly = assemblies.add(i * Process.pointerSize).readPointer();
        if (assembly.isNull()) continue;
        const img = il2cpp.assembly_get_image(assembly);
        if (img.isNull()) continue;
        if (il2cpp.image_get_name(img).readCString() === "Assembly-CSharp.dll") { image = img; break; }
    }

    if (!image) {
        console.log("[-] Assembly-CSharp.dll not found");
        return;
    }

    const classCount = Number(il2cpp.image_get_class_count(image));
    for (let j = 0; j < classCount; j++) {
        const k = il2cpp.image_get_class(image, j);
        const name = il2cpp.class_get_name(k).readCString();
        if (name === "RoomDataManager") {
            kRoomDataManager = k;
            break;
        }
    }

    if(!kRoomDataManager) {
        console.log("[-] RoomDataManager class not found.");
        return;
    }
    console.log("[+] RoomDataManager found. Starting polling...");

    // --- HELPER BACA STRING ---
    function readCsharpString(ptr) {
        if (ptr.isNull()) return "";
        try {
            const len = ptr.add(0x10).readInt();
            if (len <= 0 || len > 200) return "";
            return ptr.add(0x14).readUtf16String(len);
        } catch(e) { return ""; }
    }

    // Offset static field `_instance` (biasanya offset 0x0 dalam static block)
    const fieldInstanceRD = il2cpp.class_get_field_from_name(kRoomDataManager, Memory.allocUtf8String("_instance"));

    setInterval(() => {
        try {
            // Dapatkan pointer ke instance singleton _instance
            const instPtrRD = Memory.alloc(Process.pointerSize);
            il2cpp.field_static_get_value(fieldInstanceRD, instPtrRD);
            const instRD = instPtrRD.readPointer();

            if(instRD.isNull()) {
                // RoomDataManager belum init
                return;
            }

            // Baca field _players di offset 0x10 dari instance
            const playersList = instRD.add(0x10).readPointer();
            if(playersList.isNull()) {
                return;
            }

            // Di Unity/Il2Cpp, List<T> struct -> 0x10: array, 0x18: count
            const itemsArray = playersList.add(0x10).readPointer();
            const listSize = playersList.add(0x18).readInt();

            if (listSize <= 0 || listSize > 20) {
                // Not in a valid room
                return;
            }

            let payload = {
                type: "draft_roomdata_polling",
                players: []
            };

            for (let i = 0; i < listSize; i++) {
                // Array item start at 0x20
                const roomDataPtr = itemsArray.add(0x20 + (i * Process.pointerSize)).readPointer();
                if(roomDataPtr.isNull()) continue;

                // Membaca offset dari class RoomData (berdasarkan C# dump user):
                // [Field] 0x40 : _sName
                // [Field] 0x4c : heroid
                // [Field] 0x64 : summonSkillId
                // [Field] 0x140 : iRoad
                // [Field] 0x30 : iCamp
                // [Field] 0xb0 : banHero

                const namePtr = roomDataPtr.add(0x40).readPointer();
                const playerName = readCsharpString(namePtr);

                const heroId = roomDataPtr.add(0x4c).readInt();
                const summonSkillId = roomDataPtr.add(0x64).readInt();
                const iRoad = roomDataPtr.add(0x140).readInt();
                const iCamp = roomDataPtr.add(0x30).readInt();
                const banHero = roomDataPtr.add(0xb0).readInt();

                payload.players.push({
                    name: playerName,
                    camp: iCamp,
                    heroId: heroId,
                    banHero: banHero,
                    battleSkillId: summonSkillId,
                    lane: iRoad
                });
            }

            if(payload.players.length > 0) {
                console.log(JSON.stringify(payload));
                send(payload);
            }

        } catch (e) {
            // Aktifkan error log
            console.log("[-] Loop Error: " + e.message);
        }
    }, 1000);
}

const check = setInterval(() => {
    const mod = Process.findModuleByName("liblogic.so");
    if (mod) { clearInterval(check); startRoomDataPolling(mod.name); }
}, 2000);
