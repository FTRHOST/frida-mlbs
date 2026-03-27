/**
 * MLBB UNLOCK ALL KOSMETIK & UNRELEASED HEROES
 * (VERSI STABIL - ANTI STUCK / FREEZE + SERVER SPOOFER)
 */

const MOD_CONFIG = {
  UnreleasedEnabled: true,
  UnlockAllEnabled: true
};

let il2cpp = null;
let classCache = {}; // Cache untuk menyimpan pointer class agar tidak lag saat mencari
let spoofedSkins = new Set(); // Cache untuk melacak ID skin yang TIDAK dimiliki (hasil spoof)

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
  if (classCache[name]) return classCache[name];

  const domain = il2cpp.domain_get();
  let size = Memory.alloc(8);
  const assemblies = il2cpp.domain_get_assemblies(domain, size);
  for (let i = 0; i < size.readUInt(); i++) {
    const img = il2cpp.assembly_get_image(assemblies.add(i * Process.pointerSize).readPointer());
    for (let j = 0; j < il2cpp.image_get_class_count(img); j++) {
      const klass = il2cpp.image_get_class(img, j);
      if (!klass.isNull() && il2cpp.class_get_name(klass).readUtf8String() === name) {
        classCache[name] = klass;
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

  const objectHooks = {
    "IsHaveSkin": "CmdHeroSkin",
    "IsHaveSkinForever": "CmdHeroSkin",
    "GetHeroSkin": "CmdHeroSkin",
    "IsHaveStatue": "CmdHeroStatue",
    "GetHeroStatue": "CmdHeroStatue"
  };

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

    // 1. Hook Boolean
    if (booleanHooks.includes(name)) {
      Interceptor.attach(impl, {
        onEnter: function(args) {
          try { this.reqId = args[1].toInt32(); } catch (e) { this.reqId = 0; }
        },
        onLeave: function(retval) {
          if (MOD_CONFIG.UnlockAllEnabled && retval.toInt32() === 0) {
            if (this.reqId > 0) spoofedSkins.add(this.reqId); // Lacak ID yang tidak dimiliki
            retval.replace(ptr(1));
          }
        }
      });
    }

    // 2. Hook Object (Skin & Statue)
    if (objectHooks[name]) {
      const targetClassName = objectHooks[name];

      Interceptor.attach(impl, {
        onEnter: function(args) {
          try {
            this.reqId = (name === "GetHeroSkin") ? args[2].toInt32() : args[1].toInt32();
          } catch (e) {
            this.reqId = 0;
          }
        },
        onLeave: function(retval) {
          if (MOD_CONFIG.UnlockAllEnabled && retval.isNull() && this.reqId > 0) {
            // [!] SIMPAN ID SKIN YANG ASLINYA TIDAK DIMILIKI KE CACHE
            spoofedSkins.add(this.reqId);

            let targetClassPtr = findClassPtr(targetClassName);
            if (targetClassPtr) {
              let newInst = il2cpp.object_new(targetClassPtr);
              if (!newInst.isNull()) {
                newInst.add(0x10).writeU32(this.reqId);
                retval.replace(newInst);
              }
            }
          }
        }
      });
    }
  }

  // C. UIRankHero (BRankHeroCanUse)
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
}

// ==========================================
// 3. UI CHOOSE HERO SERVER SPOOFER (ANTI-BAN)
// ==========================================
function hookChooseHeroServer() {
  // Semua subclass yang bertanggung jawab untuk UI pemilihan hero (Classic, Rank, Brawl, dsb)
  const chooseHeroClasses = [
    "ChooseHeroComp",
    "UIChooseHeroRankComp",
    "UIChooseHeroMatchComp",
    "UIChooseHeroTrainComp",
    "UIChooseHeroUserDefineComp",
    "UIChooseHeroBrawlComp"
  ];

  chooseHeroClasses.forEach(className => {
    let klass = findClassPtr(className);
    if (!klass) return;

    let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
    let methodPtr;
    while (!(methodPtr = il2cpp.class_get_methods(klass, iter)).isNull()) {
      if (il2cpp.method_get_name(methodPtr).readUtf8String() === "GetSendSkinid") {
        const impl = methodPtr.readPointer();
        if (!impl.isNull()) {
          Interceptor.attach(impl, {
            onLeave: function(retval) {
              const skinId = retval.toInt32();
              // Cek apakah skin yang akan dikirim ke server adalah skin palsu (tidak dimiliki)?
              if (MOD_CONFIG.UnlockAllEnabled && spoofedSkins.has(skinId)) {
                // Paksa ID yang dikirim menjadi 0 (Default Skin)
                retval.replace(ptr(0));
              }
            }
          });
        }
        break;
      }
    }
  });

  console.log("[+] Modul ChooseHero Server Spoofer Aktif (Aman dari Server).");
}

// --- Main Execution ---
const check = setInterval(() => {
  const mod = Process.findModuleByName("liblogic.so") || Process.findModuleByName("libil2cpp.so");
  if (mod) {
    clearInterval(check);
    initIl2cpp(mod.name);

    hookUnreleasedFeatures();
    hookUnlockAll();
    hookChooseHeroServer(); // <-- Inject Server Spoofer di sini
  }
}, 1000);
