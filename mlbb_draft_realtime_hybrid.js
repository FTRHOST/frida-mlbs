/**
 * MLBB Draft Pick Real-Time Scraper (Hybrid)
 * Menambahkan cache state untuk di-polling secara aktif agar
 * frontend/client mendapat update setiap 2 detik meskipun tidak ada event masuk.
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
        class_get_method_from_name: n("il2cpp_class_get_method_from_name", 'pointer', ['pointer', 'pointer', 'int'])
    };

    let image = null;
    let kChooseHeroMgr = null;
    let kBattleReceiveMessage = null;

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
        if (name === "BattleReceiveMessage") kBattleReceiveMessage = k;
    }

    if(!kChooseHeroMgr) {
        console.log("[-] ChooseHeroMgr class not found.");
        return;
    }
    console.log("[+] Classes found. Injecting hybrid hooks...");

    // Cache untuk menampung data pemain terakhir yang valid.
    let lastKnownPlayers = [];

    // --- HELPER BACA STRING ---
    function readCsharpString(ptr) {
        if (ptr.isNull()) return "";
        try {
            const len = ptr.add(0x10).readInt();
            if (len <= 0 || len > 200) return "";
            return ptr.add(0x14).readUtf16String(len);
        } catch(e) { return ""; }
    }

    // Fungsi untuk memparsing list <MTTDProto.BattlePlayerInfo>
    function parsePlayerList(listPtr, eventName) {
        if (listPtr.isNull()) return;
        try {
            const itemsArray = listPtr.add(0x10).readPointer();
            const listSize = listPtr.add(0x18).readInt();
            if (listSize <= 0 || listSize > 20) return;

            let currentPlayers = [];

            for (let i = 0; i < listSize; i++) {
                const playerPtr = itemsArray.add(0x20 + (i * Process.pointerSize)).readPointer();
                if(playerPtr.isNull()) continue;

                const namePtr = playerPtr.add(0x20).readPointer();
                const playerName = readCsharpString(namePtr);

                const iCamp = playerPtr.add(0x18).readInt();
                const uiSelHero = playerPtr.add(0x34).readInt();
                const uiSkillId = playerPtr.add(0x40).readInt();
                const uiBanHero = playerPtr.add(0x98).readInt();
                const iRoad = playerPtr.add(0x174).readInt();

                currentPlayers.push({
                    name: playerName,
                    camp: iCamp,
                    heroId: uiSelHero,
                    banHero: uiBanHero,
                    battleSkillId: uiSkillId,
                    lane: iRoad
                });
            }

            // Update global cache
            if (currentPlayers.length > 0) {
                lastKnownPlayers = currentPlayers;

                // Kirim seketika saat event terjadi
                let payload = {
                    type: "draft_proto_event",
                    event: eventName,
                    players: currentPlayers
                };
                console.log(`\n[+] Event: ${eventName}`);
                console.log(JSON.stringify(payload));
                send(payload);
            }

        } catch (e) {
            console.log(`[-] Error parsing player list for ${eventName}: ${e.message}`);
        }
    }

    function hookProtoMethod(methodName, classNamePtr) {
        const method = il2cpp.class_get_method_from_name(classNamePtr, Memory.allocUtf8String(methodName), -1);
        if (!method.isNull()) {
            Interceptor.attach(method.readPointer(), {
                onEnter: function(args) {
                    if (!args[1].isNull()) {
                        parsePlayerList(args[1], methodName);
                    }
                }
            });
            console.log(`   [Hooked] ${methodName}`);
        } else {
            console.log(`   [Not Found] ${methodName}`);
        }
    }

    // List of events yang argumen ke-2 (args[1]) adalah List<MTTDProto.BattlePlayerInfo>
    hookProtoMethod("on_Notify_StartBan", kChooseHeroMgr);
    hookProtoMethod("on_Notify_StartSelect", kChooseHeroMgr);
    hookProtoMethod("RefreshBattlePlayerInfo", kChooseHeroMgr);
    hookProtoMethod("on_Notify_CommStartPreSelectRoad", kChooseHeroMgr);
    hookProtoMethod("on_Notify_StartChooseRoad", kChooseHeroMgr);

    // ==========================================
    // POLLING ACTIVE (Memastikan data terkirim meski tidak ada event baru)
    // ==========================================
    setInterval(() => {
        // Hanya mengirim jika cache data sudah terisi (sudah masuk draft)
        if (lastKnownPlayers.length > 0) {
            let payload = {
                type: "draft_polling",
                players: lastKnownPlayers
            };
            send(payload);
        }
    }, 2000);

    console.log("[*] Hybrid Draft Hooks & Polling Active!");
}

const check = setInterval(() => {
    const mod = Process.findModuleByName("liblogic.so");
    if (mod) { clearInterval(check); startProtoScraping(mod.name); }
}, 2000);
