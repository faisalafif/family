export function normalizeIndonesianPhone(input) {
  const value = String(input ?? "").trim().replace(/[\s().-]/g, "");
  if (!value) throw new Error("Masukkan nomor telepon.");

  let normalized;
  if (/^08\d{8,11}$/.test(value)) normalized = `+62${value.slice(1)}`;
  else if (/^628\d{8,11}$/.test(value)) normalized = `+${value}`;
  else if (/^\+628\d{8,11}$/.test(value)) normalized = value;
  else throw new Error("Format nomor Indonesia tidak valid. Gunakan 08..., 628..., atau +628....");

  return normalized;
}
