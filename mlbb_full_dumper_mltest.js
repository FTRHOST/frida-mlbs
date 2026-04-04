/**
 * MLBB Full Il2Cpp Dumper (Modified with Data Types, Value Extraction, & Address Formatting)
 */

function dumpAll() {
  // --- KONFIGURASI MODE ---
  // 1 = Normal Dump (Hanya Nama, Offset, dan Tipe Data)
  // 2 = Value Dump (Sama seperti Normal, ditambah mengekstrak nilai dari Static Fields ke file terpisah)
  const CURRENT_MODE = 2;

  // --- KONFIGURASI TAMPILAN ALAMAT ---
  // Format Address untuk Method
  // "RVA"      = Relative Virtual Address (Base module dikurangi pointer, ideal untuk IDA Pro / Ghidra)
  // "ABSOLUTE" = Absolute Memory Address (Alamat asli di memory saat runtime)
  // "NONE"     = Sembunyikan alamat method
  const METHOD_ADDRESS_FORMAT = "NONE";

  // Format Offset untuk Field
  // true  = Tampilkan offset field (misal: 0x10)
  // false = Sembunyikan offset field
  const SHOW_FIELD_OFFSET = false;
  // ------------------------

  const libName = Process.findModuleByName("liblogic.so") ? "liblogic.so" : "libil2cpp.so";
  console.log("[*] Memulai Dump pada: " + libName);
  console.log(`[*] Mode Aktif: ${CURRENT_MODE === 1 ? "NORMAL DUMP" : "VALUE DUMP"}`);
  console.log(`[*] Method Address Mode: ${METHOD_ADDRESS_FORMAT}`);

  const lib = Process.getModuleByName(libName);
  const base = lib.base;

  function n(name, ret, args) {
    const addr = lib.findExportByName(name);
    return addr ? new NativeFunction(addr, ret, args) : null;
  }

  // Menambahkan fungsi tambahan untuk mengekstrak nilai dan tipe
  const il2cpp = {
    domain_get: n("il2cpp_domain_get", 'pointer', []),
    domain_get_assemblies: n("il2cpp_domain_get_assemblies", 'pointer', ['pointer', 'pointer']),
    assembly_get_image: n("il2cpp_assembly_get_image", 'pointer', ['pointer']),
    image_get_name: n("il2cpp_image_get_name", 'pointer', ['pointer']),
    image_get_class_count: n("il2cpp_image_get_class_count", 'uint64', ['pointer']),
    image_get_class: n("il2cpp_image_get_class", 'pointer', ['pointer', 'uint64']),
    class_get_name: n("il2cpp_class_get_name", 'pointer', ['pointer']),
    class_get_namespace: n("il2cpp_class_get_namespace", 'pointer', ['pointer']),
    class_get_fields: n("il2cpp_class_get_fields", 'pointer', ['pointer', 'pointer']),
    field_get_name: n("il2cpp_field_get_name", 'pointer', ['pointer']),
    field_get_offset: n("il2cpp_field_get_offset", 'uint32', ['pointer']),
    field_get_type: n("il2cpp_field_get_type", 'pointer', ['pointer']),
    field_get_flags: n("il2cpp_field_get_flags", 'int', ['pointer']),
    class_get_static_field_data: n("il2cpp_class_get_static_field_data", 'pointer', ['pointer']),
    class_get_methods: n("il2cpp_class_get_methods", 'pointer', ['pointer', 'pointer']),
    method_get_name: n("il2cpp_method_get_name", 'pointer', ['pointer']),
    method_get_return_type: n("il2cpp_method_get_return_type", 'pointer', ['pointer']),
    type_get_name: n("il2cpp_type_get_name", 'pointer', ['pointer']),
    method_get_param_count: n("il2cpp_method_get_param_count", 'uint32', ['pointer']),
    method_get_param: n("il2cpp_method_get_param", 'pointer', ['pointer', 'uint32']),
    method_get_param_name: n("il2cpp_method_get_param_name", 'pointer', ['pointer', 'uint32'])
  };

  const outPath = "/storage/emulated/0/Android/data/com.mobilelegends.taptest/files/dump.cs";
  const valueOutPath = "/storage/emulated/0/Android/data/com.mobilelegends.taptest/files/values_dump.txt";

  const file = new File(outPath, "w");
  let valueFile = null;

  if (CURRENT_MODE === 2) {
    valueFile = new File(valueOutPath, "w");
    valueFile.write(`// Static Values Dumped from ${libName}\n\n`);
  }

  console.log("[*] Mencari Assembly-CSharp...");
  const domain = il2cpp.domain_get();
  const out_size = Memory.alloc(8);
  const assemblies = il2cpp.domain_get_assemblies(domain, out_size);
  const count = parseInt(out_size.readPointer().toString());

  for (let i = 0; i < count; i++) {
    const assembly = assemblies.add(i * Process.pointerSize).readPointer();
    const img = il2cpp.assembly_get_image(assembly);
    const imgName = il2cpp.image_get_name(img).readCString();

    if (imgName === "Assembly-CSharp.dll") {
      const classCount = Number(il2cpp.image_get_class_count(img));
      console.log(`[V] Dumping ${classCount} kelas ke ${outPath}...`);
      file.write(`// Dumped from ${libName} at ${new Date().toISOString()}\n\n`);

      for (let j = 0; j < classCount; j++) {
        const klass = il2cpp.image_get_class(img, j);
        const name = il2cpp.class_get_name(klass).readCString();
        const ns = il2cpp.class_get_namespace(klass).readCString();

        file.write(`// Namespace: ${ns}\nclass ${name} {\n`);

        // --- DUMP FIELDS & DATA TYPES ---
        const iterField = Memory.alloc(Process.pointerSize).writePointer(NULL);
        let field;
        while (!(field = il2cpp.class_get_fields(klass, iterField)).isNull()) {
          const fName = il2cpp.field_get_name(field).readCString();
          const fOffset = il2cpp.field_get_offset(field);

          const fTypePtr = il2cpp.field_get_type(field);
          const fTypeName = il2cpp.type_get_name(fTypePtr).readCString();

          const flags = il2cpp.field_get_flags(field);
          const isStatic = (flags & 0x0010) !== 0;
          const modifier = isStatic ? "static " : "";

          // Terapkan opsi Format Offset Field
          const offsetStr = SHOW_FIELD_OFFSET ? `0x${fOffset.toString(16)} : ` : "";

          file.write(`  [Field] ${offsetStr}${modifier}${fTypeName} ${fName}\n`);

          // --- EKSTRAKSI VALUE ---
          if (CURRENT_MODE === 2 && isStatic && valueFile !== null) {
            try {
              const staticDataPtr = il2cpp.class_get_static_field_data(klass);
              if (!staticDataPtr.isNull()) {
                const valuePtr = staticDataPtr.add(fOffset);
                let extractedValue = "Unknown/Struct";

                if (fTypeName === "System.Int32" || fTypeName === "int") {
                  extractedValue = valuePtr.readS32();
                } else if (fTypeName === "System.Boolean" || fTypeName === "bool") {
                  extractedValue = valuePtr.readU8() === 1 ? "true" : "false";
                } else if (fTypeName === "System.Single" || fTypeName === "float") {
                  extractedValue = valuePtr.readFloat();
                } else if (fTypeName === "System.String" || fTypeName === "string") {
                  const strPtr = valuePtr.readPointer();
                  if (!strPtr.isNull()) {
                    extractedValue = `"${strPtr.add(0x14).readUtf16String()}"`;
                  } else {
                    extractedValue = "null";
                  }
                }

                valueFile.write(`[${ns}.${name}] ${fTypeName} ${fName} = ${extractedValue}\n`);
              }
            } catch (e) {
              valueFile.write(`[${ns}.${name}] ${fTypeName} ${fName} = [Uninitialized/Error]\n`);
            }
          }
        }

        // --- DUMP METHODS & RETURN TYPES ---
        const iterMethod = Memory.alloc(Process.pointerSize).writePointer(NULL);
        let method;
        while (!(method = il2cpp.class_get_methods(klass, iterMethod)).isNull()) {
          const mName = il2cpp.method_get_name(method).readCString();

          const retTypePtr = il2cpp.method_get_return_type(method);
          const retTypeName = il2cpp.type_get_name(retTypePtr).readCString();

          const mPtr = method.readPointer(); // methodPointer

          // Terapkan opsi Format Alamat Method
          let addressFormat = "";
          if (METHOD_ADDRESS_FORMAT === "RVA") {
            const rva = mPtr.isNull() ? "0x0" : "0x" + mPtr.sub(base).toString(16);
            addressFormat = `RVA: ${rva} | `;
          } else if (METHOD_ADDRESS_FORMAT === "ABSOLUTE") {
            const abs = mPtr.isNull() ? "0x0" : mPtr.toString();
            addressFormat = `ABS: ${abs} | `;
          }

          file.write(`  [Method] ${addressFormat}${retTypeName} ${mName}()\n`);
        }

        file.write(`}\n\n`);

        if (j > 0 && j % 500 === 0) console.log(`Progress: ${j}/${classCount} classes...`);
      }
      break;
    }
  }

  file.flush();
  file.close();
  if (valueFile) {
    valueFile.flush();
    valueFile.close();
  }
  console.log("[+] DUMP SELESAI!");
}

setTimeout(dumpAll, 5000);
