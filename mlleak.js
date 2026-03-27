/**
 * MLBB UNLOCK SKIN & UNRELEASED FEATURES HOOK
 */

// ==========================================
// KONTROL FITUR (SAKELAR / TOGGLE)
// Ubah menjadi 'false' untuk mematikan fitur
// ==========================================
const MOD_CONFIG = {
  UnreleasedEnabled: true,  // Toggle Unreleased Heroes & Skins
  UnlockSkinEnabled: true   // Toggle Unlock All Skin & Anti-Ban
};

let il2cpp = null;
let cmdHeroSkinClassPtr = null;

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
    object_new: n("il2cpp_object_new", 'pointer', ['pointer']) // Penting untuk membuat CmdHeroSkin
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
// 1. HOOK UNRELEASED HEROES & SKINS
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
            // CEK SAKELAR: Jika menyala, paksa kembalikan false (0)
            if (MOD_CONFIG.UnreleasedEnabled) {
              retval.replace(ptr(0));
            }
          }
        });
      }
    }
  }
  console.log("[+] Modul Unreleased Features dimuat.");
}

// ==========================================
// 2. HOOK UNLOCK ALL SKINS & ANTI-BAN
// ==========================================
function hookUnlockSkin() {
  cmdHeroSkinClassPtr = findClassPtr("CmdHeroSkin");

  const returnTrueMethods = [
    "IsCanUseSkin", "GetLeaderSkinBForbid", "CheckReputationUnlockSkin",
    "IsLimitActiveHero", "IsHeroInShop"
  ];

  // Target Class: SystemData
  let systemDataClass = findClassPtr("SystemData");
  if (systemDataClass) {
    let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
    let methodPtr;
    while (!(methodPtr = il2cpp.class_get_methods(systemDataClass, iter)).isNull()) {
      const name = il2cpp.method_get_name(methodPtr).readUtf8String();
      const impl = methodPtr.readPointer();
      if (impl.isNull()) continue;

      // Hook fungsi yang butuh return TRUE (1)
      if (returnTrueMethods.includes(name)) {
        Interceptor.attach(impl, {
          onLeave: function(retval) {
            if (MOD_CONFIG.UnlockSkinEnabled) retval.replace(ptr(1));
          }
        });
      }

      // Hook Objek Kepemilikan Skin (IsHaveSkin / IsHaveSkinForever)
      if (name === "IsHaveSkin" || name === "IsHaveSkinForever") {
        Interceptor.attach(impl, {
          onEnter: function(args) { this.skinId = args[1].toInt32(); },
          onLeave: function(retval) {
            if (MOD_CONFIG.UnlockSkinEnabled && retval.isNull() && cmdHeroSkinClassPtr) {
              let newInst = il2cpp.object_new(cmdHeroSkinClassPtr);
              newInst.add(0x10).writeU32(this.skinId); // Offset 0x10 = iId
              retval.replace(newInst);
            }
          }
        });
      }

      // Hook GetHeroSkin
      if (name === "GetHeroSkin") {
        Interceptor.attach(impl, {
          onEnter: function(args) { this.skinId = args[2].toInt32(); },
          onLeave: function(retval) {
            if (MOD_CONFIG.UnlockSkinEnabled && retval.isNull() && cmdHeroSkinClassPtr) {
              let newInst = il2cpp.object_new(cmdHeroSkinClassPtr);
              newInst.add(0x10).writeU32(this.skinId); // Offset 0x10 = iId
              retval.replace(newInst);
            }
          }
        });
      }
    }
  }

  // Target Class: UIRankHero
  let uiRankHeroClass = findClassPtr("UIRankHero");
  if (uiRankHeroClass) {
    let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
    let methodPtr;
    while (!(methodPtr = il2cpp.class_get_methods(uiRankHeroClass, iter)).isNull()) {
      if (il2cpp.method_get_name(methodPtr).readUtf8String() === "BRankHeroCanUse") {
        Interceptor.attach(methodPtr.readPointer(), {
          onLeave: function(retval) {
            if (MOD_CONFIG.UnlockSkinEnabled) retval.replace(ptr(1));
          }
        });
        break;
      }
    }
  }

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

          // Kita gunakan NativeCallback untuk me-replace fungsi asli sepenuhnya
          let origSendRawData = new NativeFunction(impl, 'void', ['pointer', 'uint32', 'pointer', 'int', 'int', 'int', 'bool', 'int']);

          Interceptor.replace(impl, new NativeCallback(function(instance, msgId, data, size, socketType, packType, lock, expSize) {
            if (MOD_CONFIG.UnlockSkinEnabled && blockedMsgs.includes(msgId)) {
              // Jika menyala dan termasuk pesan terlarang, jangan lakukan apapun (Block to server)
              return;
            }
            // Lanjutkan ke fungsi asli
            origSendRawData(instance, msgId, data, size, socketType, packType, lock, expSize);
          }, 'void', ['pointer', 'uint32', 'pointer', 'int', 'int', 'int', 'bool', 'int']));
        }
        break;
      }
    }
  }
  console.log("[+] Modul Unlock Skin & Anti-Ban dimuat.");
}

// --- Main Execution ---
const check = setInterval(() => {
  const mod = Process.findModuleByName("liblogic.so") || Process.findModuleByName("libil2cpp.so");
  if (mod) {
    clearInterval(check);
    initIl2cpp(mod.name);

    console.log("\n[+] Menerapkan Hooks...");
    hookUnreleasedFeatures();
    hookUnlockSkin();

    console.log(`[+] Status Saat Ini:`);
    console.log(`    - Unreleased Features : ${MOD_CONFIG.UnreleasedEnabled ? "NYALA (ON)" : "MATI (OFF)"}`);
    console.log(`    - Unlock Skin         : ${MOD_CONFIG.UnlockSkinEnabled ? "NYALA (ON)" : "MATI (OFF)"}\n`);
  }
}, 1000);
