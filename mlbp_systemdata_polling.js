/**
 * MLBB Draft Pick RoomData Polling
 * Membaca data secara aktif setiap 1 detik dari SystemData.GetBattlePlayerInfo()
 * Termasuk mengembalikan Game State dari LogicBattleManager.
 */

function startDraftPolling(libName) {
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
    let kSystemData = null;
    let kLogicBattleManager = null;

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
        if (name === "SystemData") kSystemData = k;
        if (name === "LogicBattleManager") kLogicBattleManager = k;
    }

    if(!kSystemData || !kLogicBattleManager) {
        console.log("[-] SystemData or LogicBattleManager class not found.");
        return;
    }
    console.log("[+] SystemData & LogicBattleManager found. Starting Polling...");

    // --- HELPER BACA STRING ---
    function readCsharpString(ptr) {
        if (ptr.isNull()) return "";
        try {
            const len = ptr.add(0x10).readInt();
            if (len <= 0 || len > 200) return "";
            return ptr.add(0x14).readUtf16String(len);
        } catch(e) { return ""; }
    }

    // Static Field: LogicBattleManager.Instance
    const fieldInstanceLM = il2cpp.class_get_field_from_name(kLogicBattleManager, Memory.allocUtf8String("Instance"));

    // Methods
    const mGetBattleState = il2cpp.class_get_method_from_name(kLogicBattleManager, Memory.allocUtf8String("GetBattleState"), 0);
    const mGetBattlePlayerInfo = il2cpp.class_get_method_from_name(kSystemData, Memory.allocUtf8String("GetBattlePlayerInfo"), 0);

    let getBattleStateFunc = null;
    let getBattlePlayerInfoFunc = null;

    if (!mGetBattleState.isNull()) getBattleStateFunc = new NativeFunction(mGetBattleState.readPointer(), 'int', ['pointer']);
    if (!mGetBattlePlayerInfo.isNull()) getBattlePlayerInfoFunc = new NativeFunction(mGetBattlePlayerInfo.readPointer(), 'pointer', ['pointer']);

    setInterval(() => {
        try {
            if (!getBattleStateFunc || !getBattlePlayerInfoFunc) return;

            // 1. Dapatkan Battle State
            let battleState = -1;
            const instPtrLM = Memory.alloc(Process.pointerSize);
            il2cpp.field_static_get_value(fieldInstanceLM, instPtrLM);
            const instLM = instPtrLM.readPointer();
            if (!instLM.isNull()) {
                battleState = getBattleStateFunc(instLM);
            }

            // 2. Dapatkan List Player Info (Static call, argumen this bisa dilempar NULL jika static)
            // Note: GetBattlePlayerInfo pada class static di C# bisa berupa method static.
            const playersList = getBattlePlayerInfoFunc(NULL);

            if(playersList.isNull()) {
                // Di menu utama biasanya list kosong / null
                // console.log(`[Diagnostic] State: ${battleState} | Players List is NULL`);
                return;
            }

            // Membaca object List<SystemData.RoomData>
            // 0x10 adalah backing array, 0x18 adalah count
            const itemsArray = playersList.add(0x10).readPointer();
            const listSize = playersList.add(0x18).readInt();

            if (listSize <= 0 || listSize > 20) {
                // Not in a valid room
                return;
            }

            let payload = {
                type: "draft_polling",
                state: battleState,
                players: []
            };

            for (let i = 0; i < listSize; i++) {
                // Array item start at 0x20
                const roomDataPtr = itemsArray.add(0x20 + (i * Process.pointerSize)).readPointer();
                if(roomDataPtr.isNull()) continue;

                // Field offsets dari SystemData.RoomData:
                // [Field] 0x30 : iCamp
                // [Field] 0x40 : _sName
                // [Field] 0x4c : heroid
                // [Field] 0x64 : summonSkillId
                // [Field] 0xb0 : banHero
                // [Field] 0x140 : iRoad

                const namePtr = roomDataPtr.add(0x40).readPointer();
                const playerName = readCsharpString(namePtr);

                const iCamp = roomDataPtr.add(0x30).readInt();
                const heroId = roomDataPtr.add(0x4c).readInt();
                const summonSkillId = roomDataPtr.add(0x64).readInt();
                const banHero = roomDataPtr.add(0xb0).readInt();
                const iRoad = roomDataPtr.add(0x140).readInt();

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
    }, 1000);
}

const check = setInterval(() => {
    const mod = Process.findModuleByName("liblogic.so");
    if (mod) { clearInterval(check); startDraftPolling(mod.name); }
}, 2000);
