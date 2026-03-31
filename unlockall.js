/**
 * MLBB UNLOCK ALL - MODULAR & FLEXIBLE ARCHITECTURE
 */

const MOD_CONFIG = {
  UnreleasedEnabled: true,
  UnlockAllEnabled: true,
  AntiBanEnabled: true
};

// ==========================================
// 1. CORE ENGINE (IL2CPP BRIDGE)
// ==========================================
let il2cpp = null;
const classCache = {};
const methodCache = {};

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

function findClassPtr(className) {
  if (classCache[className]) return classCache[className];

  const domain = il2cpp.domain_get();
  let size = Memory.alloc(8);
  const assemblies = il2cpp.domain_get_assemblies(domain, size);

  for (let i = 0; i < size.readUInt(); i++) {
    const img = il2cpp.assembly_get_image(assemblies.add(i * Process.pointerSize).readPointer());
    for (let j = 0; j < il2cpp.image_get_class_count(img); j++) {
      const klass = il2cpp.image_get_class(img, j);
      if (!klass.isNull() && il2cpp.class_get_name(klass).readUtf8String() === className) {
        classCache[className] = klass;
        return klass;
      }
    }
  }
  console.warn(`[-] Class not found: ${className}`);
  return null;
}

function findMethodPtr(className, methodName) {
  const cacheKey = `${className}::${methodName}`;
  if (methodCache[cacheKey]) return methodCache[cacheKey];

  const klass = findClassPtr(className);
  if (!klass) return null;

  let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
  let methodPtr;
  while (!(methodPtr = il2cpp.class_get_methods(klass, iter)).isNull()) {
    const name = il2cpp.method_get_name(methodPtr).readUtf8String();
    if (name === methodName) {
      const impl = methodPtr.readPointer();
      if (!impl.isNull()) {
        methodCache[cacheKey] = impl;
        return impl;
      }
    }
  }
  console.warn(`[-] Method not found: ${cacheKey}`);
  return null;
}


// ==========================================
// 2. HOOK UTILITIES (HELPER)
// ==========================================

const HookApi = {
  /**
   * Memaksa method mengembalikan nilai tertentu (true/false/angka/pointer)
   */
  forceReturn: function(className, methodName, returnValue, conditionStr = "UnlockAllEnabled") {
    const methodPtr = findMethodPtr(className, methodName);
    if (!methodPtr) return;

    Interceptor.attach(methodPtr, {
      onLeave: function(retval) {
        // Cek apakah fitur dihidupkan di config
        if (MOD_CONFIG[conditionStr]) {
          // Jika returnValue adalah boolean (true/false), ubah ke 1/0
          let finalVal = typeof returnValue === "boolean" ? (returnValue ? 1 : 0) : returnValue;
          retval.replace(ptr(finalVal));
        }
      }
    });
    console.log(`[+] Hooked: ${className}::${methodName} -> Forcing Return: ${returnValue}`);
  },

  /**
   * Custom hook untuk logika yang lebih kompleks (seperti instansiasi objek)
   */
  custom: function(className, methodName, onEnterCb, onLeaveCb) {
    const methodPtr = findMethodPtr(className, methodName);
    if (!methodPtr) return;

    Interceptor.attach(methodPtr, {
      onEnter: onEnterCb || function(args) { },
      onLeave: onLeaveCb || function(retval) { }
    });
    console.log(`[+] Custom Hooked: ${className}::${methodName}`);
  }
};


// ==========================================
// 3. CONFIGURATION (ATURAN HOOK)
// ==========================================
// Di sinilah fleksibilitasnya. Jika kamu butuh bypass fungsi baru,
// cukup tambahkan di array ini tanpa menyentuh logika engine di atas.

