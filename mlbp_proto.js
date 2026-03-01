/**
 * MLBB Draft Pick Proto Scraper
 * Membaca data server-side Draft Pick dari game Mobile Legends
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

    let image, kChooseHeroMgr;
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
    }

    if(!kChooseHeroMgr) {
        console.log("[-] ChooseHeroMgr class not found.");
        return;
    }
    console.log("[+] ChooseHeroMgr found.");

    // Hooking Methods in ChooseHeroMgr to catch MTTDProto structs
    function hookMethod(className, methodPointerAddr, methodName) {
        if(methodPointerAddr.isNull()) return;
        Interceptor.attach(methodPointerAddr, {
            onEnter: function(args) {
                // For instance methods, args[0] is the `this` pointer, args[1] is the first argument
                if (!args[1].isNull()) {
                    try {
                        let protoObj = args[1];

                        if (methodName === "on_Notify_StartBan") {
                            // Fields dari Cmd_Notify_StartBan:
                            // [Field] 0x58 : uiBanHeroTime
                            // [Field] 0x5c : uiBanSelHeroTime
                            // [Field] 0x60 : uiExchangeHeroTime
                            // [Field] 0x7c : bOpenBanPickCtrl
                            let payload = {
                                type: "StartBan",
                                uiBanHeroTime: protoObj.add(0x58).readInt(),
                                uiBanSelHeroTime: protoObj.add(0x5c).readInt(),
                                bOpenBanPickCtrl: protoObj.add(0x7c).readU8() === 1
                            };
                            console.log(JSON.stringify(payload));
                            send({ type: "draft_proto_update", payload: payload });

                        } else if (methodName === "on_Notify_StartSelect") {
                            // Fields dari Cmd_Notify_StartSelect:
                            // [Field] 0x40 : uiSelectHeroTime
                            // [Field] 0x44 : uiFinalReadyTime
                            let payload = {
                                type: "StartSelect",
                                uiSelectHeroTime: protoObj.add(0x40).readInt(),
                                uiFinalReadyTime: protoObj.add(0x44).readInt()
                            };
                            console.log(JSON.stringify(payload));
                            send({ type: "draft_proto_update", payload: payload });

                        } else if (methodName === "on_Notify_BanPickCtrl" || methodName === "on_BanPickCtrl") {
                            // Fields dari Cmd_Notify_BanPickCtrl / OperType_Battle_BanPickCtrl
                            // [Field] 0x10 : iOper
                            // [Field] 0x14 : iTime
                            let payload = {
                                type: "BanPickCtrl",
                                iOper: protoObj.add(0x10).readInt(),
                                iTime: protoObj.add(0x14).readInt()
                            };
                            console.log(JSON.stringify(payload));
                            send({ type: "draft_proto_update", payload: payload });
                        }
                    } catch(e) {
                        // console.log(`   - Error parsing proto: ${e.message}`);
                    }
                }
            }
        });
    }

    const mBanPickCtrl = il2cpp.class_get_method_from_name(kChooseHeroMgr, Memory.allocUtf8String("on_BanPickCtrl"), 1);
    if (!mBanPickCtrl.isNull()) {
        hookMethod("ChooseHeroMgr", mBanPickCtrl.readPointer(), "on_BanPickCtrl");
    }

    const mNotifyBanPickCtrl = il2cpp.class_get_method_from_name(kChooseHeroMgr, Memory.allocUtf8String("on_Notify_BanPickCtrl"), 1);
    if (!mNotifyBanPickCtrl.isNull()) {
        hookMethod("ChooseHeroMgr", mNotifyBanPickCtrl.readPointer(), "on_Notify_BanPickCtrl");
    }

    const mNotifyStartBan = il2cpp.class_get_method_from_name(kChooseHeroMgr, Memory.allocUtf8String("on_Notify_StartBan"), 1);
    if (!mNotifyStartBan.isNull()) {
        hookMethod("ChooseHeroMgr", mNotifyStartBan.readPointer(), "on_Notify_StartBan");
    }

    const mNotifyStartSelect = il2cpp.class_get_method_from_name(kChooseHeroMgr, Memory.allocUtf8String("on_Notify_StartSelect"), 1);
    if (!mNotifyStartSelect.isNull()) {
        hookMethod("ChooseHeroMgr", mNotifyStartSelect.readPointer(), "on_Notify_StartSelect");
    }

    console.log("[*] MTTDProto Draft Hooks Active!");
}

const check = setInterval(() => {
    const mod = Process.findModuleByName("liblogic.so");
    if (mod) { clearInterval(check); startProtoScraping(mod.name); }
}, 2000);
