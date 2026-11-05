// TEMPORARY (review branch only): photograph Derma's published images to read them.
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
const IMGS = {
  "derm-doctors-1": "https://img.rekaz.io/cdn-cgi/image/quality=90,fit=scale-down,width=1400,f=auto/https://cdn.rekaz.io/tenants/3a210100-f494-af5e-f3a8-2769280512c2/3a227cb8-d3cb-59ea-bc49-b465f44bffa19d209cc4-06e3-46c0-a65e-fc1e6d1a2ce2-src_ar..png?v=0",
  "derm-doctors-2": "https://img.rekaz.io/cdn-cgi/image/quality=90,fit=scale-down,width=1400,f=auto/https://cdn.rekaz.io/tenants/3a210100-f494-af5e-f3a8-2769280512c2/3a227cb8-d3cb-59ea-bc49-b465f44bffa1bb037659-3b4d-4aab-90f4-769cc83757d9-src_ar..png?v=0",
  "derm-doctors-3": "https://img.rekaz.io/cdn-cgi/image/quality=90,fit=scale-down,width=1400,f=auto/https://cdn.rekaz.io/tenants/3a210100-f494-af5e-f3a8-2769280512c2/3a227cb8-d3cb-59ea-bc49-b465f44bffa1dad0a45e-68e0-4be6-bd47-fbfa56044fc5-src_ar..png?v=0",
  "dentistry-services": "https://img.rekaz.io/cdn-cgi/image/quality=90,fit=scale-down,width=1400,f=auto/https://cdn.rekaz.io/tenants/3a210100-f494-af5e-f3a8-2769280512c2/3a227ceb-24af-3474-578e-aa1830cfe8ba47bb789e-768b-4ddb-951a-2477df3f9fcc-imageSrc_ar..png",
  "plastic-services": "https://img.rekaz.io/cdn-cgi/image/quality=90,fit=scale-down,width=1400,f=auto/https://cdn.rekaz.io/tenants/3a210100-f494-af5e-f3a8-2769280512c2/3a227d2a-c17e-5a9c-c576-495eef60adbef2d2fb13-a7d1-4896-890a-9c8122f83ac5-imageSrc_ar..png",
  "derm-procedures": "https://img.rekaz.io/cdn-cgi/image/quality=90,fit=scale-down,width=1400,f=auto/https://cdn.rekaz.io/tenants/3a210100-f494-af5e-f3a8-2769280512c2/3a2277e4-c450-dcea-3431-922aa127a805cd812751-4c8b-448e-81d7-cf3931863590-imageUrl_ar..jpg?v=0",
  "plastic-procedures": "https://img.rekaz.io/cdn-cgi/image/quality=90,fit=scale-down,width=1400,f=auto/https://cdn.rekaz.io/tenants/3a210100-f494-af5e-f3a8-2769280512c2/3a2277a6-bc43-d721-eea1-b120cf51c90d3adee8ae-a3fa-4c21-bcbf-3ac9af9468c2-imageUrl_ar..jpg",
  "hair-procedures": "https://img.rekaz.io/cdn-cgi/image/quality=90,fit=scale-down,width=1400,f=auto/https://cdn.rekaz.io/tenants/3a210100-f494-af5e-f3a8-2769280512c2/3a2277c6-02eb-e60a-cdb0-50e099bbff2e8d47da9c-385f-4986-bd70-44f11042b237-imageUrl_ar..jpg?v=0",
  "dental-procedures": "https://img.rekaz.io/cdn-cgi/image/quality=90,fit=scale-down,width=1400,f=auto/https://cdn.rekaz.io/tenants/3a210100-f494-af5e-f3a8-2769280512c2/3a2277cf-5283-7cb7-2020-d0883e11a17184a13b42-7df3-4fcf-acc7-5cd620ba25e5-imageUrl_ar..jpg"
};
mkdirSync("screenshots", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
for (const [name, url] of Object.entries(IMGS)) {
  await page.setContent(`<body style="margin:0;background:#fff"><img src="${url}" style="display:block;max-width:1400px"></body>`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `screenshots/peek-${name}.png`, fullPage: true });
}
await browser.close();
