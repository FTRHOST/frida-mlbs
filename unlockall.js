/**
 * MLBB UNLOCK ALL KOSMETIK & UNRELEASED HEROES
 * (VERSI STABIL - ANTI STUCK / FREEZE)
 */

const MOD_CONFIG = {
  UnreleasedEnabled: true,
  UnlockAllEnabled: true
};

let il2cpp = null;
let classCache = {}; // Cache untuk menyimpan pointer class agar tidak lag saat mencari

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
    object_new: n("il2cpp_object_new", 'pointer', ['pointer'])
  };
  console.log("[+] API IL2CPP Initialized.");
}

function findClassPtr(name) {
  if (classCache[name]) return classCache[name]; // Ambil dari cache jika ada

  const domain = il2cpp.domain_get();
  let size = Memory.alloc(8);
  const assemblies = il2cpp.domain_get_assemblies(domain, size);
  for (let i = 0; i < size.readUInt(); i++) {
    const img = il2cpp.assembly_get_image(assemblies.add(i * Process.pointerSize).readPointer());
    for (let j = 0; j < il2cpp.image_get_class_count(img); j++) {
      const klass = il2cpp.image_get_class(img, j);
      if (!klass.isNull() && il2cpp.class_get_name(klass).readUtf8String() === name) {
        classCache[name] = klass; // Simpan ke cache
        return klass;
      }
    }
  }
  return null;
}

// ==========================================
// 1. HOOK UNRELEASED HEROES & SKINS
// ==========================================
function hookUnreleasedFeatures() {
  const unreleasedMethods = [
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
    if (unreleasedMethods.includes(name)) {
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
  console.log("[+] Modul Unreleased Features Aktif.");
}

// ==========================================
// 2. UNLOCK ALL KOSMETIK (STABIL & AMAN)
// ==========================================
function hookUnlockAll() {
  let systemDataClass = findClassPtr("SystemData");
  if (!systemDataClass) return;

  // A. Daftar Fungsi yang butuh DUMMY OBJECT (Skin & Statue)
  const objectHooks = {
    "IsHaveSkin": "CmdHeroSkin",
    "IsHaveSkinForever": "CmdHeroSkin",
    "GetHeroSkin": "CmdHeroSkin",
    "IsHaveStatue": "CmdHeroStatue",
    "GetHeroStatue": "CmdHeroStatue"
  };

  // B. Daftar Fungsi yang butuh nilai TRUE (Boolean: Recall, Emote, dll)
  const booleanHooks = [
    "IsCanUseSkin", "GetLeaderSkinBForbid", "CheckReputationUnlockSkin",
    "IsLimitActiveHero", "IsHeroInShop", "IsHaveRecallEffect",
    "IsHaveKillEffect", "IsHaveSpawnEffect", "IsHaveNotifyEffect",
    "IsHaveBattleEmote", "IsHaveAction", "IsHaveHeadFrame",
    "IsHaveRoomBorder", "IsHaveMapPaint", "IsHaveBgm"
  ];

  let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
  let methodPtr;

  while (!(methodPtr = il2cpp.class_get_methods(systemDataClass, iter)).isNull()) {
    const name = il2cpp.method_get_name(methodPtr).readUtf8String();
    const impl = methodPtr.readPointer();
    if (impl.isNull()) continue;

    // 1. Eksekusi Hook untuk fungsi tipe BOOLEAN
    if (booleanHooks.includes(name)) {
      Interceptor.attach(impl, {
        onLeave: function(retval) {
          if (MOD_CONFIG.UnlockAllEnabled && retval.toInt32() === 0) {
            retval.replace(ptr(1)); // Paksa jadi True (1)
          }
        }
      });
    }

    // 2. Eksekusi Hook untuk fungsi tipe OBJECT (SKIN & STATUE)
    if (objectHooks[name]) {
      const targetClassName = objectHooks[name];

      Interceptor.attach(impl, {
        onEnter: function(args) {
          // Argument ke-2 (args[1]) atau ke-3 (args[2]) biasanya adalah ID Item
          // Karena fungsi IsHave biasanya `IsHaveSkin(this, id)`, ID ada di args[1]
          // Untuk GetHeroSkin(this, something, id), ID ada di args[2]
          try {
            this.reqId = (name === "GetHeroSkin") ? args[2].toInt32() : args[1].toInt32();
          } catch (e) {
            this.reqId = 0;
          }
        },
        onLeave: function(retval) {
          if (MOD_CONFIG.UnlockAllEnabled && retval.isNull() && this.reqId > 0) {
            // Cari pointer class-nya (misal: CmdHeroSkin)
            let targetClassPtr = findClassPtr(targetClassName);
            if (targetClassPtr) {
              // Buat instance palsu di memori game
              let newInst = il2cpp.object_new(targetClassPtr);
              if (!newInst.isNull()) {
                // Tulis ID skin/statue ke offset 0x10 (iId)
                newInst.add(0x10).writeU32(this.reqId);
                retval.replace(newInst);
              }
            }
          }
        }
      });
    }
  }

  // C. Tambahan Khusus untuk UIRankHero (BRankHeroCanUse)
  let uiRankHeroClass = findClassPtr("UIRankHero");
  if (uiRankHeroClass) {
    let iterRank = Memory.alloc(Process.pointerSize).writePointer(NULL);
    let methodPtrRank;
    while (!(methodPtrRank = il2cpp.class_get_methods(uiRankHeroClass, iterRank)).isNull()) {
      if (il2cpp.method_get_name(methodPtrRank).readUtf8String() === "BRankHeroCanUse") {
        Interceptor.attach(methodPtrRank.readPointer(), {
          onLeave: function(retval) {
            if (MOD_CONFIG.UnlockAllEnabled) retval.replace(ptr(1));
          }
        });
        break;
      }
    }
  }

  console.log("[+] Modul Unlock All Kosmetik Aktif.");

  // ==========================================
  // 3. ANTI-BAN SERVER (SendRawData REPLACE)
  // ==========================================
  let gameServerConfigClass = findClassPtr("GameServerConfig");
  if (gameServerConfigClass) {
    let iterBan = Memory.alloc(Process.pointerSize).writePointer(NULL);
    let methodPtrBan;
    while (!(methodPtrBan = il2cpp.class_get_methods(gameServerConfigClass, iterBan)).isNull()) {
      if (il2cpp.method_get_name(methodPtrBan).readUtf8String() === "SendRawData") {
        const impl = methodPtrBan.readPointer();
        if (!impl.isNull()) {
          const blockedMsgs = [1015, 1016, 1019, 1020, 1031, 1032, 1035, 1036, 1160, 1161, 1162, 1163, 1208, 10017, 10018, 10192, 10193, 10603, 10604, 19457, 19458, 19459, 19460];
          let origSendRawData = new NativeFunction(impl, 'void', ['pointer', 'uint32', 'pointer', 'int', 'int', 'int', 'bool', 'int']);

          Interceptor.replace(impl, new NativeCallback(function(instance, msgId, data, size, socketType, packType, lock, expSize) {
            if (MOD_CONFIG.UnlockAllEnabled && blockedMsgs.includes(msgId)) return;
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

    hookUnreleasedFeatures();
    hookUnlockAll();
  }
}, 1000);
