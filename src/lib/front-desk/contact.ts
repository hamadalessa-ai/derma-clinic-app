/** Saudi mobiles are stored as 05XXXXXXXX; links need the international form 9665XXXXXXXX. */
export function intlMobile(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("966")) return d;
  if (d.startsWith("0")) return `966${d.slice(1)}`;
  return d;
}
export const telLink = (phone: string) => `tel:+${intlMobile(phone)}`;
export const waLink = (phone: string) => `https://wa.me/${intlMobile(phone)}`;
