/**
 * MLBB UNLOCK ALL (SKIN, STATUE, PAINT, ACTION, EFFECT) & UNRELEASED HOOK
 * Menggunakan Il2Cpp Dynamic Reflection
 */

const MOD_CONFIG = {
  UnreleasedEnabled: true,  // Toggle Unreleased Heroes & Skins
  UnlockAllEnabled: true    // Toggle Unlock ALL Cosmetics
};

let il2cpp = null;

// ==========================================
// INISIALISASI IL2CPP API
// ==========================================
function initIl2cpp(libName) {
  const targetLib = Process.getModuleByName(libName);
  const n = (name, ret, args) => {
    const addr = targetLib.findExportByName(name);
    return addr ? new NativeFunction(addr, ret, args) : null;
  };

  il2cpp = {
    domain_get: n("il2cpp_domain_get", 'pointer', []),
    domain_get_assemblies: n("il2cpp_domain_get_assemblies", 'pointer', ['pointer', 'pointer']),
    assembly_get_image: n("il2cpp_assembly_get_image", 'pointer', ['pointer']),
    image_get_class_count: n("il2cpp_image_get_class_count", 'uint64', ['pointer']),
    image_get_class: n("il2cpp_image_get_class", 'pointer', ['pointer', 'uint64']),
    class_get_name: n("il2cpp_class_get_name", 'pointer', ['pointer']),
    class_get_methods: n("il2cpp_class_get_methods", 'pointer', ['pointer', 'pointer']),
    method_get_name: n("il2cpp_method_get_name", 'pointer', ['pointer']),
    method_get_return_type: n("il2cpp_method_get_return_type", 'pointer', ['pointer']),
    class_from_type: n("il2cpp_class_from_type", 'pointer', ['pointer']),
    object_new: n("il2cpp_object_new", 'pointer', ['pointer']) // Untuk membuat instance class baru
  };
  console.log("[+] API IL2CPP Initialized.");
}

function findClassPtr(name) {
  const domain = il2cpp.domain_get();
  let size = Memory.alloc(8);
  const assemblies = il2cpp.domain_get_assemblies(domain, size);
  for (let i = 0; i < size.readUInt(); i++) {
    const img = il2cpp.assembly_get_image(assemblies.add(i * Process.pointerSize).readPointer());
    for (let j = 0; j < il2cpp.image_get_class_count(img); j++) {
      const klass = il2cpp.image_get_class(img, j);
      if (!klass.isNull() && il2cpp.class_get_name(klass).readUtf8String() === name) return klass;
    }
  }
  return null;
}

// ==========================================
// 1. HOOK UNRELEASED FEATURES
// ==========================================
function hookUnreleasedFeatures() {
  const targetMethods = [
    "IsForbidSkin", "IsForbidHeros", "IsForbidARSkin", "IsForbidARHeros",
    "IsForbidHeroInChooseHero", "IsActivityForbidHeros", "IsReplaceForbidHeros",
    "IsForbidNewHeroList", "IsForbidHeadFrameForce", "IsForbidHeroDisOrder",
    "IsForbidSkinNumTag", "IsForbidHero1v1", "IsForbidHeadFrame",
    "IsForbidNameSkin", "IsForbidNameColor", "IsForbidRoomBorder",
    "IsForbidDragonCrystal", "IsForbidStatue"
  ];

  let systemDataClass = findClassPtr("SystemData");
  if (!systemDataClass) return;

  let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
  let methodPtr;

  while (!(methodPtr = il2cpp.class_get_methods(systemDataClass, iter)).isNull()) {
    const name = il2cpp.method_get_name(methodPtr).readUtf8String();
    if (targetMethods.includes(name)) {
      const impl = methodPtr.readPointer();
      if (!impl.isNull()) {
        Interceptor.attach(impl, {
          onLeave: function(retval) {
            if (MOD_CONFIG.UnreleasedEnabled) retval.replace(ptr(0));
          }
        });
      }
    }
  }
  console.log("[+] Modul Unreleased Features dimuat.");
}

