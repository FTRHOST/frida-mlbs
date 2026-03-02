/**
 * MLBB Draft Pick Real-Time Scraper
 * Membaca data server-side Draft Pick & RoomData
 * Fokus kepada nama player, hero di pick/ban, battleskill, dan road (lane).
 */

function startProtoScraping(libName) {
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
        field_static_get_value: n("il2cpp_field_static_get_value", 'void', ['pointer', 'pointer']),
        string_chars: n("il2cpp_string_chars", 'pointer', ['pointer'])
    };

    let image, kChooseHeroMgr, kRoomDataManager, kRoomData;
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
        if (name === "ChooseHeroMgr") kChooseHeroMgr = k;
        if (name === "RoomDataManager") kRoomDataManager = k;
        if (name === "RoomData") kRoomData = k;
    }

    if(!kChooseHeroMgr || !kRoomDataManager || !kRoomData) {
        console.log("[-] Required classes not found.");
        return;
    }
    console.log("[+] ChooseHeroMgr & RoomDataManager found.");

    // --- HELPER BACA STRING ---
    function readCsharpString(ptr) {
        if (ptr.isNull()) return "";
        try {
            const len = ptr.add(0x10).readInt();
            if (len <= 0 || len > 200) return "";
            return ptr.add(0x14).readUtf16String(len);
        } catch(e) { return ""; }
    }

    // --- INSTANCE ---
    const fieldInstanceRD = il2cpp.class_get_field_from_name(kRoomDataManager, Memory.allocUtf8String("_instance"));
    const mGetPlayers = il2cpp.class_get_method_from_name(kRoomDataManager, Memory.allocUtf8String("GetPlayers"), 0);

    let getPlayersFunc = null;
    if(!mGetPlayers.isNull()) {
        getPlayersFunc = new NativeFunction(mGetPlayers.readPointer(), 'pointer', ['pointer']);
    }

    setInterval(() => {
        try {
            // Get RoomDataManager Instance
            const instPtrRD = Memory.alloc(Process.pointerSize);
            il2cpp.field_static_get_value(fieldInstanceRD, instPtrRD);
            const instRD = instPtrRD.readPointer();

            if(instRD.isNull()) {
                console.log("[-] RoomDataManager._instance is NULL");
                return;
            }
            if(getPlayersFunc === null) {
                console.log("[-] GetPlayers function pointer is NULL");
                return;
            }

            // Get List of RoomData
            const playersList = getPlayersFunc(instRD);
            if(playersList.isNull()) {
                console.log("[-] Players list is NULL");
                return;
            }

            // Cek apakah struct List C# sesuai
            const itemsArray = playersList.add(0x10).readPointer();
            const listSize = playersList.add(0x18).readInt();

            if (listSize <= 0 || listSize > 20) {
                console.log("[-] Invalid List Size: " + listSize);
                // Invalid size or no players, just return quietly
                return;
            }

            let payload = {
                type: "draft_room_data",
                players: []
            };

            for (let i = 0; i < listSize; i++) {
                const roomDataPtr = itemsArray.add(0x20 + (i * Process.pointerSize)).readPointer();
                if(roomDataPtr.isNull()) continue;

                // Membaca offset dari class RoomData (berdasarkan dump):
                // [Field] 0x40 : _sName
                // [Field] 0x4c : heroid
                // [Field] 0x64 : summonSkillId (battleskill)
                // [Field] 0x140 : iRoad (Lane)
                // [Field] 0x30 : iCamp (Team)
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
            console.log("[-] Loop Error: " + e.message);
        }
    }, 2000);
}

const check = setInterval(() => {
    const mod = Process.findModuleByName("liblogic.so");
    if (mod) { clearInterval(check); startProtoScraping(mod.name); }
}, 2000);