const SIMPLE_HOOK_RULES = [
  // --- Unreleased Features (Bypass = False/0) ---
  { class: "SystemData", method: "IsForbidSkin", return: false, config: "UnreleasedEnabled" },
  { class: "SystemData", method: "IsForbidHeros", return: false, config: "UnreleasedEnabled" },
  { class: "SystemData", method: "IsForbidARSkin", return: false, config: "UnreleasedEnabled" },
  { class: "SystemData", method: "IsForbidARHeros", return: false, config: "UnreleasedEnabled" },
  { class: "SystemData", method: "IsForbidHeroInChooseHero", return: false, config: "UnreleasedEnabled" },
  { class: "SystemData", method: "IsForbidStatue", return: false, config: "UnreleasedEnabled" },

  // --- Unlock All Cosmetics (Bypass = True/1) ---
  { class: "SystemData", method: "IsCanUseSkin", return: true, config: "UnlockAllEnabled" },
  { class: "SystemData", method: "CheckReputationUnlockSkin", return: true, config: "UnlockAllEnabled" },
  { class: "SystemData", method: "IsHaveRecallEffect", return: true, config: "UnlockAllEnabled" },
  { class: "SystemData", method: "IsHaveKillEffect", return: true, config: "UnlockAllEnabled" },
  { class: "SystemData", method: "IsHaveSpawnEffect", return: true, config: "UnlockAllEnabled" },
  { class: "SystemData", method: "IsHaveNotifyEffect", return: true, config: "UnlockAllEnabled" },
  { class: "SystemData", method: "IsHaveBattleEmote", return: true, config: "UnlockAllEnabled" },
  { class: "SystemData", method: "IsHaveAction", return: true, config: "UnlockAllEnabled" },

  // --- Bypass UI Selection ---
  { class: "UIRankHero", method: "BRankHeroCanUse", return: true, config: "UnlockAllEnabled" },
  { class: "UIChooseHero", method: "CanSelectSkin", return: true, config: "UnlockAllEnabled" },
  { class: "ChooseHeroMgr", method: "IsSkinUseable", return: true, config: "UnlockAllEnabled" }
];


// ==========================================
// 4. MAIN INJECTION LOGIC
// ==========================================

// Global state untuk battle sync
let BATTLE_STATE = { m_SkinID: 0, m_HeroID: 0 };

function applySimpleHooks() {
  SIMPLE_HOOK_RULES.forEach(rule => {
    HookApi.forceReturn(rule.class, rule.method, rule.return, rule.config);
  });
}

function applyComplexObjectHooks() {
  // Logika untuk CmdHeroSkin (Membuat objek baru jika kosong)
  const skinMethods = ["IsHaveSkin", "IsHaveSkinForever", "GetMCLimitSkin", "GetHeroSkin"];

  skinMethods.forEach(methodName => {
    HookApi.custom("SystemData", methodName,
      function(args) { // onEnter
        try { this.reqId = methodName.includes("GetHero") ? args[2].toInt32() : args[1].toInt32(); }
        catch (e) { this.reqId = 0; }
      },
      function(retval) { // onLeave
        if (MOD_CONFIG.UnlockAllEnabled && retval.isNull() && this.reqId > 0) {
          let skinClassPtr = findClassPtr("CmdHeroSkin");
          if (skinClassPtr) {
            let skinInst = il2cpp.object_new(skinClassPtr);
            if (!skinInst.isNull()) {
              skinInst.add(0x10).writeU32(this.reqId);
              skinInst.add(0x14).writeU32(0);
              skinInst.add(0x18).writeU32(0);
              retval.replace(skinInst);
            }
          }
        }
      }
    );
  });
}

function hookAntiBan() {
  HookApi.custom("GameServerConfig", "SendRawData", function(args) { }, function(retval) { });

  // Karena SendRawData butuh penggantian implementasi (Interceptor.replace),
  // kita handle secara khusus di luar HookApi standar.
  const methodPtrBan = findMethodPtr("GameServerConfig", "SendRawData");
  if (methodPtrBan && MOD_CONFIG.AntiBanEnabled) {
    const blockedMsgs = [1015, 1016, 1019, 1020, 1031, 1032, 1035, 1036, 1160]; // Disingkat untuk contoh
    let origSendRawData = new NativeFunction(methodPtrBan, 'void', ['pointer', 'uint32', 'pointer', 'int', 'int', 'int', 'bool', 'int']);

    Interceptor.replace(methodPtrBan, new NativeCallback(function(instance, msgId, data, size, socketType, packType, lock, expSize) {
      if (blockedMsgs.includes(msgId)) {
        console.log(`[!] Blocked Anti-Ban Packet: ${msgId}`);
        return;
      }
      origSendRawData(instance, msgId, data, size, socketType, packType, lock, expSize);
    }, 'void', ['pointer', 'uint32', 'pointer', 'int', 'int', 'int', 'bool', 'int']));
    console.log("[+] Anti-Ban Hooked.");
  }
}

// --- INITIALIZATION LOOP ---
const check = setInterval(() => {
  const mod = Process.findModuleByName("liblogic.so") || Process.findModuleByName("libil2cpp.so");
  if (mod) {
    clearInterval(check);
    initIl2cpp(mod.name);

    console.log("\n--- Applying Hooks ---");
    applySimpleHooks();          // Menerapkan semua bypass boolean (true/false)
    applyComplexObjectHooks();   // Menerapkan logika pembuatan objek CmdSkin/CmdStatue
    hookAntiBan();               // Menerapkan bypass anti-ban server

    console.log("\n[!] ALL MODULES INJECTED SUCCESSFULLY.");
  }
}, 1000);