// ==========================================
// 2. DYNAMIC UNLOCK ALL KOSMETIK
// ==========================================
function hookUnlockAll() {
  let systemDataClass = findClassPtr("SystemData");
  if (!systemDataClass) return;

  // Kata kunci fitur yang ingin kita tembus
  const unlockKeywords = ["Skin", "Statue", "Paint", "Action", "Effect", "Frame", "Emote", "Chat", "Avatar"];

  let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
  let methodPtr;
  let hookedCount = 0;

  while (!(methodPtr = il2cpp.class_get_methods(systemDataClass, iter)).isNull()) {
    const name = il2cpp.method_get_name(methodPtr).readUtf8String();
    const impl = methodPtr.readPointer();
    if (impl.isNull()) continue;

    // A. HOOK RETURN TRUE (Untuk fungsi seperti IsCanUseSkin, IsHaveAction, dsb)
    if (name.startsWith("IsCanUse") || name.startsWith("CheckReputation") || name === "IsHeroInShop" || name === "GetLeaderSkinBForbid") {
      Interceptor.attach(impl, {
        onLeave: function(retval) {
          if (MOD_CONFIG.UnlockAllEnabled) retval.replace(ptr(1)); // Return True
        }
      });
      continue;
    }

    // B. HOOK RETURN OBJECT (Untuk fungsi IsHaveSkin, IsHaveStatue, GetMapPaint, dsb)
    if (name.startsWith("IsHave") || name.startsWith("Get")) {
      // Cek apakah namanya mengandung target kosmetik kita
      if (unlockKeywords.some(keyword => name.includes(keyword))) {

        // Ambil Tipe Class yang dikembalikan fungsi ini secara dinamis (misal CmdHeroStatue)
        const returnTypePtr = il2cpp.method_get_return_type(methodPtr);
        const returnClassPtr = il2cpp.class_from_type(returnTypePtr);

        // Pastikan fungsi ini memang mengembalikan sebuah Class/Object
        if (!returnClassPtr.isNull()) {
          try {
            Interceptor.attach(impl, {
              onEnter: function(args) {
                // Args[0] adalah "this" (instance), Args[1] biasanya ID item
                try { this.reqId = args[1].toInt32(); }
                catch (e) { this.reqId = 0; }
              },
              onLeave: function(retval) {
                // Jika game bilang kita tidak punya itemnya (null) dan kita merequest ID valid
                if (MOD_CONFIG.UnlockAllEnabled && retval.isNull() && this.reqId > 0) {

                  // Buat instance class palsu sesuai dengan tipe yang diminta game!
                  let newInst = il2cpp.object_new(returnClassPtr);

                  if (!newInst.isNull()) {
                    // Offset 0x10 adalah letak iId di memori Unity C# (Turunan Il2CppObject)
                    // Sisanya seperti iLimitTime otomatis 0 = Permanen
                    newInst.add(0x10).writeU32(this.reqId);
                    retval.replace(newInst);
                  }
                }
              }
            });
            hookedCount++;
          } catch (e) { }
        }
      }
    }
  }
  console.log(`[+] Modul Unlock All dimuat (Ter-hook ${hookedCount} fungsi data Item).`);

  // ==========================================
  // 3. ANTI-BAN SERVER (SendRawData REPLACE)
  // ==========================================
  let gameServerConfigClass = findClassPtr("GameServerConfig");
  if (gameServerConfigClass) {
    let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
    let methodPtr;
    while (!(methodPtr = il2cpp.class_get_methods(gameServerConfigClass, iter)).isNull()) {
      if (il2cpp.method_get_name(methodPtr).readUtf8String() === "SendRawData") {
        const impl = methodPtr.readPointer();
        if (!impl.isNull()) {
          const blockedMsgs = [1015, 1016, 1019, 1020, 1031, 1032, 1035, 1036, 1160, 1161, 1162, 1163, 1208, 10017, 10018, 10192, 10193, 10603, 10604, 19457, 19458, 19459, 19460];
          let origSendRawData = new NativeFunction(impl, 'void', ['pointer', 'uint32', 'pointer', 'int', 'int', 'int', 'bool', 'int']);

          Interceptor.replace(impl, new NativeCallback(function(instance, msgId, data, size, socketType, packType, lock, expSize) {
            if (MOD_CONFIG.UnlockAllEnabled && blockedMsgs.includes(msgId)) return; // Block
            origSendRawData(instance, msgId, data, size, socketType, packType, lock, expSize);
          }, 'void', ['pointer', 'uint32', 'pointer', 'int', 'int', 'int', 'bool', 'int']));
        }
        break;
      }
    }
  }
}

// --- Main Execution ---
const check = setInterval(() => {
  const mod = Process.findModuleByName("liblogic.so") || Process.findModuleByName("libil2cpp.so");
  if (mod) {
    clearInterval(check);
    initIl2cpp(mod.name);

    console.log("\n[+] Menerapkan Hooks Kosmetik...");
    hookUnreleasedFeatures();
    hookUnlockAll();

    console.log(`\n[+] Status Mod Saat Ini:`);
    console.log(`    - Unreleased Features : ${MOD_CONFIG.UnreleasedEnabled ? "NYALA (ON)" : "MATI (OFF)"}`);
    console.log(`    - Unlock ALL Cosmetic : ${MOD_CONFIG.UnlockAllEnabled ? "NYALA (ON)" : "MATI (OFF)"}\n`);
  }
}, 1000);
